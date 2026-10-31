import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createTaskResponseSchema, taskResultSchema, type CreateTaskRequest } from "../../client/sdk/core/src/schemas/frontier.ts";
import { createAgentServer } from "../src/http.ts";

const input: CreateTaskRequest = {
  tarea: "Registra un cliente de prueba.",
  escritorio: { url: "wss://desktop.test/websockify", password: "desktop-secret" },
};

async function fixture(
  runner: Parameters<typeof createAgentServer>[0]["runner"] = async () => "Cliente registrado.",
  taskBudgetMs?: number,
) {
  const { server, tasks } = createAgentServer({
    token: "team-secret",
    runner,
    ...(taskBudgetMs === undefined ? {} : { taskBudgetMs }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: "Bearer team-secret", ...init.headers },
  });
  return { server, tasks, call, base };
}

async function close(server: Awaited<ReturnType<typeof fixture>>["server"]) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

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
  const pending = new Promise<string>((resolve) => { finish = resolve; });
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
    const running = taskResultSchema.assert(await (await call(`/tasks/${task_id}`)).json());
    assert.equal(running.estado, "en_curso");
    finish("Cliente registrado y verificado.");
    const terminal = taskResultSchema.assert(await (await call(`/tasks/${task_id}`)).json());
    assert.deepEqual(terminal, { estado: "terminada", resumen: "Cliente registrado y verificado." });
    assert.equal(JSON.stringify(terminal).includes("desktop-secret"), false);
  } finally {
    finish("cleanup");
    await close(server);
  }
});

test("runner errors become fallida and invalid requests never create tasks", async () => {
  const { server, call } = await fixture(async (execution) => {
    throw new Error(`Escritorio no disponible: ${execution.request.escritorio.password}`);
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
    const result = taskResultSchema.assert(await (await call(`/tasks/${task_id}`)).json());
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

test("deadline publishes fallida, aborts execution and ignores a late result", async () => {
  let finish!: (summary: string) => void;
  let signal: AbortSignal | undefined;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const { server, call } = await fixture((execution) => {
    signal = execution.signal;
    return pending;
  }, 20);
  try {
    const created = await call("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const { task_id } = createTaskResponseSchema.assert(await created.json());
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(signal?.aborted, true);
    assert.equal((await call(`/tasks/${task_id}`)).status, 200);
    const expired = taskResultSchema.assert(await (await call(`/tasks/${task_id}`)).json());
    assert.equal(expired.estado, "fallida");
    finish("Late success must not reopen the task");
    await new Promise((resolve) => setImmediate(resolve));
    const terminal = taskResultSchema.assert(await (await call(`/tasks/${task_id}`)).json());
    assert.deepEqual(terminal, expired);
  } finally {
    finish("cleanup");
    await close(server);
  }
});
