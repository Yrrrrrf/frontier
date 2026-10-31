import assert from "node:assert/strict";
import { test } from "node:test";
import type { CreateTaskRequest } from "../../../../sdk/core/src/schemas/frontier.ts";
import { TaskService } from "../src/service.ts";

const request: CreateTaskRequest = {
	tarea: "Haz clic en el destino visible.",
	escritorio: { url: "wss://desktop.test/websockify", password: "secret" },
};

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("success after the absolute deadline is discarded without firing its timer", async () => {
	let now = 0;
	let finish!: (summary: string) => void;
	const pending = new Promise<string>((resolve) => {
		finish = resolve;
	});
	const service = new TaskService(
		() => pending,
		10,
		() => now,
	);
	const { task_id } = service.create(request);
	await turn();
	now = 11;
	finish("Late success");
	await turn();
	assert.equal(service.get(task_id)?.estado, "fallida");
	assert.match(service.get(task_id)?.resumen ?? "", /excedió/);
	service.dispose();
});

test("now exactly equal to deadline is expired", async () => {
	let now = 0;
	let finish!: (summary: string) => void;
	const pending = new Promise<string>((resolve) => {
		finish = resolve;
	});
	const service = new TaskService(
		() => pending,
		10,
		() => now,
	);
	const { task_id } = service.create(request);
	await turn();
	now = 10;
	finish("Boundary success");
	await turn();
	assert.equal(service.get(task_id)?.estado, "fallida");
	assert.match(service.get(task_id)?.resumen ?? "", /excedió/);
	service.dispose();
});

test("runner errors after the deadline also retain the timeout terminal", async () => {
	let now = 0;
	let rejectRunner!: (error: Error) => void;
	const pending = new Promise<string>((_resolve, reject) => {
		rejectRunner = reject;
	});
	const service = new TaskService(
		() => pending,
		10,
		() => now,
	);
	const { task_id } = service.create(request);
	await turn();
	now = 12;
	rejectRunner(new Error("Late failure"));
	await turn();
	assert.match(service.get(task_id)?.resumen ?? "", /excedió/);
	service.dispose();
});

test("shutdown publishes a terminal before aborting outstanding work", async () => {
	let stateAtAbort: string | undefined;
	let service: TaskService;
	service = new TaskService(async (execution) => {
		execution.signal.addEventListener("abort", () => {
			stateAtAbort = service.get(execution.id)?.estado;
		});
		return new Promise<string>(() => {});
	});
	const { task_id } = service.create(request);
	await turn();
	service.dispose();
	assert.equal(stateAtAbort, "fallida");
	assert.equal(service.get(task_id)?.estado, "fallida");
});
