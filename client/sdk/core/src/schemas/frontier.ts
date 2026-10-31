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

/** Read-only development observability DTOs; these do not extend official task results. */
export type TraceStatus = "started" | "ok" | "rejected" | "failed";

export interface TraceEvent {
	taskId: string;
	iteration: number;
	event: string;
	atMs: number;
	durationMs?: number;
	frameId?: string;
	actionId?: string;
	status: TraceStatus;
	details?: Record<string, unknown>;
}

export interface TraceTaskMetadata {
	taskId: string;
	runId: string;
	createdAt: string;
	receivedAtMs: number;
	deadlineAtMs: number;
	acceptedAtMs?: number;
	terminalAtMs?: number;
	finalState?: TaskState;
	serverVersion: string;
	model: {
		requested: string;
		temperature: number;
		numCtx: number;
		numPredict: number;
	};
	viewport: { width: number; height: number; deviceScaleFactor: number };
	traceFile?: string;
	eventCount: number;
	droppedEvents: number;
}

export interface TraceFailure {
	event: string;
	atMs: number;
	iteration: number;
	status: "rejected" | "failed";
	error?: string;
}

export interface TaskTraceSummary {
	finalState?: TaskState;
	lastConfirmedStage?: string;
	firstFailure?: TraceFailure;
	lastFrameId?: string;
	lastActionId?: string;
	stageDurationsMs: Record<string, number>;
	counters: {
		iterations: number;
		inferenceCalls: number;
		retries: number;
		invalidProposals: number;
		wrongClicks: number;
		repeatedFrames: number;
		lateResponses: number;
		inputTokens: number;
		outputTokens: number;
	};
	evidence: string[];
}

export interface TaskTrace {
	metadata: TraceTaskMetadata;
	events: TraceEvent[];
	summary: TaskTraceSummary;
}
