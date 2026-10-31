import type { TokenStore } from "./types.ts";

/** Compatibility value; demo tokens are never forwarded to a backend. */
export const DEMO_TOKEN = "demo-admin-token-jwt-secret";

export function isValidAuthToken(token: unknown): token is string {
	return (
		typeof token === "string" && token.length > 0 && !/[^\x21-\x7e]/.test(token)
	);
}

export function createMemoryTokenStore(
	initialToken: string | null = null,
): TokenStore {
	let token = initialToken;
	return {
		get: () => token,
		set: (value) => {
			token = value;
		},
	};
}

/** Lazy browser access: denied storage falls back to memory; reads observe other tabs. */
export function createBrowserTokenStore(
	key = "auth_token",
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): TokenStore {
	let memory: string | null = null;
	let failed = false;
	const target = () =>
		storage ??
		(typeof window === "undefined" ? undefined : window.localStorage);
	return {
		get() {
			if (!failed) {
				try {
					const current = target();
					if (current) memory = current.getItem(key);
				} catch {
					failed = true;
				}
			}
			return memory;
		},
		set(token) {
			memory = token;
			if (!failed) {
				try {
					const current = target();
					if (token === null) current?.removeItem(key);
					else current?.setItem(key, token);
				} catch {
					failed = true;
				}
			}
		},
	};
}

interface ViteEnv {
	DEV?: boolean;
	PROD?: boolean;
	MODE?: string;
	VITE_ENABLE_DEMO_MODE?: string;
	VITE_API_ORIGIN?: string;
	VITE_BASE_API_URL?: string;
}

function environments() {
	const vite = (import.meta as ImportMeta & { env?: ViteEnv }).env;
	const node = (
		globalThis as typeof globalThis & {
			process?: { env?: Record<string, string | undefined> };
		}
	).process?.env;
	return { vite, node };
}

/** A production environment always wins over development/demo flags. */
export function isDemoAllowed(): boolean {
	const { vite, node } = environments();
	if (
		vite?.PROD ||
		vite?.MODE === "production" ||
		node?.NODE_ENV === "production"
	) {
		return false;
	}
	return (
		vite?.DEV === true ||
		vite?.VITE_ENABLE_DEMO_MODE === "true" ||
		node?.NODE_ENV === "test" ||
		node?.VITE_ENABLE_DEMO_MODE === "true"
	);
}

export function getDefaultBaseUrl(): string {
	const { vite, node } = environments();
	const configured =
		vite?.VITE_API_ORIGIN ||
		vite?.VITE_BASE_API_URL ||
		node?.VITE_API_ORIGIN ||
		node?.VITE_BASE_API_URL;
	// Compatibility: legacy environment settings describe an origin; built-in routes include /api.
	// Explicit createApiClient({ baseUrl }) retains the complete prefix.
	return configured ? configured.replace(/\/+$/, "").replace(/\/api$/, "") : "";
}
