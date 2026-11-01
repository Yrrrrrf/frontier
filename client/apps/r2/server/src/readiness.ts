import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

/** Cached preflight for the actual deterministic runner dependencies, not Ollama. */
export function createDeterministicReadiness(options: { executablePath?: string; tesseractExecutable: string }) {
	let ready = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let checking: Promise<boolean> | undefined;
	const refresh = () => {
		checking ??= (async () => {
			try {
				await access(options.executablePath ?? chromium.executablePath(), constants.X_OK);
				await new Promise<void>((resolve, reject) => {
					execFile(options.tesseractExecutable, ["--version"], { timeout: 3000, maxBuffer: 4096 }, (error) => error ? reject(error) : resolve());
				});
				ready = true;
			} catch { ready = false; }
			return ready;
		})().finally(() => { checking = undefined; });
		return checking;
	};
	return {
		isReady: () => ready,
		refresh,
		start: () => { timer ??= setInterval(() => void refresh(), 30_000); timer.unref(); },
		stop: () => { if (timer) clearInterval(timer); timer = undefined; },
	};
}
