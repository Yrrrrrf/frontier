import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createTaskRequestSchema } from "../../../../sdk/core/src/schemas/frontier.ts";
import { TaskService, unavailableRunner, type TaskRunner } from "./service.ts";

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
}

export function createAgentServer(options: AgentServerOptions): {
	server: Server;
	tasks: TaskService;
} {
	if (!options.token) throw new Error("TEAM_TOKEN is required");
	const tasks = new TaskService(
		options.runner ?? unavailableRunner,
		options.taskBudgetMs ?? 300_000,
	);
	const server = createServer(async (request, response) => {
		try {
			if (!authorized(request.headers.authorization, options.token)) {
				json(response, 401, { error: "unauthorized" });
				return;
			}
			const method = request.method ?? "GET";
			const path = new URL(request.url ?? "/", "http://agent.invalid").pathname;
			if (method === "GET" && path === "/health") {
				response.writeHead(200);
				response.end();
				return;
			}
			if (method === "POST" && path === "/tasks") {
				const input = createTaskRequestSchema.assert(await body(request));
				if (
					!input.tarea.trim() ||
					!input.escritorio.url ||
					!input.escritorio.password
				) {
					json(response, 400, { error: "invalid_task" });
					return;
				}
				json(response, 200, tasks.create(input));
				return;
			}
			const match = /^\/tasks\/([^/]+)$/.exec(path);
			if (method === "GET" && match) {
				const result = tasks.get(decodeURIComponent(match[1]!));
				if (!result) json(response, 404, { error: "task_not_found" });
				else json(response, 200, result);
				return;
			}
			json(response, 404, { error: "not_found" });
		} catch {
			json(response, 400, { error: "invalid_request" });
		}
	});
	server.on("close", () => tasks.dispose());
	return { server, tasks };
}
