import { defaultClient } from "./client.ts";
import { configError } from "./internal/control.ts";
import { mergeHeaders } from "./internal/headers.ts";
import type {
	ApiClient,
	PaginatedResponse,
	PaginationParams,
	QueryParams,
	RequestOptions,
	ResponseValidator,
} from "./types.ts";

export type ResourceId = string | number;
export type ResourceRequestOptions<P extends object = QueryParams> = Omit<
	RequestOptions<never, P>,
	| "body"
	| "data"
	| "bodyFactory"
	| "params"
	| "validate"
	| "method"
	| "responseType"
>;

export interface CrudResource<
	TEntity,
	TCreateDto = Partial<TEntity>,
	TUpdateDto = Partial<TEntity>,
	TSortField extends string = string,
	TList = PaginatedResponse<TEntity> | TEntity[],
	TParams extends PaginationParams<TSortField> = PaginationParams<TSortField>,
> {
	readonly basePath: string;
	list(
		params?: TParams,
		options?: ResourceRequestOptions<TParams>,
	): Promise<TList>;
	get(
		id: ResourceId,
		options?: ResourceRequestOptions<TParams>,
	): Promise<TEntity>;
	create(
		dto: TCreateDto,
		options?: ResourceRequestOptions<TParams>,
	): Promise<TEntity>;
	update(
		id: ResourceId,
		dto: TUpdateDto,
		options?: ResourceRequestOptions<TParams>,
	): Promise<TEntity>;
	patch(
		id: ResourceId,
		dto: Partial<TUpdateDto>,
		options?: ResourceRequestOptions<TParams>,
	): Promise<TEntity>;
	delete(
		id: ResourceId,
		options?: ResourceRequestOptions<TParams>,
	): Promise<void>;
}

export interface CrudOptions<TEntity, TList, P extends object = QueryParams> {
	client?: ApiClient;
	request?: ResourceRequestOptions<P>;
	validateEntity?: ResponseValidator<TEntity>;
	validateList?: ResponseValidator<TList>;
}

function idPath(base: string, id: ResourceId): string {
	if (
		(typeof id !== "string" && typeof id !== "number") ||
		id === "" ||
		(typeof id === "number" && !Number.isFinite(id)) ||
		id === "." ||
		id === ".."
	) {
		throw configError("Invalid resource ID");
	}
	return `${base}/${encodeURIComponent(String(id))}`;
}

/** DTO, sorting, filters, and exact list-envelope types remain application-owned. */
export function createCrud<
	TEntity,
	TCreateDto = Partial<TEntity>,
	TUpdateDto = Partial<TEntity>,
	TSortField extends string = string,
	TList = PaginatedResponse<TEntity> | TEntity[],
	TParams extends PaginationParams<TSortField> = PaginationParams<TSortField>,
>(
	basePath: string,
	options: CrudOptions<TEntity, TList, TParams> = {},
): CrudResource<TEntity, TCreateDto, TUpdateDto, TSortField, TList, TParams> {
	if (!basePath || /[?#]/.test(basePath) || basePath.startsWith("//")) {
		throw configError(
			"Resource path must not contain a query, fragment, or protocol-relative URL",
		);
	}
	const base = (
		/^https?:\/\//i.test(basePath) || basePath.startsWith("/")
			? basePath
			: `/${basePath}`
	).replace(/\/+$/, "");
	if (!base) throw configError("Resource path cannot be the root");
	const client = options.client ?? defaultClient;
	const common = (input?: ResourceRequestOptions<TParams>) => ({
		...options.request,
		...input,
		headers: mergeHeaders(options.request?.headers, input?.headers),
	});
	const entity = (input?: ResourceRequestOptions<TParams>) => ({
		...common(input),
		...(options.validateEntity ? { validate: options.validateEntity } : {}),
	});
	return {
		basePath: base,
		list(params, input) {
			return client.request<TList, never, TParams>(base, {
				method: "GET",
				...common(input),
				...(params === undefined ? {} : { params }),
				...(options.validateList ? { validate: options.validateList } : {}),
			});
		},
		get: (id, input) =>
			client.request<TEntity, never, TParams>(idPath(base, id), {
				...entity(input),
				method: "GET",
			}),
		create: (dto, input) =>
			client.request<TEntity, TCreateDto, TParams>(base, {
				...entity(input),
				body: dto,
				method: "POST",
			}),
		update: (id, dto, input) =>
			client.request<TEntity, TUpdateDto, TParams>(idPath(base, id), {
				...entity(input),
				body: dto,
				method: "PUT",
			}),
		patch: (id, dto, input) =>
			client.request<TEntity, Partial<TUpdateDto>, TParams>(idPath(base, id), {
				...entity(input),
				body: dto,
				method: "PATCH",
			}),
		async delete(id, input) {
			await client.request<unknown, never, TParams>(idPath(base, id), {
				...common(input),
				method: "DELETE",
			});
		},
	};
}
