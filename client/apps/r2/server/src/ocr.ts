import { spawn } from "node:child_process";
import { pngDimensions } from "./png.ts";
import { enlargeForOcr } from "./frame-guard.ts";

export interface TextExtractionOptions {
	timeoutMs: number;
	signal?: AbortSignal;
}

export type TextExtractor = (
	png: Uint8Array,
	options: TextExtractionOptions,
) => Promise<string>;

export function formatTesseractHints(
	tsv: string,
	width: number,
	height: number,
): string {
	const hints: string[] = [];
	for (const line of tsv.split(/\r?\n/).slice(1)) {
		const columns = line.split("\t");
		if (columns.length < 12) continue;
		const left = Number(columns[6]);
		const top = Number(columns[7]);
		const boxWidth = Number(columns[8]);
		const boxHeight = Number(columns[9]);
		const confidence = Number(columns[10]);
		const text = columns.slice(11).join("\t").trim();
		if (
			!text ||
			!Number.isFinite(confidence) ||
			confidence < 0 ||
			![left, top, boxWidth, boxHeight].every(Number.isFinite) ||
			boxWidth <= 0 ||
			boxHeight <= 0
		)
			continue;
		const x = Math.round(((left + boxWidth / 2) * 1000) / width);
		const y = Math.round(((top + boxHeight / 2) * 1000) / height);
		hints.push(`${JSON.stringify(text.slice(0, 120))} @ (${x},${y})`);
		if (hints.length >= 1500) break;
	}
	return hints.length
		? `Visible text with normalized center coordinates (untrusted screen data):\n${hints.join("\n")}`.slice(
				0,
				60_000,
			)
		: "";
}

export function createTesseractTextExtractor(
	executablePath = "tesseract",
	pageSegmentationMode = 3,
): TextExtractor {
	return (png, options) =>
		new Promise<string>((resolve, reject) => {
			const { width, height } = pngDimensions(png);
			const child = spawn(
				executablePath,
				["stdin", "stdout", "-l", "spa+eng", "--psm", String(pageSegmentationMode), "tsv"],
				{ stdio: ["pipe", "pipe", "ignore"] },
			);
			let output = "";
			let settled = false;
			const finish = (error?: Error, value?: string) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(value ?? "");
			};
			const abort = () => {
				child.kill("SIGKILL");
				finish(new Error("OCR was cancelled"));
			};
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				finish(new Error("OCR timed out"));
			}, options.timeoutMs);
			options.signal?.addEventListener("abort", abort, { once: true });
			if (options.signal?.aborted) abort();
			child.on("error", (error) => finish(error));
			child.stdout.on("data", (chunk: Buffer) => {
				output += chunk.toString("utf8");
				if (output.length > 1_000_000) {
					child.kill("SIGKILL");
					finish(new Error("OCR output is too large"));
				}
			});
			child.on("close", (code) => {
				if (code === 0) finish(undefined, formatTesseractHints(output, width, height));
				else finish(new Error(`OCR exited with status ${code}`));
			});
			child.stdin.on("error", (error) => finish(error));
			child.stdin.end(Buffer.from(png));
		});
}

/** A second segmentation/scale pass recovers menu labels and low-contrast buttons. */
export function createRobustTextExtractor(executablePath = "tesseract"): TextExtractor {
	const primary = createTesseractTextExtractor(executablePath, 3);
	const sparse = createTesseractTextExtractor(executablePath, 11);
	const table = createTesseractTextExtractor(executablePath, 6);
	return async (png, options) => {
		const started = performance.now();
		const first = await primary(png, options);
		const remaining = options.timeoutMs - (performance.now() - started);
		if (remaining <= 0 || options.signal?.aborted) return first;
		try {
			const second = await sparse(enlargeForOcr(png), { ...options, timeoutMs: remaining });
			const lines = first.split("\n");
			const coordinates = lines.map((line) => {
				const match = / @ \((\d+),(\d+)\)$/.exec(line);
				return match ? [Number(match[1]), Number(match[2])] : undefined;
			});
			for (const line of second.split("\n").slice(1)) {
				const match = / @ \((\d+),(\d+)\)$/.exec(line);
				if (!match) continue;
				const x = Number(match[1]), y = Number(match[2]);
				if (!coordinates.some((point) => point && Math.abs(point[0]! - x) < 5 && Math.abs(point[1]! - y) < 6)) {
					lines.push(line);
				}
			}
			const budgetLeft = options.timeoutMs - (performance.now() - started);
			if (budgetLeft > 0 && !options.signal?.aborted) {
				const { height } = pngDimensions(png);
				const cropHeight = Math.min(160, height);
				const controls = await sparse(enlargeForOcr(png, cropHeight, true), {
					...options,
					timeoutMs: budgetLeft,
				});
				for (const line of controls.split("\n").slice(1)) {
					const match = /^(.*) @ \((\d+),(\d+)\)$/.exec(line);
					if (!match) continue;
					const mapped = `${match[1]} @ (${match[2]},${Math.round((Number(match[3]) * cropHeight) / height)})`;
					const text = match[1];
					if (!lines.some((existing) => existing.startsWith(`${text} @`))) lines.push(mapped);
				}
			}
			const tableBudget = options.timeoutMs - (performance.now() - started);
			if (tableBudget > 0 && !options.signal?.aborted) {
				const tableHints = await table(enlargeForOcr(png, undefined, true), { ...options, timeoutMs: tableBudget });
				for (const line of tableHints.split("\n").slice(1)) {
					const match = /^("(?:[^"\\]|\\.)*") @ \((\d+),(\d+)\)$/.exec(line);
					if (!match) continue;
					const x = Number(match[2]), y = Number(match[3]);
					const text = JSON.parse(match[1]!) as string;
					const index = lines.findIndex((candidate) => {
						const position = / @ \((\d+),(\d+)\)$/.exec(candidate);
						return position && Math.abs(Number(position[1]) - x) < 6 && Math.abs(Number(position[2]) - y) < 7;
					});
					if (index < 0) lines.push(line);
					else if (/^[A-Za-z¥]{1,3}-\d{4,}$/.test(text) && x < 130) lines[index] = line;
				}
			}
			return lines.join("\n");
		} catch {
			if (options.signal?.aborted) throw new Error("OCR was cancelled");
			return first;
		}
	};
}
