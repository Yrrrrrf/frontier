import type {
	AxiosHeaders,
	AxiosInstance,
	AxiosRequestConfig,
	AxiosResponse,
	InternalAxiosRequestConfig,
	RawAxiosRequestHeaders,
	ResponseType as AxiosResponseType,
} from "axios";

export type QueryScalar = string | number | boolean | Date | null | undefined;
export type QueryValue = QueryScalar | readonly QueryScalar[];
export type QueryParams =
	| Readonly<Record<string, QueryValue>>
	| URLSearchParams;
export type ResponseType = AxiosResponseType | "auto" | "arrayBuffer";
export type HeaderInput = HeadersInit | RawAxiosRequestHeaders | AxiosHeaders;
export type Awaitable<T> = T | PromiseLike<T>;

/** Structural bridge for ArkType, Zod 3/4, Valibot and parser functions. */
export type ResponseValidator<T> =
	| ((input: unknown) => Awaitable<T>)
	| { assert(input: unknown): T }
	| { parse(input: unknown): T; parseAsync?: (input: unknown) => Promise<T> };

export interface ApiResponse<T, TMeta = unknown> {
	data: T;
	meta?: TMeta;
}

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

export interface PaginationParams<TSortField extends string = string> {
	page?: number;
	perPage?: number;
	sort?: TSortField;
	order?: "asc" | "desc";
	search?: string;
}

export interface RetryOptions {
	/** Additional attempts; only safe methods are replayed unless explicitly authorized. */
	retries?: number;
	retryDelayMs?: number;
	maxRetryDelayMs?: number;
	retryJitter?: boolean;
	/** Server must support replay; the SDK does not infer idempotency from a header. */
	replayMutations?: boolean;
}

/** Stable config fields passed to Axios's XSRF decision callback. */
export type XsrfContext = Pick<
	InternalAxiosRequestConfig<unknown, object>,
	| "url"
	| "baseURL"
	| "method"
	| "headers"
	| "data"
	| "params"
	| "withCredentials"
>;

export interface RequestOptions<
	TBody = unknown,
	TParams extends object = QueryParams,
	TResponse = unknown,
> extends Omit<
			AxiosRequestConfig<TBody, TParams>,
			| "url"
			| "baseURL"
			| "data"
			| "headers"
			| "signal"
			| "cancelToken"
			| "responseType"
			| "params"
			| "paramsSerializer"
			| "withXSRFToken"
		>,
		RetryOptions {
	params?: TParams;
	paramsSerializer?: NonNullable<
		AxiosRequestConfig<TBody, TParams>["paramsSerializer"]
	>;
	withXSRFToken?: boolean | ((config: XsrfContext) => boolean | undefined);
	headers?: HeaderInput;
	body?: TBody;
	/** Axios-native alias; use body or data, never both. */
	data?: TBody;
	/** Used for fresh streams/forms on every attempt; mutually exclusive with body. */
	bodyFactory?: () => TBody;
	bodyEncoding?: "auto" | "json" | "raw";
	/** Entire operation, including hooks, body parsing, refresh waits and backoff. 0 disables. */
	timeoutMs?: number;
	signal?: AbortSignal | null;
	responseType?: ResponseType;
	validate?: ResponseValidator<TResponse>;
	validateStatus?: (status: number) => boolean;
	skipAuth?: boolean;
	skipRefresh?: boolean;
	/** Alias for maxContentLength; 0 disables the limit. Adapter enforcement differs. */
	maxResponseBytes?: number;
	/** Compatibility shorthand for withCredentials/fetchOptions.redirect. */
	credentials?: RequestCredentials;
	redirect?: RequestRedirect;
}

export interface TokenStore {
	get(): string | null;
	set(token: string | null): void;
}

export interface RequestContext {
	readonly url: string;
	readonly method: string;
	readonly attempt: number;
	readonly signal: AbortSignal;
	/** Mutable, per-attempt headers. */
	readonly headers: AxiosHeaders;
}

export interface ResponseContext extends RequestContext {
	readonly response: AxiosResponse<unknown>;
}

export interface RefreshContext {
	readonly token: string | null;
	readonly signal: AbortSignal;
}

export interface ApiClientOptions
	extends Omit<
			AxiosRequestConfig<unknown, QueryParams>,
			| "url"
			| "method"
			| "data"
			| "params"
			| "headers"
			| "signal"
			| "cancelToken"
			| "responseType"
			| "validateStatus"
		>,
		RetryOptions {
	/** An origin or path prefix. Explicit values preserve prefixes such as /v1. */
	baseUrl?: string;
	fetch?: typeof globalThis.fetch;
	headers?: HeaderInput;
	credentials?: RequestCredentials;
	timeoutMs?: number;
	maxResponseBytes?: number;
	tokenStore?: TokenStore;
	/** Additional trusted HTTP(S) origins; automatic auth is allowed for these too. */
	allowedOrigins?: readonly string[];
	validateStatus?: (status: number) => boolean;
	beforeRequest?: (context: RequestContext) => Awaitable<void>;
	/** Receives Axios's decoded envelope; do not consume stream data here. */
	afterResponse?: (context: ResponseContext) => Awaitable<void>;
	onError?: (error: import("./errors.ts").ApiError) => Awaitable<void>;
	/** Use a separate client, or skipAuth + skipRefresh, for the refresh endpoint. */
	refreshToken?: (context: RefreshContext) => Awaitable<string | null>;
	refreshTimeoutMs?: number;
}

export interface HttpClient {
	get<T, P extends object = QueryParams>(
		path: string,
		options?: RequestOptions<never, P, T>,
	): Promise<T>;
	head(
		path: string,
		options?: Omit<RequestOptions<never>, "validate" | "responseType">,
	): Promise<AxiosResponse<void>>;
	options<T = unknown>(
		path: string,
		options?: RequestOptions<never, QueryParams, T>,
	): Promise<T>;
	post<T, B = unknown, P extends object = QueryParams>(
		path: string,
		body?: B,
		options?: RequestOptions<B, P, T>,
	): Promise<T>;
	put<T, B = unknown, P extends object = QueryParams>(
		path: string,
		body?: B,
		options?: RequestOptions<B, P, T>,
	): Promise<T>;
	patch<T, B = unknown, P extends object = QueryParams>(
		path: string,
		body?: B,
		options?: RequestOptions<B, P, T>,
	): Promise<T>;
	delete<T = void, B = unknown>(
		path: string,
		options?: RequestOptions<B, QueryParams, T>,
	): Promise<T>;
}

export interface UnauthorizedContext {
	readonly authVersion: number;
}

export interface ApiClient {
	request<T, B = unknown, P extends object = QueryParams>(
		path: string,
		options?: RequestOptions<B, P, T>,
	): Promise<T>;
	requestResponse<T, B = unknown, P extends object = QueryParams>(
		path: string,
		options?: RequestOptions<B, P, T>,
	): Promise<AxiosResponse<T, B, {}, P>>;
	/** Owned native Axios instance. Native calls keep Axios envelopes/errors and omit SDK recovery. */
	readonly axios: AxiosInstance;
	readonly http: HttpClient;
	/** Session generation; explicit login/logout/store changes invalidate pending auth work. */
	readonly authVersion: number;
	getAuthToken(): string | null;
	setAuthToken(token: string | null): void;
	onUnauthorized(
		callback: (
			error: import("./errors.ts").ApiError,
			context: UnauthorizedContext,
		) => Awaitable<void>,
	): () => void;
	isDemoMode(): boolean;
	/** Cancels SDK requests and refresh; further SDK/native requests reject. */
	dispose(): void;
}
