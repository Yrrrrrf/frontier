import type { TaskTrace, TraceEvent } from "@sdk/core";

export interface TraceRequest {
	agentUrl: string;
	token: string;
	taskId: string;
	signal?: AbortSignal;
}

export class TraceRequestError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "TraceRequestError";
	}
}

export function normalizeAgentUrl(value: string): string {
	const input = value.trim();
	if (!input) throw new TraceRequestError("Enter the agent URL.");
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new TraceRequestError("Enter a valid absolute agent URL.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TraceRequestError("The agent URL must use HTTP or HTTPS.");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new TraceRequestError(
			"The agent URL cannot contain credentials, query parameters, or fragments.",
		);
	}
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function taskTraceUrl(agentUrl: string, taskId: string): string {
	const id = taskId.trim();
	if (!id) throw new TraceRequestError("Enter a task ID.");
	return `${normalizeAgentUrl(agentUrl)}/tasks/${encodeURIComponent(id)}/trace`;
}

function isTaskTrace(value: unknown): value is TaskTrace {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<TaskTrace>;
	return Boolean(
		candidate.metadata &&
			typeof candidate.metadata.taskId === "string" &&
			typeof candidate.metadata.receivedAtMs === "number" &&
			candidate.summary?.counters &&
			candidate.summary.stageDurationsMs &&
			Array.isArray(candidate.events),
	);
}

export async function fetchTaskTrace(
	request: TraceRequest,
): Promise<TaskTrace> {
	if (!request.token.trim())
		throw new TraceRequestError("Enter the team Bearer token.");
	let response: Response;
	try {
		response = await fetch(taskTraceUrl(request.agentUrl, request.taskId), {
			headers: {
				Authorization: `Bearer ${request.token.trim()}`,
				Accept: "application/json",
			},
			signal: request.signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			throw error;
		throw new TraceRequestError(
			"Cannot reach the agent. Check its URL, readiness, and r2 CORS origin.",
		);
	}
	if (!response.ok) {
		if (response.status === 401)
			throw new TraceRequestError(
				"Unauthorized. Check the team Bearer token.",
				401,
			);
		if (response.status === 404)
			throw new TraceRequestError("No trace was found for this task ID.", 404);
		if (response.status === 503)
			throw new TraceRequestError("The agent is not ready.", 503);
		throw new TraceRequestError(
			`The agent returned HTTP ${response.status}.`,
			response.status,
		);
	}
	const payload: unknown = await response.json();
	if (!isTaskTrace(payload))
		throw new TraceRequestError("The agent returned an invalid trace payload.");
	if (payload.metadata.taskId !== request.taskId.trim()) {
		throw new TraceRequestError(
			"The returned trace belongs to a different task.",
		);
	}
	return payload;
}

export function formatDuration(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
	if (value < 1_000) return `${Math.round(value)} ms`;
	if (value < 60_000)
		return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
	const minutes = Math.floor(value / 60_000);
	const seconds = Math.round((value % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

export function formatNumber(value: number | undefined): string {
	return value === undefined ? "—" : new Intl.NumberFormat().format(value);
}

export function shortId(value: string | undefined, length = 8): string {
	if (!value) return "—";
	return value.length <= length ? value : `${value.slice(0, length)}…`;
}

export function stageLabel(value: string | undefined): string {
	if (!value) return "Waiting for the first confirmed stage";
	const labels: Record<string, string> = {
		"http.received": "HTTP request received",
		"auth.checked": "Authentication checked",
		"request.validated": "Request validated",
		"task.registered": "Task registered",
		"task.accepted": "Task accepted",
		"runner.started": "Runner started",
		"desktop.connect.started": "Desktop connection",
		"desktop.login.ok": "Desktop authenticated",
		"desktop.session.ready": "Desktop session ready",
		"capture.started": "Capture started",
		"capture.ok": "Frame captured",
		"capture.rejected": "Capture rejected",
		"inference.queued": "Inference queued",
		"inference.started": "Inference started",
		"inference.response": "Inference response",
		"inference.failed": "Inference failed",
		"response.parsed": "Response parsed",
		"action.proposed": "Action proposed",
		"action.rejected": "Action rejected",
		"guard.started": "Guard started",
		"guard.ok": "Side effect authorized",
		"guard.rejected": "Side effect rejected",
		"side_effect.before": "Final pre-input checkpoint",
		"input.executed": "Controller input",
		"repaint.waited": "Repaint waited",
		"effect.observed": "Visible change observed",
		"effect.unknown": "Effect unknown",
		"progress.observed": "Intermediate progress observed",
		"closure.proposed": "Closure proposed",
		"closure.verified": "Completion check",
		"task.terminal": "Task reached terminal state",
		"late_result.discarded": "Late result discarded",
		"desktop.closed": "Desktop closed",
		"cleanup.ok": "Cleanup complete",
	};
	return labels[value] ?? value.replaceAll(".", " · ");
}

export function eventOffset(trace: TaskTrace, event: TraceEvent): number {
	return Math.max(0, event.atMs - trace.metadata.receivedAtMs);
}

export function observedDuration(trace: TaskTrace): number {
	const end =
		trace.metadata.terminalAtMs ??
		trace.events.at(-1)?.atMs ??
		trace.metadata.receivedAtMs;
	return Math.max(0, end - trace.metadata.receivedAtMs);
}

export function detailJson(event: TraceEvent): string {
	return JSON.stringify(event.details ?? {}, null, 2);
}
