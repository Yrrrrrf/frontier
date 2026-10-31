import { randomUUID, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createTaskRequestSchema } from "../../../../sdk/core/src/schemas/frontier.ts";
import { TaskService, unavailableRunner, type TaskRunner } from "./service.ts";
import {
	defaultTraceMetadata,
	MemoryTraceSink,
	sanitizeTraceText,
	type TraceSink,
} from "./trace.ts";

const MAX_BODY_BYTES = 64 * 1024;

function authorized(header: string | undefined, token: string): boolean {
	const expected = `Bearer ${token}`;
	if (!header || header.length !== expected.length) return false;
	return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const bytes = Buffer.from(chunk);
		size += bytes.length;
		if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
		chunks.push(bytes);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export interface AgentServerOptions {
	token: string;
	runner?: TaskRunner;
	taskBudgetMs?: number;
	/** Synchronous cached preflight state; health never starts inference or I/O. */
	readiness?: () => boolean;
	trace?: TraceSink;
	model?: string;
	serverVersion?: string;
	/** Explicit browser origins allowed to call the authenticated development trace API. */
	uiOrigins?: readonly string[];
}

export function createAgentServer(options: AgentServerOptions): {
	server: Server;
	tasks: TaskService;
	traces: TraceSink;
} {
	if (!options.token) throw new Error("TEAM_TOKEN is required");
	const traces = options.trace ?? new MemoryTraceSink();
	const budgetMs = options.taskBudgetMs ?? 300_000;
	const tasks = new TaskService(
		options.runner ?? unavailableRunner,
		budgetMs,
		() => performance.now(),
		traces,
	);
	const isReady = options.readiness ?? (() => options.runner !== undefined);
	const uiOrigins = new Set(options.uiOrigins ?? []);
	const server = createServer(async (request, response) => {
		const origin = request.headers.origin;
		const corsAllowed = origin !== undefined && uiOrigins.has(origin);
		if (corsAllowed) {
			response.setHeader("Access-Control-Allow-Origin", origin);
			response.setHeader(
				"Access-Control-Allow-Headers",
				"Authorization, Content-Type",
			);
			response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			response.setHeader("Access-Control-Max-Age", "600");
			response.setHeader("Vary", "Origin");
		}
		if (request.method === "OPTIONS") {
			response.writeHead(corsAllowed ? 204 : 403);
			response.end();
			return;
		}
		const receivedAtMs = performance.now();
		let traceTaskId: string | undefined;
		try {
			const authStarted = performance.now();
			if (!authorized(request.headers.authorization, options.token)) {
				json(response, 401, { error: "unauthorized" });
				return;
			}
			const authMs = performance.now() - authStarted;
			const method = request.method ?? "GET";
			const path = new URL(request.url ?? "/", "http://agent.invalid").pathname;
			if (method === "GET" && path === "/health") {
				response.writeHead(isReady() ? 200 : 503);
				response.end();
				return;
			}
			if (method === "POST" && path === "/tasks") {
				traceTaskId = randomUUID();
				traces.begin({
					...defaultTraceMetadata,
					serverVersion:
						options.serverVersion ?? defaultTraceMetadata.serverVersion,
					model: {
						...defaultTraceMetadata.model,
						requested: options.model ?? defaultTraceMetadata.model.requested,
					},
					taskId: traceTaskId,
					runId: randomUUID(),
					createdAt: new Date().toISOString(),
					receivedAtMs,
					deadlineAtMs: receivedAtMs + budgetMs,
				});
				traces.record(traceTaskId, {
					iteration: 0,
					event: "http.received",
					atMs: receivedAtMs,
					status: "started",
					details: { method: "POST" },
				});
				traces.record(traceTaskId, {
					iteration: 0,
					event: "auth.checked",
					status: "ok",
					durationMs: authMs,
				});
				if (!isReady()) {
					traces.record(traceTaskId, {
						iteration: 0,
						event: "task.accepted",
						status: "rejected",
						details: { code: "agent_not_ready" },
					});
					json(response, 503, { error: "agent_not_ready" });
					return;
				}
				const bodyStarted = performance.now();
				const payload = await body(request);
				traces.record(traceTaskId, {
					iteration: 0,
					event: "request.body.parsed",
					status: "ok",
					durationMs: performance.now() - bodyStarted,
				});
				const validationStarted = performance.now();
				const input = createTaskRequestSchema.assert(payload);
				if (
					!input.tarea.trim() ||
					!input.escritorio.url ||
					!input.escritorio.password
				) {
					traces.record(traceTaskId, {
						iteration: 0,
						event: "request.validated",
						status: "rejected",
						details: { code: "invalid_task" },
					});
					json(response, 400, { error: "invalid_task" });
					return;
				}
				traces.record(traceTaskId, {
					iteration: 0,
					event: "request.validated",
					status: "ok",
					durationMs: performance.now() - validationStarted,
					details: { goalLength: input.tarea.length },
				});
				const registrationStarted = performance.now();
				const created = tasks.create(input, {
					id: traceTaskId,
					receivedAtMs,
				});
				const acceptedAtMs = performance.now();
				traces.update(traceTaskId, { acceptedAtMs });
				traces.record(traceTaskId, {
					iteration: 0,
					event: "task.accepted",
					atMs: acceptedAtMs,
					status: "ok",
					durationMs: acceptedAtMs - receivedAtMs,
					details: { registrationMs: acceptedAtMs - registrationStarted },
				});
				json(response, 200, created);
				return;
			}
			// Existing task state remains readable while local readiness is degraded.
			const match = /^\/tasks\/([^/]+)$/.exec(path);
			if (method === "GET" && match) {
				const result = tasks.get(decodeURIComponent(match[1] ?? ""));
				if (!result) json(response, 404, { error: "task_not_found" });
				else json(response, 200, result);
				return;
			}
			const traceMatch = /^\/tasks\/([^/]+)\/trace$/.exec(path);
			if (method === "GET" && traceMatch) {
				const id = decodeURIComponent(traceMatch[1] ?? "");
				const trace = tasks.get(id) ? traces.get(id) : undefined;
				if (!trace) json(response, 404, { error: "trace_not_found" });
				else json(response, 200, trace);
				return;
			}
			json(response, 404, { error: "not_found" });
		} catch (error) {
			if (traceTaskId) {
				traces.record(traceTaskId, {
					iteration: 0,
					event: "request.validated",
					status: "failed",
					details: {
						code: "invalid_request",
						error: sanitizeTraceText(
							error instanceof Error ? error.message : "Invalid request",
						),
					},
				});
			}
			json(response, 400, { error: "invalid_request" });
		}
	});
	server.on("close", () => {
		tasks.dispose();
		void traces.flush();
	});
	return { server, tasks, traces };
}
