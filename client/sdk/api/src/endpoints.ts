import { DEMO_TOKEN, isDemoAllowed, isValidAuthToken } from "./auth.ts";
import { defaultClient } from "./client.ts";
import { configError, throwIfAborted } from "./internal/control.ts";
import { toAxiosHeaders } from "./internal/headers.ts";
import type { ApiClient, RequestOptions, ResponseValidator } from "./types.ts";

export { isDemoAllowed } from "./auth.ts";

export interface AuthUser {
	wiw: string;
	displayName: string;
	email: string;
	isAdmin: boolean;
}

export interface LoginCredentials {
	user: string;
	pwd: string;
}
export interface LoginResponse<TUser = AuthUser> {
	token: string;
	userData: TUser;
}
export type AuthRequestOptions<T = unknown> = Omit<
	RequestOptions<unknown, never, T>,
	"body" | "data" | "bodyFactory" | "method" | "params" | "paramsSerializer"
>;

export interface AuthApiOptions<TUser> {
	loginPath?: string;
	mePath?: string;
	logoutPath?: string;
	validateLogin?: ResponseValidator<LoginResponse<TUser>>;
	validateUser?: ResponseValidator<TUser>;
	/** Defaults to true; false supports applications that manage login state separately. */
	persistToken?: boolean;
	/** Explicit local demo policy. Still disabled by production environment detection. */
	demo?: { credentials: LoginCredentials; user: TUser };
}

const demoUser: AuthUser = {
	wiw: "ADMIN",
	displayName: "Administrador de Prueba",
	email: "admin.test@corp.internal",
	isAdmin: true,
};

function parseAuthUser(input: unknown): AuthUser {
	if (
		!input ||
		typeof input !== "object" ||
		!("wiw" in input) ||
		typeof input.wiw !== "string" ||
		!("displayName" in input) ||
		typeof input.displayName !== "string" ||
		!("email" in input) ||
		typeof input.email !== "string" ||
		!("isAdmin" in input) ||
		typeof input.isAdmin !== "boolean"
	) {
		throw new TypeError("Invalid AuthUser");
	}
	return {
		wiw: input.wiw,
		displayName: input.displayName,
		email: input.email,
		isAdmin: input.isAdmin,
	};
}

function defaultLoginValidator(input: unknown): LoginResponse {
	if (
		!input ||
		typeof input !== "object" ||
		!("token" in input) ||
		!isValidAuthToken(input.token) ||
		!("userData" in input)
	) {
		throw new TypeError("Invalid LoginResponse");
	}
	return { token: input.token, userData: parseAuthUser(input.userData) };
}

/** Generic auth contracts can be replaced without changing the transport or global endpoint object. */
export function createAuthApi<TUser = AuthUser>(
	client: ApiClient = defaultClient,
	settings: AuthApiOptions<TUser> = {},
) {
	let action = 0;
	const assertToken = (result: LoginResponse<TUser>) => {
		if (!result || !isValidAuthToken(result.token)) {
			throw configError("Login response has an invalid token");
		}
	};
	return {
		async login(
			credentials: LoginCredentials,
			input: AuthRequestOptions<LoginResponse<TUser>> = {},
		): Promise<LoginResponse<TUser>> {
			if (
				!credentials ||
				typeof credentials.user !== "string" ||
				typeof credentials.pwd !== "string"
			) {
				throw configError("Invalid login credentials");
			}
			if (input.signal) throwIfAborted(input.signal);
			const activeAction = ++action;
			const session = client.authVersion;
			const demo = settings.demo;
			let result: LoginResponse<TUser>;
			if (
				demo &&
				isDemoAllowed() &&
				credentials.user.trim().toUpperCase() ===
					demo.credentials.user.trim().toUpperCase() &&
				credentials.pwd === demo.credentials.pwd
			) {
				result = { token: DEMO_TOKEN, userData: demo.user };
			} else {
				result = await client.http.post<LoginResponse<TUser>, LoginCredentials>(
					settings.loginPath ?? "/api/Auth/login",
					credentials,
					{
						...input,
						skipAuth: true,
						skipRefresh: true,
						retries: 0,
						replayMutations: false,
						...(settings.validateLogin
							? { validate: settings.validateLogin }
							: {}),
					},
				);
			}
			assertToken(result);
			if (
				settings.persistToken !== false &&
				activeAction === action &&
				client.authVersion === session
			) {
				client.setAuthToken(result.token);
			}
			return result;
		},
		async me(input: AuthRequestOptions<TUser> = {}): Promise<TUser> {
			if (input.signal) throwIfAborted(input.signal);
			if (settings.demo && isDemoAllowed() && client.isDemoMode()) {
				return settings.demo.user;
			}
			return client.http.get<TUser>(settings.mePath ?? "/api/Auth/me", {
				...input,
				...(settings.validateUser ? { validate: settings.validateUser } : {}),
			});
		},
		async logout(input: AuthRequestOptions<void> = {}): Promise<void> {
			action++;
			const token = client.getAuthToken();
			// Invalidate refresh/login immediately, without waiting for the server to acknowledge logout.
			client.setAuthToken(null);
			if (token !== DEMO_TOKEN) {
				const headers = toAxiosHeaders(input.headers);
				if (token && !headers.has("Authorization")) {
					headers.set("Authorization", `Bearer ${token}`);
				}
				await client.http.post<void>(
					settings.logoutPath ?? "/api/Auth/logout",
					undefined,
					{
						...input,
						headers,
						skipAuth: true,
						skipRefresh: true,
						retries: 0,
						replayMutations: false,
					},
				);
			}
		},
	};
}

/** Original endpoint path and credentials stay compatible; demo bypass is production-gated. */
export const api = {
	auth: createAuthApi(defaultClient, {
		demo: { credentials: { user: "ADMIN", pwd: "admin" }, user: demoUser },
		validateLogin: defaultLoginValidator,
		validateUser: parseAuthUser,
	}),
};
