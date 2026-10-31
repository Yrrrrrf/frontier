import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import {
	defaultTraceMetadata,
	MemoryTraceSink,
	type TraceMetadataInput,
} from "../src/trace.ts";

function metadata(taskId: string): TraceMetadataInput {
	return {
		...defaultTraceMetadata,
		taskId,
		runId: "run-1",
		createdAt: "2026-10-31T20:00:00.000Z",
		receivedAtMs: 10,
		deadlineAtMs: 300_010,
	};
}

test("trace events are bounded, correlated, cloned and redacted with task secrets", () => {
	const sink = new MemoryTraceSink({ maxEventsPerTask: 2, now: () => 42 });
	sink.begin(metadata("task-1"));
	sink.protect("task-1", ["desktop-secret", "wss://private.example/vnc"]);
	sink.record("task-1", {
		iteration: 1,
		event: "action.rejected",
		status: "rejected",
		details: {
			code: "invalid_action",
			error: "desktop-secret Bearer team-secret wss://private.example/vnc",
			nested: { diagnostic: "password desktop-secret" },
			password: "must-not-survive",
			imageBytes: "must-not-survive",
		},
	});
	sink.record("task-1", {
		iteration: 1,
		event: "capture.ok",
		status: "ok",
		frameId: "frame-A",
		actionId: "action-A",
		durationMs: 12,
		details: { inputTokens: 20, outputTokens: 5 },
	});
	sink.record("task-1", {
		iteration: 2,
		event: "late_result.discarded",
		status: "rejected",
		actionId: "action-A",
	});

	const trace = sink.get("task-1");
	assert.ok(trace);
	assert.equal(trace.metadata.eventCount, 3);
	assert.equal(trace.metadata.droppedEvents, 1);
	assert.equal(trace.events.length, 2);
	assert.equal(trace.events[0]?.event, "capture.ok");
	assert.equal(trace.events[1]?.event, "late_result.discarded");
	assert.equal(trace.summary.lastFrameId, "frame-A");
	assert.equal(trace.summary.lastActionId, "action-A");
	assert.equal(trace.summary.counters.iterations, 2);
	assert.equal(trace.summary.counters.lateResponses, 1);
	assert.equal(trace.summary.counters.inputTokens, 20);
	assert.equal(trace.summary.counters.outputTokens, 5);

	const rejected = sink.get("task-1");
	const serialized = JSON.stringify(rejected);
	assert.equal(serialized.includes("desktop-secret"), false);
	assert.equal(serialized.includes("team-secret"), false);
	assert.equal(serialized.includes("private.example"), false);
	assert.equal(serialized.includes("must-not-survive"), false);

	const firstEvent = trace.events[0];
	assert.ok(firstEvent);
	firstEvent.event = "mutated.copy";
	assert.equal(sink.get("task-1")?.events[0]?.event, "capture.ok");
});

test("JSONL persistence contains only sanitized metadata and events", async () => {
	const directory = await mkdtemp(join(tmpdir(), "frontier-trace-"));
	try {
		const sink = new MemoryTraceSink({ directory, now: () => 42 });
		sink.begin(metadata("task-jsonl"));
		sink.protect("task-jsonl", ["desktop-secret"]);
		sink.record("task-jsonl", {
			iteration: 0,
			event: "runner.failed",
			status: "failed",
			details: { error: "login failed for desktop-secret" },
		});
		await sink.flush();
		const trace = sink.get("task-jsonl");
		const traceFile = trace?.metadata.traceFile;
		assert.ok(traceFile);
		const content = await readFile(
			join(directory, basename(traceFile)),
			"utf8",
		);
		const lines = content
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(lines[0].type, "metadata");
		assert.equal(lines.at(-1).type, "event");
		assert.equal(content.includes("desktop-secret"), false);
		assert.match(content, /\[secreto\]/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
