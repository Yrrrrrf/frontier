import { configError } from "./control.ts";

function parseHttp(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (cause) {
		throw configError("Invalid HTTP URL", cause);
	}
	if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
		throw configError("Only HTTP(S) URLs without userinfo are supported");
	}
	return url;
}

function hasInvalidBaseChars(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
	}
	return /\s/.test(str);
}

function hasInvalidPathChars(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
	}
	return false;
}

export function validateBase(base: string): string {
	if (hasInvalidBaseChars(base)) throw configError("Invalid baseUrl");
	if (!base) return "";
	if (base.startsWith("//")) {
		throw configError("Protocol-relative baseUrl is not supported");
	}
	if (base.startsWith("/")) {
		const normalized = new URL(base, "https://sdk.invalid");
		if (normalized.search || normalized.hash) {
			throw configError("baseUrl must not contain a query or fragment");
		}
		return normalized.pathname.replace(/\/+$/, "");
	}
	if (!/^https?:\/\//i.test(base)) {
		throw configError(
			"baseUrl must be absolute HTTP(S) or a root-relative prefix",
		);
	}
	const url = parseHttp(base);
	if (url.search || url.hash) {
		throw configError("baseUrl must not contain a query or fragment");
	}
	return url.href.replace(/\/+$/, "");
}

export function validateOrigins(origins: readonly string[]): Set<string> {
	return new Set(
		origins.map((value) => {
			const url = parseHttp(value);
			if (url.pathname !== "/" || url.search || url.hash) {
				throw configError("allowedOrigins must contain origins only");
			}
			return url.origin;
		}),
	);
}

export function resolveUrl(
	base: string,
	path: string,
	allowed: Set<string>,
): { url: string; trusted: boolean } {
	if (
		typeof path !== "string" ||
		!path ||
		hasInvalidPathChars(path) ||
		path.startsWith("//")
	) {
		throw configError("Invalid request path");
	}
	const absolute = /^https?:\/\//i.test(path);
	if (!absolute && /^[a-z][a-z\d+.-]*:/i.test(path)) {
		throw configError("Unsupported request URL scheme");
	}
	const browserOrigin =
		typeof window !== "undefined" && /^https?:$/.test(window.location?.protocol)
			? window.location.origin
			: undefined;
	const knownOrigin =
		base && /^https?:\/\//i.test(base) ? parseHttp(base).origin : browserOrigin;
	const constructed = absolute ? path : `${base}/${path.replace(/^\/+/, "")}`;
	const parsed = /^https?:\/\//i.test(constructed)
		? parseHttp(constructed)
		: new URL(constructed, browserOrigin ?? "https://sdk.invalid");
	if (
		absolute &&
		knownOrigin &&
		parsed.origin !== knownOrigin &&
		!allowed.has(parsed.origin)
	) {
		throw configError("Request origin is not trusted");
	}
	if (!absolute && base) {
		const prefix = new URL(
			base,
			browserOrigin ?? "https://sdk.invalid",
		).pathname.replace(/\/+$/, "");
		if (
			prefix &&
			parsed.pathname !== prefix &&
			!parsed.pathname.startsWith(`${prefix}/`)
		) {
			throw configError("Request path escapes baseUrl prefix");
		}
	}
	parsed.hash = "";
	const trusted =
		(knownOrigin !== undefined && parsed.origin === knownOrigin) ||
		allowed.has(parsed.origin) ||
		(!absolute && !knownOrigin);
	return {
		url: /^https?:\/\//i.test(constructed)
			? parsed.href
			: `${parsed.pathname}${parsed.search}`,
		trusted,
	};
}
