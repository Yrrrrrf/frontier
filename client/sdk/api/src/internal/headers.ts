import { AxiosHeaders, type RawAxiosHeaders } from "axios";
import type { HeaderInput } from "../types.ts";

/** Convert legacy HeadersInit without losing Axios false/null suppression values. */
export function toAxiosHeaders(input?: HeaderInput): AxiosHeaders {
	if (typeof Headers !== "undefined" && input instanceof Headers) {
		const headers = new AxiosHeaders();
		input.forEach((value, key) => {
			headers.set(key, value);
		});
		return headers;
	}
	if (Array.isArray(input)) return new AxiosHeaders().set(input);
	return new AxiosHeaders(input as RawAxiosHeaders | AxiosHeaders | undefined);
}

export function mergeHeaders(
	defaults?: HeaderInput,
	overrides?: HeaderInput,
): AxiosHeaders {
	const headers = toAxiosHeaders(defaults);
	headers.set(toAxiosHeaders(overrides), true);
	return headers;
}
