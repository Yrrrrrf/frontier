import { type } from "arktype";

/** Official Reto 2 wire contract. Do not confuse desktop and team credentials. */
export const desktopAccessSchema = type({
	url: "string",
	password: "string",
});

export const createTaskRequestSchema = type({
	tarea: "string",
	escritorio: desktopAccessSchema,
});

export const createTaskResponseSchema = type({
	task_id: "string",
});

export const taskResultSchema = type({
	estado: type.enumerated("en_curso", "terminada", "fallida"),
	resumen: "string",
});

export type DesktopAccess = typeof desktopAccessSchema.infer;
export type CreateTaskRequest = typeof createTaskRequestSchema.infer;
export type CreateTaskResponse = typeof createTaskResponseSchema.infer;
export type TaskResult = typeof taskResultSchema.infer;
export type TaskState = TaskResult["estado"];
