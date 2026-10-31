import { describe, expect, it } from "vite-plus/test";
import pkg from "../../deno.json" with { type: "json" };
import { faviconUrl } from "../lib/mod.ts";
import {
	formatDuration,
	normalizeAgentUrl,
	stageLabel,
	taskTraceUrl,
} from "../lib/observability.ts";

describe("r2 observability", () => {
	it("keeps package metadata and assets valid", () => {
		expect(pkg.name).toBe("@apps/r2");
		expect(typeof faviconUrl).toBe("string");
	});

	it("normalizes agent URLs and encodes task IDs without credentials", () => {
		expect(normalizeAgentUrl("http://127.0.0.1:3000/")).toBe(
			"http://127.0.0.1:3000",
		);
		expect(taskTraceUrl("http://127.0.0.1:3000", "task/a")).toBe(
			"http://127.0.0.1:3000/tasks/task%2Fa/trace",
		);
		expect(() => normalizeAgentUrl("https://user:secret@example.com")).toThrow(
			"cannot contain credentials",
		);
		expect(() => normalizeAgentUrl("file:///tmp/agent")).toThrow(
			"HTTP or HTTPS",
		);
	});

	it("formats observed timings and boundary labels honestly", () => {
		expect(formatDuration(42)).toBe("42 ms");
		expect(formatDuration(1_200)).toBe("1.20 s");
		expect(formatDuration(65_000)).toBe("1m 5s");
		expect(formatDuration(undefined)).toBe("—");
		expect(stageLabel("effect.observed")).toBe("Visible change observed");
		expect(stageLabel("guard.ok")).toBe("Side effect authorized");
	});
});
