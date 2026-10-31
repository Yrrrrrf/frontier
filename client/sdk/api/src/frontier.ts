import {
	createTaskRequestSchema,
	createTaskResponseSchema,
	taskResultSchema,
	type CreateTaskRequest,
	type CreateTaskResponse,
	type TaskResult,
} from "@sdk/core";
import { defaultClient } from "./client.ts";
import { configError } from "./internal/control.ts";
import type { ApiClient, RequestOptions } from "./types.ts";

export type FrontierRequestOptions<T = unknown, B = unknown> = Omit<
	RequestOptions<B, never, T>,
	| "body"
	| "data"
	| "bodyFactory"
	| "method"
	| "params"
	| "paramsSerializer"
	| "validate"
>;

function taskPath(taskId: string): string {
	if (!taskId) throw configError("A task ID is required");
	return `/tasks/${encodeURIComponent(taskId)}`;
}

/** Typed access to the official agent API; credentials stay in the server/client configuration. */
export function createFrontierApi(client: ApiClient = defaultClient) {
	return {
		health(input: FrontierRequestOptions<void> = {}): Promise<void> {
			return client.http.get<void>("/health", input);
		},
		createTask(
			task: CreateTaskRequest,
			input: FrontierRequestOptions<CreateTaskResponse, CreateTaskRequest> = {},
		): Promise<CreateTaskResponse> {
			createTaskRequestSchema.assert(task);
			return client.http.post<CreateTaskResponse, CreateTaskRequest>(
				"/tasks",
				task,
				{
					...input,
					validate: createTaskResponseSchema,
					retries: 0,
					replayMutations: false,
				},
			);
		},
		getTask(
			taskId: string,
			input: FrontierRequestOptions<TaskResult> = {},
		): Promise<TaskResult> {
			return client.http.get<TaskResult>(taskPath(taskId), {
				...input,
				validate: taskResultSchema,
			});
		},
	};
}

export const frontierApi = createFrontierApi();
