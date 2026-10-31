import axios from "axios";
import type {
	AxiosRequestTransformer,
	AxiosResponseTransformer,
	InternalAxiosRequestConfig,
} from "axios";
import { configError } from "./control.ts";

export const responseMode: unique symbol = Symbol("sdk-api-response-mode");

/** Fix the typed-view backing-buffer edge, then delegate representations to Axios. */
export const prepareBody: AxiosRequestTransformer = function (
	data: unknown,
	headers,
) {
	if (ArrayBuffer.isView(data)) {
		const view = data as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice()
			.buffer;
	}
	if (
		typeof FormData !== "undefined" &&
		data instanceof FormData &&
		!String(headers.getContentType() ?? "").includes("application/json")
	) {
		headers.delete("Content-Type");
	}
	if (data === null || typeof data === "number" || typeof data === "boolean") {
		headers.setContentType("application/json", false);
	}
	if (
		typeof data === "bigint" ||
		typeof data === "function" ||
		typeof data === "symbol"
	) {
		throw configError("Body is not JSON-serializable");
	}
	return data;
};

const nativeResponseTransforms = Array.isArray(axios.defaults.transformResponse)
	? axios.defaults.transformResponse
	: axios.defaults.transformResponse
		? [axios.defaults.transformResponse]
		: [];

/** Native Axios JSON parsing with strict success and lenient rejected error bodies. */
export const parseResponse: AxiosResponseTransformer = function (
	data: unknown,
	headers,
	status,
) {
	if (this.method === "head" || status === 204 || status === 205) {
		return undefined;
	}
	const media = String(headers.get("Content-Type") ?? "")
		.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	const requested =
		(this as InternalAxiosRequestConfig & { [responseMode]?: string })[
			responseMode
		] ?? this.responseType;
	const json =
		requested === "json" ||
		((!requested || requested === "auto") &&
			(media === "application/json" || media?.endsWith("+json")));
	if (!json || typeof data !== "string") return data;
	if (data === "") return undefined;
	const accepted =
		status === undefined || !this.validateStatus || this.validateStatus(status);
	const config: InternalAxiosRequestConfig = {
		...this,
		responseType: "json",
		transitional: {
			...this.transitional,
			silentJSONParsing: !accepted,
			forcedJSONParsing: true,
		},
	};
	let value: unknown = data;
	for (const transform of nativeResponseTransforms) {
		value = transform.call(config, value, headers, status);
	}
	return value;
};

export function isStreamBody(value: unknown): boolean {
	return (
		(typeof ReadableStream !== "undefined" &&
			value instanceof ReadableStream) ||
		(typeof value === "object" &&
			value !== null &&
			"pipe" in value &&
			typeof value.pipe === "function")
	);
}

/** Close unused Node/web stream data without importing Node into browser bundles. */
export function discardData(data: unknown): void {
	if (typeof data !== "object" || data === null) return;
	if ("destroy" in data && typeof data.destroy === "function") data.destroy();
	else if (
		"cancel" in data &&
		typeof data.cancel === "function" &&
		!("locked" in data && data.locked)
	) {
		void Promise.resolve(data.cancel()).catch(() => {});
	}
}
