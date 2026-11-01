import { fileURLToPath } from "node:url";
import { createAgentServer } from "./http.ts";
import { loginNoVnc } from "./runner.ts";
import { createDeterministicReadiness } from "./readiness.ts";
import { createDeterministicTaskRunner } from "./deterministic.ts";
import { createRobustTextExtractor } from "./ocr.ts";
import { MemoryTraceSink } from "./trace.ts";

const token = process.env.TEAM_TOKEN;
if (!token) throw new Error("TEAM_TOKEN must be configured");
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65_535)
	throw new Error("PORT must be a valid TCP port");
const model = "deterministic-ocr";
const executablePath = process.env.CHROMIUM_EXECUTABLE;
const tesseractExecutable = process.env.TESSERACT_EXECUTABLE;
const uiOrigins = (
	process.env.FRONTIER_UI_ORIGINS ??
	"http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173"
)
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);
const readiness = createDeterministicReadiness({
	tesseractExecutable: tesseractExecutable ?? "tesseract",
	...(executablePath ? { executablePath } : {}),
});
const traces = new MemoryTraceSink({
	directory: fileURLToPath(new URL("../artifacts/traces/", import.meta.url)),
});
const runner = createDeterministicTaskRunner({
	login: loginNoVnc,
	readText: createRobustTextExtractor(tesseractExecutable ?? "tesseract"),
	...(executablePath ? { executablePath } : {}),
});
const { server } = createAgentServer({
	token,
	runner,
	readiness: readiness.isReady,
	trace: traces,
	model,
	uiOrigins,
});
readiness.start();
void readiness.refresh();
server.on("close", () => readiness.stop());
server.listen(port, "0.0.0.0", () => {
	console.log(`Frontier agent listening on port ${port}`);
});
