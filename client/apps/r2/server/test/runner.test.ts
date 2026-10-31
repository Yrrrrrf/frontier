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
import type { Action } from "../src/vision.ts";

const request: CreateTaskRequest = {
	tarea: "Haz clic en el menú visible.",
	escritorio: { url: "wss://desktop.test/websockify", password: "secret" },
};

class FakeDesktop implements RunnerDesktop {
	clicks = 0;
	closes = 0;
	clickError?: DesktopOperationError;
	closeError = false;
	constructor(private readonly frames: DesktopFrame[]) {}
	async capture(): Promise<DesktopFrame> {
		const next = this.frames.length > 1 ? this.frames.shift() : this.frames[0];
		if (!next) throw new Error("FakeDesktop has no frame");
		return next;
	}
	async click(): Promise<void> {
		this.clicks++;
		if (this.clickError) throw this.clickError;
	}
	async close(): Promise<void> {
		this.closes++;
		if (this.closeError) throw new Error("cleanup failed");
	}
}

const frame = (value: number): DesktopFrame => ({
	png: Uint8Array.of(value),
	width: 1,
	height: 1,
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

function visionSequence(actions: Action[]): RunnerVision {
	let index = 0;
	return {
		async proposeAction(input) {
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

function execution(_now: () => number): TaskExecution {
	return {
		id: "task-test",
		request,
		deadlineMs: 100_000,
		signal: new AbortController().signal,
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

test("a changed frame without a verified goal still fails without repeating input", async () => {
	const desktop = new FakeDesktop([frame(1), frame(1), frame(2)]);
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 0, y: 0 },
			{ kind: "fail", reason: "El destino no está visible." },
		]),
		login: async () => desktop,
		now: () => 0,
	});
	await assert.rejects(
		run(execution(() => 0)),
		/postcondición no pudo verificarse/,
	);
	assert.equal(desktop.clicks, 1);
	assert.equal(desktop.closes, 1);
});

test("unsupported objectives fail before login and cleanup failure preserves success", async () => {
	let logins = 0;
	const unsupported = createDesktopTaskRunner({
		vision: vision({ kind: "click", x: 0, y: 0 }),
		login: async () => {
			logins++;
			return new FakeDesktop([frame(1)]);
		},
		now: () => 0,
	});
	await assert.rejects(
		unsupported({
			...execution(() => 0),
			request: { ...request, tarea: "Registra un cliente nuevo." },
		}),
		/Objetivo no compatible/,
	);
	assert.equal(logins, 0);

	const desktop = new FakeDesktop([frame(1), frame(1), frame(2)]);
	desktop.closeError = true;
	const run = createDesktopTaskRunner({
		vision: visionSequence([
			{ kind: "click", x: 0, y: 0 },
			{ kind: "finish", evidence: "Postcondición visible." },
		]),
		login: async () => desktop,
		now: () => 0,
	});
	assert.match(await run(execution(() => 0)), /verificadas/);
	assert.equal(desktop.closes, 1);
});
