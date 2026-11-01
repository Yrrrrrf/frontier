import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAction, createOllamaVision } from "../src/vision.ts";

test("ActionGuard accepts bounded actions and rejects malformed coordinates", () => {
	assert.deepEqual(validateAction({ kind: "click", x: 10, y: 20 }, 100, 100), {
		kind: "click",
		x: 10,
		y: 20,
	});
	assert.deepEqual(
		validateAction({ kind: "fail", reason: "Not visible" }, 100, 100),
		{ kind: "fail", reason: "Not visible" },
	);
	assert.deepEqual(
		validateAction(
			{ kind: "replace_text", x: 10, y: 20, text: "Nuevo valor" },
			100,
			100,
		),
		{ kind: "replace_text", x: 10, y: 20, text: "Nuevo valor" },
	);
	assert.deepEqual(
		validateAction(
			{ kind: "finish", evidence: "Visible", summary: "respuesta: 45" },
			100,
			100,
		),
		{ kind: "finish", evidence: "Visible", summary: "respuesta: 45" },
	);
	for (const action of [
		{ kind: "click", x: -1, y: 20 },
		{ kind: "click", x: 100, y: 20 },
		{ kind: "click", x: 1.5, y: 20 },
		{ kind: "click", x: 10, y: 20, extra: true },
		{ kind: "finish", evidence: " " },
		{ kind: "unknown" },
	])
		assert.throws(() => validateAction(action, 100, 100));
});

test("first abort cause is retained after both timer and parent have aborted", async () => {
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) =>
		new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			signal?.addEventListener(
				"abort",
				() => setTimeout(() => reject(new Error("aborted")), 60),
				{ once: true },
			);
		});
	const input = {
		frameId: "frame-abort-race",
		goal: "Click the visible pixel",
		image: { bytes, width: 1, height: 1 },
	};
	try {
		const vision = createOllamaVision();
		const timerFirstParent = new AbortController();
		const laterParent = setTimeout(() => timerFirstParent.abort(), 30);
		const timed = await vision.proposeAction(input, {
			timeoutMs: 10,
			signal: timerFirstParent.signal,
		});
		clearTimeout(laterParent);
		assert.equal(timerFirstParent.signal.aborted, true);
		assert.equal(timed.ok, false);
		if (!timed.ok) assert.equal(timed.error.code, "timeout");

		const parentFirst = new AbortController();
		const earlierParent = setTimeout(() => parentFirst.abort(), 5);
		const cancelled = await vision.proposeAction(input, {
			timeoutMs: 40,
			signal: parentFirst.signal,
		});
		clearTimeout(earlierParent);
		assert.equal(parentFirst.signal.aborted, true);
		assert.equal(cancelled.ok, false);
		if (!cancelled.ok) assert.equal(cancelled.error.code, "cancelled");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Ollama adapter reports truncated actions instead of malformed JSON", async () => {
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		Response.json({
			done: true,
			done_reason: "length",
			message: { content: "", thinking: "unfinished reasoning" },
			eval_count: 512,
		});
	try {
		const result = await createOllamaVision().proposeAction({
			frameId: "frame-truncated",
			goal: "Click the visible pixel",
			image: { bytes, width: 1, height: 1 },
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "invalid_response");
			assert.match(result.error.message, /truncated/);
			assert.match(result.error.diagnostic ?? "", /content_length=0/);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Ollama adapter associates the frame and converts normalized coordinates", async () => {
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);
	const image = Buffer.from(bytes);
	image.writeUInt32BE(1280, 16);
	image.writeUInt32BE(800, 20);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body));
		assert.equal(body.think, true);
		assert.equal(body.options.num_predict, 512);
		assert.equal(body.format.oneOf[0].properties.x.maximum, 1000);
		assert.equal(body.format.oneOf[1].properties.evidence.maxLength, 500);
		assert.equal(body.format.oneOf[2].properties.reason.maxLength, 500);
		assert.equal(body.format.oneOf[3].properties.text.maxLength, 500);
		assert.equal(body.messages[1].images[0], image.toString("base64"));
		return Response.json({
			model: "qwen3-vl:2b",
			message: { content: '{"kind":"click","x":500,"y":500}' },
			load_duration: 1_000_000,
			eval_count: 12,
		});
	};
	try {
		const result = await createOllamaVision().proposeAction({
			frameId: "frame-real-id",
			goal: "Click the visible pixel",
			image: { bytes: image, width: 1280, height: 800 },
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.value.frameId, "frame-real-id");
			assert.deepEqual(result.value.action, { kind: "click", x: 640, y: 400 });
			assert.equal(result.value.loadMs, 1);
			assert.equal(result.value.outputTokens, 12);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});
