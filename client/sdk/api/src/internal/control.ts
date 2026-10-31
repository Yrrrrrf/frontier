import { ApiError } from "../errors.ts";

export function configError(message: string, cause?: unknown): ApiError {
	return new ApiError(0, message, undefined, "", {
		code: "CONFIG_ERROR",
		cause,
	});
}

export function nonnegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0 || value > 2_147_483_647) {
		throw configError(`Invalid ${name}`);
	}
	return value;
}

export function createScope(
	parent: AbortSignal | null | undefined,
	owner: AbortSignal,
	timeoutMs: number,
) {
	const controller = new AbortController();
	const cleanup: (() => void)[] = [];
	for (const signal of [parent, owner]) {
		if (!signal) continue;
		const relay = () => controller.abort(signal.reason);
		if (signal.aborted) relay();
		else {
			signal.addEventListener("abort", relay, { once: true });
			cleanup.push(() => signal.removeEventListener("abort", relay));
		}
	}
	const timer =
		timeoutMs > 0
			? setTimeout(
					() =>
						controller.abort(
							new ApiError(0, "Operation timed out", undefined, "", {
								code: "TIMEOUT",
							}),
						),
					timeoutMs,
				)
			: undefined;
	return {
		signal: controller.signal,
		close() {
			if (timer !== undefined) clearTimeout(timer);
			for (const fn of cleanup) fn();
		},
	};
}

export function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason instanceof ApiError && signal.reason.code === "TIMEOUT") {
		throw signal.reason;
	}
	throw new ApiError(0, "Operation canceled", undefined, "", {
		code: "ABORTED",
		cause: signal.reason,
	});
}

/** Immediate waiter cancellation, including adapters/hooks that ignore the signal. */
export function waitFor<T>(
	value: PromiseLike<T>,
	signal: AbortSignal,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			try {
				throwIfAborted(signal);
			} catch (error) {
				reject(error);
			}
		};
		if (signal.aborted) {
			Promise.resolve(value).catch(() => {});
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(value)
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			try {
				throwIfAborted(signal);
			} catch (error) {
				reject(error);
			}
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
}

export function retryAfter(value: string | null): number | undefined {
	if (value === null) return undefined;
	if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
	// HTTP-date begins with a weekday; Date.parse otherwise accepts unrelated inputs such as "1.5".
	if (
		!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:,|day,|sday,|nesday,|rsday,|urday,|\s)/i.test(
			value.trim(),
		)
	) {
		return undefined;
	}
	const at = Date.parse(value);
	return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}
