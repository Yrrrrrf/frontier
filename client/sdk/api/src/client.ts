import axios, { isAxiosError } from "axios";
import type {
	AxiosRequestConfig,
	AxiosResponse,
	InternalAxiosRequestConfig,
} from "axios";
import {
	createBrowserTokenStore,
	createMemoryTokenStore,
	DEMO_TOKEN,
	getDefaultBaseUrl,
	isValidAuthToken,
} from "./auth.ts";
import { ApiError, fromAxiosError, isApiError } from "./errors.ts";
import {
	discardData,
	isStreamBody,
	parseResponse,
	prepareBody,
	responseMode,
} from "./internal/body.ts";
import {
	configError,
	createScope,
	nonnegative,
	pause,
	retryAfter,
	throwIfAborted,
	waitFor,
} from "./internal/control.ts";
import { mergeHeaders, toAxiosHeaders } from "./internal/headers.ts";
import { resolveUrl, validateBase, validateOrigins } from "./internal/url.ts";
import { validateResponse } from "./validation.ts";
import type {
	ApiClient,
	ApiClientOptions,
	Awaitable,
	HttpClient,
	QueryParams,
	RequestContext,
	RequestOptions,
} from "./types.ts";

export type { ApiClient, ApiClientOptions, RequestOptions } from "./types.ts";
export { ApiError, getAxiosError, isAbortError, isApiError } from "./errors.ts";
export { DEMO_TOKEN } from "./auth.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const isTransient = (error: ApiError) =>
	error.code === "NETWORK_ERROR" ||
	(error.code === "HTTP_ERROR" &&
		(error.status === 408 || error.status === 429 || error.status >= 500));
const attemptState: unique symbol = Symbol("sdk-api-attempt");
// A class instance survives Axios's config merging by identity. Plain objects are deep-cloned.
class AttemptState {
	attempt = 0;
	signal!: AbortSignal;
	skipAuth = false;
	sentToken: string | null = null;
	sentRevision = 0;
	sentSession = 0;
	managedAuth = false;
	context?: RequestContext;
}
type InternalConfig = InternalAxiosRequestConfig & {
	[attemptState]?: AttemptState;
};

function retryCount(value: number): number {
	nonnegative(value, "retries");
	if (!Number.isInteger(value) || value > 20) {
		throw configError("retries must be an integer between 0 and 20");
	}
	return value;
}

/** Own one Axios instance and one auth/refresh lifecycle per SSR request or browser session. */
export function createApiClient(
	configuration: ApiClientOptions = {},
): ApiClient {
	const options = { ...configuration };
	if (
		options.baseUrl !== undefined &&
		options.baseURL !== undefined &&
		options.baseUrl !== options.baseURL
	) {
		throw configError("Use baseUrl or baseURL, not conflicting values");
	}
	const baseUrl = validateBase(
		options.baseURL ?? options.baseUrl ?? getDefaultBaseUrl(),
	);
	const allowed = validateOrigins(options.allowedOrigins ?? []);
	const timeoutMs = nonnegative(options.timeoutMs ?? 15_000, "timeoutMs");
	const defaultLimit = nonnegative(
		options.maxResponseBytes ?? 10 * 1024 * 1024,
		"maxResponseBytes",
	);
	const retries = retryCount(options.retries ?? 2);
	const retryDelayMs = nonnegative(options.retryDelayMs ?? 200, "retryDelayMs");
	const maxRetryDelayMs = nonnegative(
		options.maxRetryDelayMs ?? 5_000,
		"maxRetryDelayMs",
	);
	const refreshTimeoutMs = nonnegative(
		options.refreshTimeoutMs ?? 10_000,
		"refreshTimeoutMs",
	);
	const store = options.tokenStore ?? createMemoryTokenStore();
	const owner = new AbortController();
	const listeners = new Set<
		(
			error: ApiError,
			context: { readonly authVersion: number },
		) => Awaitable<void>
	>();
	let revision = 0;
	let sessionRevision = 0;
	let observedToken: string | null = null;
	let refreshing: Promise<string | null> | undefined;

	const getAuthToken = () => {
		let current: string | null;
		try {
			current = store.get();
		} catch (cause) {
			throw configError("Token store read failed", cause);
		}
		if (current !== null && !isValidAuthToken(current)) {
			throw configError("Token store returned an invalid token");
		}
		if (observedToken !== current) {
			observedToken = current;
			revision++;
			sessionRevision++;
		}
		return current;
	};
	const writeToken = (token: string | null, fromRefresh = false) => {
		if (token !== null && !isValidAuthToken(token)) {
			throw configError("Invalid auth token");
		}
		try {
			store.set(token);
		} catch (cause) {
			throw configError("Token store write failed", cause);
		}
		observedToken = token;
		revision++;
		if (!fromRefresh) sessionRevision++;
	};
	const setAuthToken = (token: string | null) => writeToken(token);
	const notifyUnauthorized = (error: ApiError) => {
		const context = Object.freeze({ authVersion: sessionRevision });
		for (const listener of listeners) {
			try {
				void Promise.resolve(listener(error, context)).catch(() => {});
			} catch {
				/* Observer only. */
			}
		}
	};

	const {
		baseUrl: _base,
		fetch: injectedFetch,
		headers: defaultHeaders,
		credentials,
		timeoutMs: _timeout,
		maxResponseBytes: _limit,
		tokenStore: _store,
		allowedOrigins: _origins,
		retries: _retries,
		retryDelayMs: _delay,
		maxRetryDelayMs: _maxDelay,
		retryJitter: _jitter,
		replayMutations: _replay,
		beforeRequest: _before,
		afterResponse: _after,
		onError: _error,
		refreshToken: _refresh,
		refreshTimeoutMs: _refreshTimeout,
		...nativeDefaults
	} = options;
	const nativeRequestTransforms = Array.isArray(axios.defaults.transformRequest)
		? axios.defaults.transformRequest
		: axios.defaults.transformRequest
			? [axios.defaults.transformRequest]
			: [];
	// Axios supports null constructors at runtime; its declarations omit null.
	const fetchEnvironment = injectedFetch
		? ({
				...options.env,
				fetch: injectedFetch,
				Request: null,
				Response: globalThis.Response,
			} as unknown as NonNullable<AxiosRequestConfig["env"]>)
		: undefined;
	const instance = axios.create({
		...nativeDefaults,
		baseURL: baseUrl,
		headers: toAxiosHeaders(defaultHeaders),
		timeout: options.timeout ?? 0,
		maxRedirects: options.maxRedirects ?? 0,
		maxContentLength:
			options.maxContentLength ?? (defaultLimit === 0 ? -1 : defaultLimit),
		maxBodyLength: options.maxBodyLength ?? 10 * 1024 * 1024,
		paramsSerializer: options.paramsSerializer ?? { indexes: null },
		transformRequest: options.transformRequest ?? [
			prepareBody,
			...nativeRequestTransforms,
		],
		transformResponse: options.transformResponse ?? [parseResponse],
		transitional: {
			clarifyTimeoutError: true,
			forcedJSONParsing: false,
			validateStatusUndefinedResolves: false,
			...options.transitional,
		},
		...(options.adapter !== undefined
			? { adapter: options.adapter }
			: injectedFetch
				? { adapter: "fetch" }
				: {}),
		...(fetchEnvironment ? { env: fetchEnvironment } : {}),
		...(credentials !== undefined && options.withCredentials === undefined
			? { withCredentials: credentials === "include" }
			: {}),
		fetchOptions: { redirect: "error", ...options.fetchOptions },
	});

	// Registered once. Default Axios LIFO ordering puts subsequently added request hooks before this guard.
	const authInterceptor = instance.interceptors.request.use(
		async (rawConfig) => {
			const config = rawConfig as InternalConfig;
			const state = config[attemptState];
			throwIfAborted(owner.signal);
			if (state) throwIfAborted(state.signal);
			try {
				const uri = instance.getUri(config);
				const destination = resolveUrl(baseUrl, uri, allowed);
				const headers = config.headers;
				if (
					!destination.trusted &&
					(headers.has("Authorization") ||
						headers.has("Cookie") ||
						config.auth ||
						config.withCredentials === true)
				) {
					throw configError(
						"Credentials require a trusted baseURL or allowedOrigins",
					);
				}
				const token = state?.skipAuth ? null : getAuthToken();
				if (state) {
					state.sentToken = token;
					state.sentRevision = revision;
					state.sentSession = sessionRevision;
				}
				if (
					!state?.skipAuth &&
					destination.trusted &&
					!config.auth &&
					!headers.has("Authorization") &&
					token &&
					token !== DEMO_TOKEN
				) {
					headers.set("Authorization", `Bearer ${token}`);
					if (state) state.managedAuth = true;
				}
				const context: RequestContext = {
					url: uri,
					method: (config.method ?? "GET").toUpperCase(),
					attempt: state?.attempt ?? 1,
					headers,
					signal: state?.signal ?? owner.signal,
				};
				if (state) state.context = context;
				if (options.beforeRequest) {
					await waitFor(
						Promise.resolve().then(() => options.beforeRequest!(context)),
						context.signal,
					);
				}
				if (
					!destination.trusted &&
					(headers.has("Authorization") || headers.has("Cookie"))
				) {
					throw configError(
						"Header hook added credentials for an untrusted origin",
					);
				}
				if (state) {
					state.managedAuth =
						state.managedAuth &&
						headers.get("Authorization") === `Bearer ${state.sentToken}`;
				}
				return config;
			} catch (cause) {
				if (state) throwIfAborted(state.signal);
				throw isApiError(cause)
					? cause
					: configError("Axios request interceptor failed", cause);
			}
		},
	);

	const refresh = (): Promise<string | null> => {
		if (refreshing) return refreshing;
		const token = getAuthToken();
		const atRevision = revision;
		const scope = createScope(undefined, owner.signal, refreshTimeoutMs);
		const promise = waitFor(
			Promise.resolve().then(() =>
				options.refreshToken!({ token, signal: scope.signal }),
			),
			scope.signal,
		)
			.then((nextToken) => {
				throwIfAborted(scope.signal);
				const current = getAuthToken();
				if (revision !== atRevision) return current;
				if (nextToken !== null) writeToken(nextToken, true);
				return nextToken;
			})
			.finally(() => {
				scope.close();
				if (refreshing === promise) refreshing = undefined;
			});
		refreshing = promise;
		return promise;
	};

	async function execute<T, B = unknown, P extends object = QueryParams>(
		path: string,
		input: RequestOptions<B, P, T> = {},
	): Promise<AxiosResponse<unknown, B, {}, P>> {
		const budget = nonnegative(input.timeoutMs ?? timeoutMs, "timeoutMs");
		const scope = createScope(input.signal, owner.signal, budget);
		const startedAt = Date.now();
		let url = "";
		let method = "GET";
		let attempt = 0;
		try {
			throwIfAborted(scope.signal);
			const {
				body,
				data,
				bodyFactory,
				bodyEncoding = "auto",
				responseType = "auto",
				validate,
				skipAuth = false,
				skipRefresh = false,
				method: requestedMethod,
				headers,
				signal: _signal,
				timeoutMs: _budget,
				retries: _retries,
				retryDelayMs: _delay,
				maxRetryDelayMs: _maxDelay,
				retryJitter: _jitter,
				replayMutations: _replay,
				maxResponseBytes,
				credentials,
				redirect,
				...nativeConfig
			} = input;
			method = (requestedMethod ?? "GET").toUpperCase();
			if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(method)) {
				throw configError("Invalid HTTP method");
			}
			if (
				(body !== undefined && data !== undefined) ||
				(bodyFactory && (body !== undefined || data !== undefined))
			) {
				throw configError("Use exactly one of body, data or bodyFactory");
			}
			if (
				(method === "GET" || method === "HEAD") &&
				(body !== undefined || data !== undefined || bodyFactory)
			) {
				throw configError("GET and HEAD cannot have a body");
			}
			if (
				![
					"auto",
					"json",
					"text",
					"blob",
					"arraybuffer",
					"arrayBuffer",
					"stream",
					"document",
					"formdata",
				].includes(responseType)
			) {
				throw configError("Invalid responseType");
			}
			if (!["auto", "json", "raw"].includes(bodyEncoding)) {
				throw configError("Invalid bodyEncoding");
			}
			url = resolveUrl(baseUrl, path, allowed).url;
			const count = retryCount(input.retries ?? retries);
			const delay = nonnegative(
				input.retryDelayMs ?? retryDelayMs,
				"retryDelayMs",
			);
			const maxDelay = nonnegative(
				input.maxRetryDelayMs ?? maxRetryDelayMs,
				"maxRetryDelayMs",
			);
			const payload = body !== undefined ? body : data;
			const safeToReplay =
				(!isStreamBody(payload) || Boolean(bodyFactory)) &&
				(SAFE_METHODS.has(method) ||
					(input.replayMutations ?? options.replayMutations ?? false));
			const statusPolicy =
				input.validateStatus ??
				options.validateStatus ??
				((status) => status >= 200 && status < 300);
			const validateStatus = (status: number) => {
				const accepted = statusPolicy(status);
				if (typeof accepted !== "boolean") {
					throw configError("validateStatus must return a boolean");
				}
				return accepted;
			};
			let retried = 0;
			let authReplayed = false;
			for (;;) {
				throwIfAborted(scope.signal);
				attempt++;
				const state = Object.assign(new AttemptState(), {
					attempt,
					signal: scope.signal,
					skipAuth,
					sentRevision: revision,
					sentSession: sessionRevision,
				});
				let response: AxiosResponse<unknown, B, {}, P> | undefined;
				let afterRan = false;
				const after = async (value: AxiosResponse<unknown>) => {
					afterRan = true;
					if (options.afterResponse && state.context) {
						try {
							await waitFor(
								Promise.resolve().then(() =>
									options.afterResponse!({
										...state.context!,
										response: value,
									}),
								),
								scope.signal,
							);
						} catch (cause) {
							throwIfAborted(scope.signal);
							throw configError("afterResponse failed", cause);
						}
					}
				};
				try {
					let outgoing = payload;
					if (bodyFactory) {
						try {
							outgoing = bodyFactory();
						} catch (cause) {
							throw configError("bodyFactory failed", cause);
						}
					}
					const requestHeaders = mergeHeaders(defaultHeaders, headers);
					if (bodyEncoding === "json") {
						requestHeaders.setContentType("application/json", true);
						if (typeof outgoing === "string") {
							outgoing = JSON.stringify(outgoing) as B;
						}
					}
					if (
						bodyEncoding === "raw" &&
						outgoing !== undefined &&
						!isStreamBody(outgoing) &&
						typeof outgoing === "object" &&
						outgoing !== null &&
						!ArrayBuffer.isView(outgoing) &&
						!(outgoing instanceof ArrayBuffer) &&
						!(typeof Blob !== "undefined" && outgoing instanceof Blob) &&
						!(
							typeof FormData !== "undefined" && outgoing instanceof FormData
						) &&
						!(outgoing instanceof URLSearchParams)
					) {
						throw configError(
							"raw body requires a transport-supported representation",
						);
					}
					const config: AxiosRequestConfig<B, P> & {
						[attemptState]: AttemptState;
						[responseMode]: string;
					} = {
						...nativeConfig,
						url,
						baseURL: "",
						method,
						headers: requestHeaders,
						validateStatus,
						signal:
							responseType === "stream"
								? AbortSignal.any([
										scope.signal,
										input.signal ?? scope.signal,
										owner.signal,
									])
								: scope.signal,
						responseType:
							responseType === "auto"
								? "text"
								: responseType === "arrayBuffer"
									? "arraybuffer"
									: responseType,
						[responseMode]: responseType,
						[attemptState]: state,
						...(outgoing === undefined ? {} : { data: outgoing }),
						...(maxResponseBytes === undefined
							? {}
							: {
									maxContentLength:
										nonnegative(maxResponseBytes, "maxResponseBytes") === 0
											? -1
											: maxResponseBytes,
								}),
						...(credentials !== undefined && input.withCredentials === undefined
							? { withCredentials: credentials === "include" }
							: {}),
						fetchOptions: {
							...instance.defaults.fetchOptions,
							...input.fetchOptions,
							...(redirect ? { redirect } : {}),
						},
					};
					if (bodyEncoding === "raw" && !input.transformRequest) {
						config.transformRequest = [prepareBody, (value) => value];
					}
					const pending = instance.request<
						unknown,
						AxiosResponse<unknown, B, {}, P>,
						B,
						P
					>(config);
					void pending.then(
						(late) => {
							if (scope.signal.aborted) discardData(late.data);
						},
						() => {},
					);
					response = await waitFor(pending, scope.signal);
					throwIfAborted(scope.signal);
					await after(response);
					if (
						responseType === "arrayBuffer" &&
						ArrayBuffer.isView(response.data)
					) {
						const view = response.data;
						response.data = new Uint8Array(
							view.buffer,
							view.byteOffset,
							view.byteLength,
						).slice().buffer;
					}
					if (validate) {
						try {
							response.data = await waitFor(
								validateResponse(validate, response.data),
								scope.signal,
							);
						} catch (cause) {
							throwIfAborted(scope.signal);
							throw new ApiError(
								response.status,
								"Response validation failed",
								response.data,
								url,
								{
									code: "VALIDATION_ERROR",
									method,
									attempt,
									headers: response.headers,
									cause,
								},
							);
						}
					}
					return response;
				} catch (cause) {
					if (response) discardData(response.data);
					throwIfAborted(scope.signal);
					let finalCause: unknown = cause;
					if (!afterRan && isAxiosError(cause) && cause.response) {
						try {
							await after(cause.response);
						} catch (hookError) {
							finalCause = hookError;
						}
					}
					const error = fromAxiosError(
						finalCause,
						state.context?.url ?? url,
						method,
						attempt,
					);
					discardData(error.data);
					if (error.status === 401 && !skipAuth) {
						const current = getAuthToken();
						const unchanged =
							revision === state.sentRevision && current === state.sentToken;
						if (
							!skipRefresh &&
							!authReplayed &&
							safeToReplay &&
							state.managedAuth &&
							options.refreshToken &&
							state.sentSession === sessionRevision
						) {
							authReplayed = true;
							let token: string | null = current;
							if (unchanged) {
								try {
									token = await waitFor(refresh(), scope.signal);
								} catch {
									throwIfAborted(scope.signal);
									token = null;
								}
							}
							if (
								token &&
								token !== DEMO_TOKEN &&
								state.sentSession === sessionRevision
							) {
								continue;
							}
						}
						if (
							getAuthToken() === state.sentToken &&
							revision === state.sentRevision &&
							state.sentSession === sessionRevision
						) {
							notifyUnauthorized(error);
						}
						throw error;
					}
					if (!safeToReplay || !isTransient(error) || retried >= count) {
						throw error;
					}
					const serverDelay = retryAfter(
						String(error.headers.get("Retry-After") ?? "") || null,
					);
					const exponential = Math.min(maxDelay, delay * 2 ** retried);
					const wait =
						serverDelay ??
						((input.retryJitter ?? options.retryJitter ?? true)
							? Math.random() * exponential
							: exponential);
					if (
						wait > maxDelay ||
						(budget > 0 && wait >= budget - (Date.now() - startedAt))
					) {
						throw error;
					}
					retried++;
					await pause(wait, scope.signal);
				}
			}
		} catch (cause) {
			const error = fromAxiosError(cause, url, method, attempt);
			if (options.onError && !scope.signal.aborted) {
				try {
					await waitFor(
						Promise.resolve().then(() => options.onError!(error)),
						scope.signal,
					);
				} catch {
					/* Observer only. */
				}
			}
			throw error;
		} finally {
			scope.close();
		}
	}

	async function request<T, B = unknown, P extends object = QueryParams>(
		path: string,
		input?: RequestOptions<B, P, T>,
	): Promise<T> {
		return (await execute(path, input)).data as T;
	}
	async function requestResponse<
		T,
		B = unknown,
		P extends object = QueryParams,
	>(
		path: string,
		input?: RequestOptions<B, P, T>,
	): Promise<AxiosResponse<T, B, {}, P>> {
		return (await execute(path, input)) as AxiosResponse<T, B, {}, P>;
	}
	const http: HttpClient = {
		get: (path, input) => request(path, { ...input, method: "GET" }),
		head: (path, input) =>
			requestResponse<void>(path, { ...input, method: "HEAD" }),
		options: (path, input) => request(path, { ...input, method: "OPTIONS" }),
		post: (path, body, input) =>
			request(path, {
				...input,
				...(body === undefined ? {} : { body }),
				method: "POST",
			}),
		put: (path, body, input) =>
			request(path, {
				...input,
				...(body === undefined ? {} : { body }),
				method: "PUT",
			}),
		patch: (path, body, input) =>
			request(path, {
				...input,
				...(body === undefined ? {} : { body }),
				method: "PATCH",
			}),
		delete: (path, input) => request(path, { ...input, method: "DELETE" }),
	};
	return {
		request,
		requestResponse,
		axios: instance,
		http,
		getAuthToken,
		setAuthToken,
		get authVersion() {
			getAuthToken();
			return sessionRevision;
		},
		isDemoMode: () => getAuthToken() === DEMO_TOKEN,
		onUnauthorized(callback) {
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
			};
		},
		dispose() {
			if (owner.signal.aborted) return;
			owner.abort();
			listeners.clear();
			instance.interceptors.request.eject(authInterceptor);
			// Leave a lightweight closed-owner guard for exposed native calls.
			instance.interceptors.request.use(() => {
				throwIfAborted(owner.signal);
				throw configError("Client disposed");
			});
		},
	};
}

export const defaultClient = createApiClient({
	tokenStore:
		typeof window === "undefined"
			? createMemoryTokenStore()
			: createBrowserTokenStore(),
});
export const request = defaultClient.request;
export const requestResponse = defaultClient.requestResponse;
export const http = defaultClient.http;
export const axiosClient = defaultClient.axios;
export const setAuthToken = defaultClient.setAuthToken;
export const getAuthToken = defaultClient.getAuthToken;
export const onUnauthorized = defaultClient.onUnauthorized;
export const isDemoMode = defaultClient.isDemoMode;
