import { AxiosHeaders, isAxiosError, isCancel } from "axios";
import type { AxiosError } from "axios";
import type { HeaderInput } from "./types.ts";
import { toAxiosHeaders } from "./internal/headers.ts";

export type ApiErrorCode =
	| "HTTP_ERROR"
	| "NETWORK_ERROR"
	| "TIMEOUT"
	| "ABORTED"
	| "PARSE_ERROR"
	| "VALIDATION_ERROR"
	| "CONFIG_ERROR"
	| "RESPONSE_TOO_LARGE"
	| "REQUEST_TOO_LARGE";

export interface ApiErrorDetails {
	code?: ApiErrorCode;
	method?: string;
	headers?: HeaderInput;
	attempt?: number;
	cause?: unknown;
	axiosCode?: string;
}

/** Keeps payload/cause available for callers, but excludes them from JSON diagnostics. */
export class ApiError<TErrorPayload = unknown> extends Error {
	readonly isApiError = true;
	readonly status: number;
	readonly statusText: string;
	readonly data: TErrorPayload;
	readonly url: string;
	readonly code: ApiErrorCode;
	readonly method: string;
	readonly headers: AxiosHeaders;
	readonly attempt: number;
	readonly axiosCode: string | undefined;

	constructor(
		status: number,
		statusText: string,
		data: TErrorPayload,
		url = "",
		details: ApiErrorDetails = {},
	) {
		const code = details.code ?? "HTTP_ERROR";
		super(
			`${code}${status ? ` ${status}` : ""}${
				statusText ? ` ${statusText}` : ""
			}`,
			{ cause: details.cause },
		);
		this.name = "ApiError";
		this.status = status;
		this.statusText = statusText;
		this.data = data;
		this.url = url;
		this.code = code;
		this.method = details.method ?? "GET";
		this.headers = toAxiosHeaders(details.headers);
		this.attempt = details.attempt ?? 0;
		this.axiosCode = details.axiosCode;
	}

	toJSON() {
		// URLs can carry secrets even in path segments. Payloads and headers can too.
		return {
			name: this.name,
			code: this.code,
			status: this.status,
			method: this.method,
			attempt: this.attempt,
			axiosCode: this.axiosCode,
		};
	}
}

/** T describes the backend payload; use a schema before trusting its contents. */
export function isApiError<T = unknown>(error: unknown): error is ApiError<T> {
	return (
		typeof error === "object" &&
		error !== null &&
		"isApiError" in error &&
		error.isApiError === true &&
		"code" in error &&
		"status" in error
	);
}

export function isAbortError(error: unknown): boolean {
	return isApiError(error)
		? error.code === "ABORTED"
		: isCancel(error) ||
				(error instanceof Error && error.name === "AbortError");
}

export function fromAxiosError(
	error: unknown,
	url: string,
	method: string,
	attempt: number,
): ApiError {
	if (isApiError(error)) {
		return new ApiError(error.status, error.statusText, error.data, url, {
			code: error.code,
			method,
			attempt,
			headers: error.headers,
			cause: error.cause,
			...(error.axiosCode ? { axiosCode: error.axiosCode } : {}),
		});
	}
	if (!isAxiosError(error)) {
		return new ApiError(0, "Request setup or hook failed", undefined, url, {
			code: "CONFIG_ERROR",
			method,
			attempt,
			cause: error,
		});
	}
	const response = error.response;
	let code: ApiErrorCode;
	if (isCancel(error)) code = "ABORTED";
	else if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
		code = "TIMEOUT";
	} else if (
		/maxContentLength|response.*(?:size|larger)/i.test(error.message)
	) {
		code = "RESPONSE_TOO_LARGE";
	} else if (/maxBodyLength|Request body larger/i.test(error.message)) {
		code = "REQUEST_TOO_LARGE";
	} else if (
		error.code === "ERR_BAD_RESPONSE" &&
		error.cause instanceof SyntaxError
	) {
		code = "PARSE_ERROR";
	} else if (response) code = "HTTP_ERROR";
	else if (
		[
			"ERR_NETWORK",
			"ECONNREFUSED",
			"ECONNRESET",
			"ENOTFOUND",
			"EAI_AGAIN",
			"EPIPE",
		].includes(error.code ?? "")
	) {
		code = "NETWORK_ERROR";
	} else code = "CONFIG_ERROR";
	return new ApiError(
		response?.status ?? 0,
		response?.statusText ?? "Axios request failed",
		response?.data,
		url,
		{
			code,
			method,
			attempt,
			headers: AxiosHeaders.from(
				response?.headers as import("axios").RawAxiosHeaders | undefined,
			),
			cause: error,
			...(error.code ? { axiosCode: error.code } : {}),
		},
	);
}

/** The original AxiosError remains the cause; backend payloads still require validation. */
export function getAxiosError<T = unknown>(
	error: unknown,
): AxiosError<T> | undefined {
	if (isAxiosError<T>(error)) return error;
	return isApiError(error) && isAxiosError<T>(error.cause)
		? error.cause
		: undefined;
}
