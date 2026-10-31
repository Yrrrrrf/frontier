import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAction, createOllamaVision } from "../src/vision.ts";

test("ActionGuard accepts bounded actions and rejects malformed coordinates", () => {
  assert.deepEqual(validateAction({ kind: "click", x: 10, y: 20 }, 100, 100), { kind: "click", x: 10, y: 20 });
  assert.deepEqual(validateAction({ kind: "fail", reason: "Not visible" }, 100, 100), { kind: "fail", reason: "Not visible" });
  for (const action of [
    { kind: "click", x: -1, y: 20 },
    { kind: "click", x: 100, y: 20 },
    { kind: "click", x: 1.5, y: 20 },
    { kind: "click", x: 10, y: 20, extra: true },
    { kind: "finish", evidence: " " },
    { kind: "unknown" },
  ]) assert.throws(() => validateAction(action, 100, 100));
});

test("Ollama adapter associates the frame and parses a real envelope", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.format.oneOf[0].properties.x.maximum, 0);
    assert.equal(body.messages[1].images[0], bytes.toString("base64"));
    return Response.json({
      model: "qwen3-vl:2b",
      message: { content: '{"kind":"click","x":0,"y":0}' },
      load_duration: 1_000_000,
      eval_count: 12,
    });
  };
  try {
    const result = await createOllamaVision().proposeAction({
      frameId: "frame-real-id",
      goal: "Click the visible pixel",
      image: { bytes, width: 1, height: 1 },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.frameId, "frame-real-id");
      assert.equal(result.value.loadMs, 1);
      assert.equal(result.value.outputTokens, 12);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
