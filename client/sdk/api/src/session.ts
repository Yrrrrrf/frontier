import {
	createAuthApi,
	type AuthApiOptions,
	type AuthRequestOptions,
	type LoginCredentials,
	type LoginResponse,
} from "./endpoints.ts";
import type { ApiClient, Awaitable } from "./types.ts";

/** Structural sink: no runtime dependency on @sdk/state or React. */
export interface SessionState<TIdentity> {
	readonly identity: TIdentity | null;
	readonly namespace: string | null;
	readonly status:
		| "anonymous"
		| "authenticating"
		| "restoring"
		| "authenticated"
		| "error";
	readonly error: unknown;
}
export interface SessionSink<TIdentity> {
	getSnapshot(): SessionState<TIdentity>;
	setState(state: SessionState<TIdentity>): void;
}
export interface SessionControllerOptions<TIdentity> {
	client: ApiClient;
	store: SessionSink<TIdentity>;
	auth?: Omit<AuthApiOptions<TIdentity>, "persistToken">;
	/** Opaque app user/scope key; never use the raw access token. */
	getNamespace?(identity: TIdentity, scope: string | null): string;
	scope?: string | null;
	/** Awaited before enabling authenticated reads. Cancel queries and clear sensitive caches here. */
	beforeSessionChange?(change: {
		previous: SessionState<TIdentity>;
		next: SessionState<TIdentity>;
		signal: AbortSignal;
	}): Awaitable<void>;
	/** Observer for failures of automatic unauthorized cleanup. */
	onLifecycleError?(error: unknown): void;
}
export function createSessionController<TIdentity>(
	options: SessionControllerOptions<TIdentity>,
) {
	const { client, store } = options;
	const auth = createAuthApi<TIdentity>(client, {
		...options.auth,
		persistToken: false,
	});
	let scope = options.scope ?? null;
	let generation = 0;
	let disposed = false;
	let work: AbortController | null = null;
	const anonymous = (
		status: SessionState<TIdentity>["status"] = "anonymous",
		error: unknown = null,
	): SessionState<TIdentity> => ({
		identity: null,
		namespace: null,
		status,
		error,
	});
	const abortError = () =>
		new DOMException("Session operation superseded", "AbortError");
	const invalidate = () => {
		generation++;
		work?.abort();
		work = null;
	};
	const begin = (signal?: AbortSignal | null) => {
		if (disposed) throw new Error("Session controller disposed");
		invalidate();
		work = new AbortController();
		return {
			generation,
			controller: work,
			signal: signal ? AbortSignal.any([work.signal, signal]) : work.signal,
			version: client.authVersion,
		};
	};
	const owned = (operation: ReturnType<typeof begin>) =>
		!disposed &&
		operation.generation === generation &&
		operation.version === client.authVersion;
	const active = (operation: ReturnType<typeof begin>) =>
		owned(operation) && !operation.signal.aborted;
	const guard = (operation: ReturnType<typeof begin>) => {
		if (!active(operation)) throw abortError();
	};
	const cleanup = async (
		previous: SessionState<TIdentity>,
		next: SessionState<TIdentity>,
		operation: ReturnType<typeof begin>,
	) => {
		if (previous.namespace !== next.namespace)
			await options.beforeSessionChange?.({
				previous,
				next,
				signal: operation.signal,
			});
		guard(operation);
	};
	const commit = async (
		identity: TIdentity,
		operation: ReturnType<typeof begin>,
		token?: string,
	) => {
		guard(operation);
		const previous = store.getSnapshot();
		const next: SessionState<TIdentity> = {
			identity,
			namespace:
				options.getNamespace?.(identity, scope) ??
				previous.namespace ??
				`session:${generation}`,
			status: "authenticated",
			error: null,
		};
		await cleanup(previous, next, operation);
		if (token !== undefined) client.setAuthToken(token);
		store.setState(next);
		work = null;
	};
	const fail = async (error: unknown, operation: ReturnType<typeof begin>) => {
		if (!owned(operation)) return;
		const previous = store.getSnapshot();
		const next = anonymous("error", error);
		store.setState(next);
		try {
			await cleanup(previous, next, operation);
		} catch (cleanupError) {
			if (
				!(
					cleanupError instanceof DOMException &&
					cleanupError.name === "AbortError"
				)
			)
				options.onLifecycleError?.(cleanupError);
		} finally {
			if (owned(operation)) work = null;
		}
	};
	const clear = async () => {
		const previous = store.getSnapshot();
		const operation = begin();
		client.setAuthToken(null);
		operation.version = client.authVersion;
		const next = anonymous();
		store.setState(next);
		await cleanup(previous, next, operation);
		work = null;
	};
	const unsubscribe = client.onUnauthorized((_error, context) => {
		// Transport captures the affected generation before invoking any observers.
		if (disposed || context.authVersion !== client.authVersion) return;
		void clear().catch((error) => {
			if (error instanceof DOMException && error.name === "AbortError") return;
			options.onLifecycleError?.(error);
		});
	});
	return {
		async login(
			credentials: LoginCredentials,
			input: AuthRequestOptions<LoginResponse<TIdentity>> = {},
		) {
			const previous = store.getSnapshot();
			const operation = begin(input.signal);
			client.setAuthToken(null);
			operation.version = client.authVersion;
			const pending = anonymous("authenticating");
			store.setState(pending);
			try {
				await cleanup(previous, pending, operation);
				const result = await auth.login(credentials, {
					...input,
					signal: operation.signal,
				});
				await commit(result.userData, operation, result.token);
				return result.userData;
			} catch (error) {
				await fail(error, operation);
				throw error;
			}
		},
		async restore(input: AuthRequestOptions<TIdentity> = {}) {
			const operation = begin(input.signal);
			if (!client.getAuthToken()) {
				await clear();
				return null;
			}
			store.setState({
				...store.getSnapshot(),
				status: "restoring",
				error: null,
			});
			try {
				const identity = await auth.me({ ...input, signal: operation.signal });
				await commit(identity, operation);
				return identity;
			} catch (error) {
				await fail(error, operation);
				throw error;
			}
		},
		async logout(input: AuthRequestOptions<void> = {}) {
			const previous = store.getSnapshot();
			const operation = begin(input.signal);
			// Auth API captures the old token and clears it synchronously, before its first await.
			const remote = auth.logout({ ...input, signal: operation.signal });
			operation.version = client.authVersion;
			const next = anonymous();
			store.setState(next);
			// Settle both so a failing server or cache hook never creates an unhandled rejection.
			const results = await Promise.allSettled([
				remote,
				cleanup(previous, next, operation),
			]);
			if (active(operation)) work = null;
			for (const result of results)
				if (result.status === "rejected") throw result.reason;
		},
		async setScope(nextScope: string | null) {
			if (!options.getNamespace)
				throw new Error("setScope requires getNamespace");
			if (nextScope === scope) return;
			const previous = store.getSnapshot();
			const operation = begin();
			scope = nextScope;
			if (previous.identity === null) {
				work = null;
				store.setState(anonymous());
				return;
			}
			store.setState({ ...previous, status: "restoring", error: null });
			try {
				await commit(previous.identity, operation);
			} catch (error) {
				await fail(error, operation);
				throw error;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			invalidate();
			unsubscribe();
		},
	};
}
