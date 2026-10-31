import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NoVncDesktop } from "./vnc.ts";
import { createOllamaVision, type VisionResult } from "./vision.ts";

const viewerUrl = process.env.DESKTOP_URL;
const password = process.env.DESKTOP_PASSWORD;
if (!viewerUrl || !password) throw new Error("DESKTOP_URL and DESKTOP_PASSWORD must be configured");

const target = { label: "Comercial", left: 180, top: 68, right: 315, bottom: 123 };
const desktop = await NoVncDesktop.login({
  viewerUrl,
  password,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
let frame: Awaited<ReturnType<NoVncDesktop["capture"]>>;
try {
  frame = await desktop.capture(resolve("artifacts/vision-sigecom.png"));
} finally {
  await desktop.close();
}

const model = process.env.VISION_MODEL ?? "qwen3-vl:2b";
const vision = createOllamaVision({ model, timeoutMs: 120_000 });
const runCount = Number(process.env.VISION_RUNS ?? 3);
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 10) {
  throw new Error("VISION_RUNS must be an integer from 1 to 10");
}
const results: VisionResult[] = [];
for (let run = 0; run < runCount; run++) {
  results.push(await vision.proposeAction({
    frameId: randomUUID(),
    goal: "Haz clic en el menú Comercial.",
    image: { bytes: frame.png, width: frame.width, height: frame.height },
  }));
}
const hits = results.filter((result) => result.ok && result.value.action.kind === "click" &&
  result.value.action.x >= target.left && result.value.action.x < target.right &&
  result.value.action.y >= target.top && result.value.action.y < target.bottom);
const report = {
  status: hits.length === runCount ? "PASS" : "FAIL",
  source: "real noVNC SIGECOM capture; no click executed",
  model,
  image: { width: frame.width, height: frame.height },
  goal: "Haz clic en el menú Comercial.",
  target,
  runs: runCount,
  hits: hits.length,
  results,
};
await writeFile(resolve("artifacts/vision-report.json"), JSON.stringify(report, null, 2));
if (hits.length !== runCount) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error(`Only ${hits.length}/${runCount} vision proposals hit Comercial`);
}
for (const result of results) {
  if (result.ok && result.value.action.kind === "click") {
    console.log(`PASS ${model}: Comercial click (${result.value.action.x},${result.value.action.y}) in ${Math.round(result.value.elapsedMs)}ms`);
  }
}
