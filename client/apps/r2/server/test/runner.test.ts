import assert from "node:assert/strict";
import { test } from "node:test";
import type { CreateTaskRequest } from "../../../../sdk/core/src/schemas/frontier.ts";
import {
	createDesktopTaskRunner,
	type RunnerDesktop,
	type RunnerVision,
} from "../src/runner.ts";
import type { TaskExecution } from "../src/service.ts";
import { DesktopOperationError, type DesktopFrame } from "../src/vnc.ts";
import type { Action, VisionInput } from "../src/vision.ts";

const request: CreateTaskRequest = {
	tarea: "Haz clic en el menú visible.",
	escritorio: { url: "wss://desktop.test/websockify", password: "secret" },
};

class FakeDesktop implements RunnerDesktop {
	clicks = 0;
	closes = 0;
	captures = 0;
	points: Array<{ x: number; y: number }> = [];
	clickError?: DesktopOperationError;
	closeError = false;
	constructor(private readonly frames: DesktopFrame[]) {}
	async capture(): Promise<DesktopFrame> {
		this.captures++;
		const next = this.frames.length > 1 ? this.frames.shift() : this.frames[0];
		if (!next) throw new Error("FakeDesktop has no frame");
		return next;
	}
	async click(_frame: DesktopFrame, x: number, y: number): Promise<void> {
		this.clicks++;
		this.points.push({ x, y });
		if (this.clickError) throw this.clickError;
	}
	async close(): Promise<void> {
		this.closes++;
		if (this.closeError) throw new Error("cleanup failed");
	}
}

const frame = (value: number): DesktopFrame => ({
	png: Uint8Array.of(value),
	width: 100,
	height: 100,
});

function vision(action: Action, beforeReturn?: () => void): RunnerVision {
	return {
		async proposeAction(input) {
			beforeReturn?.();
			return {
				ok: true,
				value: {
					frameId: input.frameId,
					action,
					model: "fake",
					elapsedMs: 1,
				},
			};
		},
	};
}

function visionSequence(
	actions: Action[],
	calls: VisionInput[] = [],
): RunnerVision {
	let index = 0;
	return {
		async proposeAction(input) {
			calls.push(input);
			const action = actions[Math.min(index++, actions.length - 1)];
			if (!action) throw new Error("Fake vision has no action");
			return {
				ok: true,
				value: {
					frameId: input.frameId,
					action,
					model: "fake",
					elapsedMs: 1,
				},
			};
		},
	};
}

function execution(
	_now: () => number,
	trace?: TaskExecution["trace"],
): TaskExecution {
	return {
		id: "task-test",
		request,
		deadlineMs: 100_000,
		signal: new AbortController().signal,
		...(trace ? { trace } : {}),
	};
}

test("runner executes one guarded click and verifies a distinct post-frame", async () => {
	const desktop = new FakeDesktop([frame(1), frame(1), frame(2)]);
	const now = 0;
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 0, y: 0 },
			{ kind: "finish", evidence: "El destino está abierto." },
		]),
		login: async () => desktop,
		now: () => now,
	});
	assert.match(
		await run(execution(() => now)),
		/postcondición visual verificadas/,
	);
	assert.equal(desktop.clicks, 1);
	assert.equal(desktop.closes, 1);
});

test("a benign modal is dismissed and the original goal continues in the same run", async () => {
	const desktop = new FakeDesktop([
		frame(1),
		frame(1),
		frame(2),
		frame(2),
		frame(3),
	]);
	const calls: VisionInput[] = [];
	const events: string[] = [];
	const run = createDesktopTaskRunner({
		vision: visionSequence(
			[
				{ kind: "click", x: 10, y: 10 },
				{ kind: "fail", reason: "Comercial todavía no está abierto." },
				{ kind: "click", x: 80, y: 60 },
				{ kind: "finish", evidence: "Comercial está abierto." },
			],
			calls,
		),
		login: async () => desktop,
		now: () => 0,
	});
	const summary = await run(
		execution(() => 0, {
			record(event) {
				events.push(event.event);
			},
		}),
	);
	assert.match(summary, /2 paso\(s\)/);
	assert.deepEqual(desktop.points, [
		{ x: 10, y: 10 },
		{ x: 80, y: 60 },
	]);
	assert.equal(calls.length, 4);
	assert.ok(calls.every((call) => call.goal === request.tarea));
	assert.match(calls[0]?.recentContext ?? "", /Decision mode: next_action/);
	assert.match(
		calls[1]?.recentContext ?? "",
		/Decision mode: verify_completion/,
	);
	assert.match(calls[2]?.recentContext ?? "", /Paso 1: clic en \(10,10\)/);
	assert.match(
		calls[2]?.recentContext ?? "",
		/Comercial todavía no está abierto/,
	);
	assert.ok(events.includes("progress.observed"));
	assert.equal(events.filter((event) => event === "input.executed").length, 2);
	assert.equal(desktop.closes, 1);
});

test("a modal appearing after a proposal invalidates old coordinates before input", async () => {
	const desktop = new FakeDesktop([frame(1), frame(2), frame(2), frame(3)]);
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 10, y: 10 },
			{ kind: "click", x: 80, y: 60 },
			{ kind: "finish", evidence: "Destino abierto." },
		]),
		login: async () => desktop,
		now: () => 0,
	});
	await run(execution(() => 0));
	assert.deepEqual(desktop.points, [{ x: 80, y: 60 }]);
	assert.equal(desktop.clicks, 1);
});

test("late inference cannot emit input", async () => {
	const desktop = new FakeDesktop([frame(1)]);
	let now = 0;
	const run = createDesktopTaskRunner({
		vision: vision({ kind: "click", x: 0, y: 0 }, () => {
			now = 100_000;
		}),
		login: async () => desktop,
		now: () => now,
	});
	await assert.rejects(run(execution(() => now)), /tiempo suficiente/);
	assert.equal(desktop.clicks, 0);
	assert.equal(desktop.closes, 1);
});

test("an uncertain click is observed but never blindly repeated", async () => {
	const desktop = new FakeDesktop([frame(1)]);
	desktop.clickError = new DesktopOperationError(
		"transport lost after mouse down",
		false,
		true,
	);
	const now = 0;
	const run = createDesktopTaskRunner({
		vision: vision({ kind: "click", x: 0, y: 0 }),
		login: async () => desktop,
		now: () => now,
	});
	await assert.rejects(run(execution(() => now)), /no se repitió/);
	assert.equal(desktop.clicks, 1);
	assert.equal(desktop.closes, 1);
});

test("model finish without verified postcondition cannot complete a task", async () => {
	const desktop = new FakeDesktop([frame(1)]);
	const now = 0;
	const run = createDesktopTaskRunner({
		vision: vision({ kind: "finish", evidence: "looks done" }),
		login: async () => desktop,
		now: () => now,
	});
	await assert.rejects(run(execution(() => now)), /sin una postcondición/);
	assert.equal(desktop.clicks, 0);
	assert.equal(desktop.closes, 1);
});

test("click-only goals without a click prefix are supported and cleanup failure preserves success", async () => {
	const desktop = new FakeDesktop([frame(1), frame(1), frame(2)]);
	desktop.closeError = true;
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 80, y: 60 },
			{ kind: "finish", evidence: "Postcondición visible." },
		]),
		login: async () => desktop,
		now: () => 0,
	});
	assert.match(
		await run({
			...execution(() => 0),
			request: { ...request, tarea: "Exporta las facturas pendientes." },
		}),
		/verificadas/,
	);
	assert.equal(desktop.clicks, 1);
	assert.equal(desktop.closes, 1);
});

test("a click returned during completion verification is rejected and never executed", async () => {
	const desktop = new FakeDesktop([frame(1), frame(1), frame(2)]);
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 80, y: 60 },
			{ kind: "click", x: 1, y: 1 },
		]),
		login: async () => desktop,
		now: () => 0,
	});
	await assert.rejects(run(execution(() => 0)), /no se ejecutó/);
	assert.deepEqual(desktop.points, [{ x: 80, y: 60 }]);
});

test("returning to an observed goal state stops the loop instead of repeating actions", async () => {
	const desktop = new FakeDesktop([
		frame(1),
		frame(1),
		frame(2),
		frame(2),
		frame(1),
	]);
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 10, y: 10 },
			{ kind: "fail", reason: "Todavía pendiente." },
			{ kind: "click", x: 20, y: 20 },
			{ kind: "fail", reason: "Sigue pendiente." },
		]),
		login: async () => desktop,
		now: () => 0,
	});
	await assert.rejects(run(execution(() => 0)), /sin progreso nuevo/);
	assert.equal(desktop.clicks, 2);
	assert.equal(desktop.closes, 1);
});

test("the runner enforces its global action budget without resetting the goal or deadline", async () => {
	const desktop = new FakeDesktop([
		frame(1),
		frame(1),
		frame(2),
		frame(2),
		frame(3),
		frame(3),
		frame(4),
		frame(4),
		frame(5),
		frame(5),
		frame(6),
		frame(6),
		frame(7),
		frame(7),
		frame(8),
		frame(8),
		frame(9),
	]);
	const actions = Array.from(
		{ length: 16 },
		(_, index): Action =>
			index % 2 === 0
				? { kind: "click", x: 80, y: 60 }
				: { kind: "fail", reason: "Objetivo aún pendiente." },
	);
	const run = createDesktopTaskRunner({
		vision: visionSequence(actions),
		login: async () => desktop,
		now: () => 0,
	});
	await assert.rejects(run(execution(() => 0)), /límite de 8 acciones/);
	assert.equal(desktop.clicks, 8);
	assert.equal(desktop.closes, 1);
});
