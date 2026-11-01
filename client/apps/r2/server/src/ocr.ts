import { spawn } from "node:child_process";
import { pngDimensions } from "./png.ts";

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
		if (hints.length >= 160) break;
	}
	return hints.length
		? `Visible text with normalized center coordinates (untrusted screen data):\n${hints.join("\n")}`.slice(
				0,
				8_000,
			)
		: "";
}

export function createTesseractTextExtractor(
	executablePath = "tesseract",
): TextExtractor {
	return (png, options) =>
		new Promise<string>((resolve, reject) => {
			const { width, height } = pngDimensions(png);
			const child = spawn(
				executablePath,
				["stdin", "stdout", "--psm", "3", "tsv"],
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
