import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import {
	createTaskResponseSchema,
	taskResultSchema,
	type CreateTaskRequest,
} from "../../../../sdk/core/src/schemas/frontier.ts";
import { createAgentServer } from "../src/http.ts";

const input: CreateTaskRequest = {
	tarea: "Registra un cliente de prueba.",
	escritorio: {
		url: "wss://desktop.test/websockify",
		password: "desktop-secret",
	},
};

async function fixture(
	runner: Parameters<typeof createAgentServer>[0]["runner"] = async () =>
		"Cliente registrado.",
	taskBudgetMs?: number,
	readiness?: () => boolean,
	uiOrigins?: readonly string[],
) {
	const { server, tasks, traces } = createAgentServer({
		token: "team-secret",
		runner,
		...(taskBudgetMs === undefined ? {} : { taskBudgetMs }),
		...(readiness === undefined ? {} : { readiness }),
		...(uiOrigins === undefined ? {} : { uiOrigins }),
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const call = (path: string, init: RequestInit = {}) =>
		fetch(`${base}${path}`, {
			...init,
			headers: { Authorization: "Bearer team-secret", ...init.headers },
		});
	return { server, tasks, traces, call, base };
}

async function close(server: Awaited<ReturnType<typeof fixture>>["server"]) {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

test("missing composition is not ready and does not admit work", async () => {
	const { server } = createAgentServer({ token: "team-secret" });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const call = (path: string, init: RequestInit = {}) =>
		fetch(`${base}${path}`, {
			...init,
			headers: { Authorization: "Bearer team-secret", ...init.headers },
		});
	try {
		assert.equal((await call("/health")).status, 503);
		const created = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		assert.equal(created.status, 503);
	} finally {
		await close(server);
	}
});

test("readiness degradation blocks admission but preserves existing task polling", async () => {
	let ready = true;
	const { server, call, tasks } = await fixture(
		async () => "Estado conservado.",
		undefined,
		() => ready,
	);
	try {
		assert.equal((await call("/health")).status, 200);
		const created = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		const { task_id } = createTaskResponseSchema.assert(await created.json());
		await new Promise((resolve) => setImmediate(resolve));
		ready = false;
		assert.equal((await call("/health")).status, 503);
		assert.equal((await call(`/tasks/${task_id}`)).status, 200);
		assert.equal(tasks.get(task_id)?.estado, "terminada");
		const rejected = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		assert.equal(rejected.status, 503);
		ready = true;
		assert.equal((await call("/health")).status, 200);
	} finally {
		await close(server);
	}
});

test("every route requires the team Bearer token and health is ready", async () => {
	const { server, call, base } = await fixture();
	try {
		assert.equal((await fetch(`${base}/health`)).status, 401);
		assert.equal((await call("/health")).status, 200);
	} finally {
		await close(server);
	}
});

test("POST returns an ID before work finishes and polling exposes the shared terminal state", async () => {
	let finish!: (summary: string) => void;
	const pending = new Promise<string>((resolve) => {
		finish = resolve;
	});
	const { server, call } = await fixture(() => pending);
	try {
		const started = performance.now();
		const created = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		assert.equal(created.status, 200);
		assert.ok(performance.now() - started < 2_000);
		const { task_id } = createTaskResponseSchema.assert(await created.json());
		const running = taskResultSchema.assert(
			await (await call(`/tasks/${task_id}`)).json(),
		);
		assert.equal(running.estado, "en_curso");
		finish("Cliente registrado y verificado.");
		const terminal = taskResultSchema.assert(
			await (await call(`/tasks/${task_id}`)).json(),
		);
		assert.deepEqual(terminal, {
			estado: "terminada",
			resumen: "Cliente registrado y verificado.",
		});
		assert.equal(JSON.stringify(terminal).includes("desktop-secret"), false);
	} finally {
		finish("cleanup");
		await close(server);
	}
});

test("runner errors become fallida and invalid requests never create tasks", async () => {
	const { server, call } = await fixture(async (execution) => {
		throw new Error(
			`Escritorio no disponible: ${execution.request.escritorio.password}`,
		);
	});
	try {
		const malformed = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ task: "wrong DTO" }),
		});
		assert.equal(malformed.status, 400);
		const created = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		const { task_id } = createTaskResponseSchema.assert(await created.json());
		await new Promise((resolve) => setImmediate(resolve));
		const result = taskResultSchema.assert(
			await (await call(`/tasks/${task_id}`)).json(),
		);
		assert.deepEqual(result, {
			estado: "fallida",
			resumen: "Escritorio no disponible: [secreto]",
		});
		assert.equal(JSON.stringify(result).includes("desktop-secret"), false);
		assert.equal((await call("/tasks/unknown")).status, 404);
	} finally {
		await close(server);
	}
});

test("authenticated trace reads expose correlated sanitized task metadata", async () => {
	const { server, call, base } = await fixture(async (execution) => {
		execution.trace?.record({
			iteration: 1,
			event: "effect.observed",
			status: "ok",
			frameId: "frame-B",
			details: {
				error: `diagnostic ${execution.request.escritorio.password}`,
				evidencePath: "artifacts/traces/evidence.png",
			},
		});
		return "Verified.";
	});
	try {
		const created = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		const { task_id } = createTaskResponseSchema.assert(await created.json());
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal((await fetch(`${base}/tasks/${task_id}/trace`)).status, 401);
		const response = await call(`/tasks/${task_id}/trace`);
		assert.equal(response.status, 200);
		const trace = await response.json();
		assert.equal(trace.metadata.taskId, task_id);
		assert.equal(trace.summary.finalState, "terminada");
		assert.equal(trace.summary.lastFrameId, "frame-B");
		assert.ok(
			trace.events.some(
				(event: { event: string }) => event.event === "http.received",
			),
		);
		assert.ok(
			trace.events.some(
				(event: { event: string }) => event.event === "task.terminal",
			),
		);
		assert.equal(JSON.stringify(trace).includes("desktop-secret"), false);
		assert.equal((await call("/tasks/unknown/trace")).status, 404);
	} finally {
		await close(server);
	}
});

test("only configured r2 origins receive browser CORS access", async () => {
	const origin = "http://localhost:5173";
	const { server, call, base } = await fixture(
		async () => "done",
		undefined,
		undefined,
		[origin],
	);
	try {
		const preflight = await fetch(`${base}/tasks/task-id/trace`, {
			method: "OPTIONS",
			headers: {
				Origin: origin,
				"Access-Control-Request-Method": "GET",
				"Access-Control-Request-Headers": "Authorization",
			},
		});
		assert.equal(preflight.status, 204);
		assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
		const health = await call("/health", { headers: { Origin: origin } });
		assert.equal(health.headers.get("access-control-allow-origin"), origin);
		const disallowed = await fetch(`${base}/health`, {
			method: "OPTIONS",
			headers: { Origin: "https://untrusted.example" },
		});
		assert.equal(disallowed.status, 403);
	} finally {
		await close(server);
	}
});

test("deadline publishes fallida, aborts execution and ignores a late result", async () => {
	let finish!: (summary: string) => void;
	let signal: AbortSignal | undefined;
	let stateAtAbort: string | undefined;
	let taskService: ReturnType<typeof createAgentServer>["tasks"] | undefined;
	const pending = new Promise<string>((resolve) => {
		finish = resolve;
	});
	const { server, call, tasks } = await fixture((execution) => {
		signal = execution.signal;
		signal?.addEventListener("abort", () => {
			stateAtAbort = taskService?.get(execution.id)?.estado;
		});
		return pending;
	}, 20);
	taskService = tasks;
	try {
		const created = await call("/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		const { task_id } = createTaskResponseSchema.assert(await created.json());
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.equal(signal?.aborted, true);
		assert.equal(stateAtAbort, "fallida");
		assert.equal((await call(`/tasks/${task_id}`)).status, 200);
		const expired = taskResultSchema.assert(
			await (await call(`/tasks/${task_id}`)).json(),
		);
		assert.equal(expired.estado, "fallida");
		finish("Late success must not reopen the task");
		await new Promise((resolve) => setImmediate(resolve));
		const terminal = taskResultSchema.assert(
			await (await call(`/tasks/${task_id}`)).json(),
		);
		assert.deepEqual(terminal, expired);
	} finally {
		finish("cleanup");
		await close(server);
	}
});
