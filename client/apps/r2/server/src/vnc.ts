import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
} from "playwright-core";
import { pngDimensions } from "./png.ts";

export interface DesktopOperationOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface NoVncOptions extends DesktopOperationOptions {
	viewerUrl: string;
	password: string;
	executablePath?: string;
}

export interface DesktopFrame {
	png: Uint8Array;
	width: number;
	height: number;
}

/** The official DTO carries the VNC websocket; Playwright opens its viewer. */
export function toNoVncViewerUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol === "wss:") url.protocol = "https:";
	else if (url.protocol === "ws:") url.protocol = "http:";
	else if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error("noVNC URL must use HTTP(S) or WS(S)");
	if (/^\/websockify\/?$/.test(url.pathname)) {
		url.pathname = "/";
		url.search = "";
		url.hash = "";
	}
	return url.toString();
}

export class DesktopOperationError extends Error {
	constructor(
		message: string,
		readonly retryable = false,
		readonly inputMayBeApplied = false,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "DesktopOperationError";
	}
}

function operationError(
	message: string,
	cause?: unknown,
	inputMayBeApplied = false,
): DesktopOperationError {
	if (cause instanceof DesktopOperationError) {
		if (!inputMayBeApplied || cause.inputMayBeApplied) return cause;
		return new DesktopOperationError(message, cause.retryable, true, { cause });
	}
	return new DesktopOperationError(message, false, inputMayBeApplied, {
		...(cause === undefined ? {} : { cause }),
	});
}

async function cleanupWithin(work: Promise<unknown>): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			work,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 2_000);
			}),
		]);
	} catch {
		// Cleanup is best-effort and must not reopen or replace a terminal result.
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function bounded<T>(
	work: () => Promise<T>,
	options: DesktopOperationOptions,
	onCancel: () => void,
): Promise<T> {
	if (options.signal?.aborted)
		throw new DesktopOperationError("Desktop operation was cancelled");
	const timeout = options.timeoutMs ?? 20_000;
	if (!Number.isFinite(timeout) || timeout <= 0)
		throw new DesktopOperationError("Desktop operation budget is exhausted");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const parent = options.signal;
	const cancel = (message: string) => {
		onCancel();
		return new DesktopOperationError(message);
	};
	const parentAbort = () => cancelAndReject("Desktop operation was cancelled");
	let rejectCancellation!: (error: Error) => void;
	const cancelAndReject = (message: string) =>
		rejectCancellation(cancel(message));
	const cancellation = new Promise<never>((_resolve, reject) => {
		rejectCancellation = reject;
		timer = setTimeout(
			() => reject(cancel("Desktop operation timed out")),
			timeout,
		);
		parent?.addEventListener("abort", parentAbort, { once: true });
	});
	try {
		return await Promise.race([work(), cancellation]);
	} finally {
		if (timer) clearTimeout(timer);
		parent?.removeEventListener("abort", parentAbort);
	}
}

function sameFrame(left: DesktopFrame, right: DesktopFrame): boolean {
	if (
		left.width !== right.width ||
		left.height !== right.height ||
		left.png.byteLength !== right.png.byteLength
	)
		return false;
	return timingSafeEqual(Buffer.from(left.png), Buffer.from(right.png));
}

/** Controls only the noVNC transport UI and its pixels, never the target app's DOM. */
export class NoVncDesktop {
	readonly #abort: () => void;
	#mouseDown = false;
	#closing?: Promise<void>;

	private constructor(
		private readonly browser: Browser,
		private readonly context: BrowserContext,
		private readonly page: Page,
		private readonly signal?: AbortSignal,
	) {
		this.#abort = () => void this.close();
		this.signal?.addEventListener("abort", this.#abort, { once: true });
		if (this.signal?.aborted) this.#abort();
	}

	static async login(options: NoVncOptions): Promise<NoVncDesktop> {
		if (options.signal?.aborted)
			throw new DesktopOperationError("noVNC login was cancelled");
		let browser: Browser | undefined;
		let cancelled = false;
		const phase = {
			current: "launch" as "launch" | "transport" | "authentication",
		};
		const work = async () => {
			browser = await chromium.launch({
				headless: true,
				timeout: options.timeoutMs ?? 20_000,
				...(options.executablePath
					? { executablePath: options.executablePath }
					: {}),
			});
			if (cancelled)
				throw new DesktopOperationError("noVNC login was cancelled");
			const context = await browser.newContext({
				viewport: { width: 1280, height: 800 },
				deviceScaleFactor: 1,
			});
			const page = await context.newPage();
			const timeout = options.timeoutMs ?? 20_000;
			phase.current = "transport";
			await page.goto(toNoVncViewerUrl(options.viewerUrl), {
				waitUntil: "domcontentloaded",
				timeout,
			});
			if (cancelled || options.signal?.aborted)
				throw new DesktopOperationError("noVNC login was cancelled");
			await page.locator("#noVNC_connect_button").click({ timeout });
			phase.current = "authentication";
			const password = page.locator("#noVNC_password_input");
			await password.waitFor({ state: "visible", timeout });
			await password.fill(options.password, { timeout });
			await page.locator("#noVNC_credentials_button").click({ timeout });
			await page
				.locator("html.noVNC_connected")
				.waitFor({ state: "attached", timeout });
			await page
				.locator("#noVNC_container canvas")
				.waitFor({ state: "visible", timeout });
			if (cancelled || options.signal?.aborted)
				throw new DesktopOperationError("noVNC login was cancelled");
			// Authentication is complete; allow the remote application to paint.
			await page.waitForTimeout(2_000);
			return new NoVncDesktop(browser, context, page, options.signal);
		};
		try {
			return await bounded(work, options, () => {
				cancelled = true;
				if (browser) void browser.close().catch(() => {});
			});
		} catch (error) {
			cancelled = true;
			if (browser) await browser.close().catch(() => {});
			if (error instanceof DesktopOperationError) throw error;
			throw new DesktopOperationError(
				"noVNC login failed",
				phase.current === "transport",
				false,
				{ cause: error },
			);
		}
	}

	async #run<T>(
		work: () => Promise<T>,
		options: DesktopOperationOptions,
	): Promise<T> {
		return bounded(work, options, () => void this.close());
	}

	async #effect<T>(
		work: () => Promise<T>,
		options: DesktopOperationOptions,
	): Promise<T> {
		if (
			options.signal?.aborted ||
			!Number.isFinite(options.timeoutMs) ||
			(options.timeoutMs ?? 0) <= 0
		)
			throw new DesktopOperationError("Desktop input budget is exhausted");
		return this.#run(work, options);
	}

	async #releaseMouse(): Promise<void> {
		if (!this.#mouseDown) return;
		this.#mouseDown = false;
		if (!this.page.isClosed()) await cleanupWithin(this.page.mouse.up());
	}

	async capture(
		path?: string,
		options: DesktopOperationOptions = {},
	): Promise<DesktopFrame> {
		// Reading the transport canvas excludes overlays and never inspects the app DOM.
		const encoded = await this.#run(
			() =>
				this.page
					.locator("#noVNC_container canvas")
					.evaluate(
						(canvas) =>
							(canvas as HTMLCanvasElement)
								.toDataURL("image/png")
								.split(",")[1],
					),
			options,
		);
		if (!encoded) throw new Error("Desktop canvas capture failed");
		const png = Buffer.from(encoded, "base64");
		if (path) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, png);
		}
		return { png, ...pngDimensions(png) };
	}

	async click(
		frame: DesktopFrame,
		x: number,
		y: number,
		options: DesktopOperationOptions = {},
	): Promise<void> {
		const deadline = performance.now() + (options.timeoutMs ?? 20_000);
		const remaining = () => ({
			...(options.signal ? { signal: options.signal } : {}),
			timeoutMs: Math.max(0, deadline - performance.now()),
		});
		let inputMayBeApplied = false;
		try {
			// Coordinates belong to this exact capture, never to a later geometry.
			const current = await this.capture(undefined, remaining());
			if (
				!Number.isInteger(x) ||
				!Number.isInteger(y) ||
				x < 0 ||
				y < 0 ||
				x >= frame.width ||
				y >= frame.height
			)
				throw new Error("Desktop click is outside the source frame");
			if (!sameFrame(frame, current))
				throw new DesktopOperationError("Desktop frame changed before input");
			const canvas = this.page.locator("#noVNC_container canvas");
			const box = await this.#run(() => canvas.boundingBox(), remaining());
			if (!box) throw new Error("Desktop canvas is not visible");
			if (options.signal?.aborted || deadline <= performance.now())
				throw new DesktopOperationError("Desktop click budget is exhausted");
			await this.#effect(
				() =>
					this.page.mouse.move(
						box.x + (x * box.width) / frame.width,
						box.y + (y * box.height) / frame.height,
					),
				remaining(),
			);
			if (options.signal?.aborted || deadline <= performance.now())
				throw new DesktopOperationError("Desktop click budget is exhausted");
			inputMayBeApplied = true;
			this.#mouseDown = true;
			try {
				await this.#effect(() => this.page.mouse.down(), remaining());
				await this.#run(
					() => new Promise<void>((resolve) => setTimeout(resolve, 120)),
					remaining(),
				);
				await this.#effect(() => this.page.mouse.up(), remaining());
				this.#mouseDown = false;
			} finally {
				await this.#releaseMouse();
			}
			await this.#run(
				() => new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
				remaining(),
			);
		} catch (error) {
			throw operationError(
				inputMayBeApplied
					? "Desktop click effect is uncertain"
					: "Desktop click failed before input",
				error,
				inputMayBeApplied,
			);
		}
	}

	async chooseText(
		frame: DesktopFrame,
		x: number,
		y: number,
		text: string,
		options: DesktopOperationOptions = {},
	): Promise<void> {
		const deadline = performance.now() + (options.timeoutMs ?? 20_000);
		const remaining = () => ({
			...(options.signal ? { signal: options.signal } : {}),
			timeoutMs: Math.max(0, deadline - performance.now()),
		});
		await this.click(frame, x, y, remaining());
		try {
			await this.#effect(() => this.page.keyboard.type(text), remaining());
			await this.#effect(() => this.page.keyboard.press("Enter"), remaining());
			await this.#run(
				() => new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
				remaining(),
			);
		} catch (error) {
			throw operationError("Desktop selection effect is uncertain", error, true);
		}
	}

	async replaceText(
		frame: DesktopFrame,
		x: number,
		y: number,
		text: string,
		options: DesktopOperationOptions = {},
	): Promise<void> {
		const deadline = performance.now() + (options.timeoutMs ?? 20_000);
		const remaining = () => ({
			...(options.signal ? { signal: options.signal } : {}),
			timeoutMs: Math.max(0, deadline - performance.now()),
		});
		await this.click(frame, x, y, remaining());
		try {
			await this.#effect(
				() => this.page.keyboard.press("Control+A"),
				remaining(),
			);
			await this.#effect(
				() => this.page.keyboard.type(text, { delay: 20 }),
				remaining(),
			);
			await this.#run(
				() => new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
				remaining(),
			);
		} catch (error) {
			throw operationError(
				"Desktop text replacement effect is uncertain",
				error,
				true,
			);
		}
	}

	close(): Promise<void> {
		this.#closing ??= this.#close();
		return this.#closing;
	}

	async #close(): Promise<void> {
		this.signal?.removeEventListener("abort", this.#abort);
		await this.#releaseMouse();
		try {
			await cleanupWithin(this.context.close());
		} finally {
			await cleanupWithin(this.browser.close());
		}
	}
}
