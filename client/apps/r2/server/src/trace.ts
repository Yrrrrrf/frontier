import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
	TaskTrace,
	TaskTraceSummary,
	TraceEvent,
	TraceStatus,
	TraceTaskMetadata,
} from "../../../../sdk/core/src/schemas/frontier.ts";

const MAX_DETAIL_STRING = 500;
const SENSITIVE_KEY =
	/(?:password|authorization|bearer|secret|cookie|credential|api[-_]?key|url|base64|imagebytes|png)/i;

export type TraceEventInput = Omit<TraceEvent, "taskId" | "atMs"> & {
	atMs?: number;
};
export type TraceMetadataInput = Omit<
	TraceTaskMetadata,
	"eventCount" | "droppedEvents" | "traceFile"
>;

export interface TaskTracer {
	record(event: TraceEventInput): void;
}

export interface TraceSink {
	begin(metadata: TraceMetadataInput): void;
	/** Register request-owned secrets without storing them in metadata or JSONL. */
	protect(taskId: string, secrets: readonly string[]): void;
	record(taskId: string, event: TraceEventInput): void;
	forTask(taskId: string): TaskTracer;
	get(taskId: string): TaskTrace | undefined;
	update(
		taskId: string,
		metadata: Partial<
			Pick<TraceTaskMetadata, "acceptedAtMs" | "terminalAtMs" | "finalState">
		>,
	): void;
	flush(): Promise<void>;
}

/** Bounded, defensive text with request-owned secrets redacted before persistence. */
export function sanitizeTraceText(
	value: unknown,
	maxLength = MAX_DETAIL_STRING,
	secrets: readonly string[] = [],
): string {
	let text = String(value ?? "");
	for (const secret of [...secrets]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length)) {
		text = text.split(secret).join("[secreto]");
	}
	text = text
		.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
		.replace(/\b(?:https?|wss?):\/\/[^\s]+/gi, "[url]")
		.replace(/(?:^|\s)[A-Za-z0-9+/=\s]{128,}(?:$|\s)/g, " [base64] ");
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function sanitizeValue(
	value: unknown,
	depth: number,
	secrets: readonly string[],
): unknown {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string")
		return sanitizeTraceText(value, MAX_DETAIL_STRING, secrets);
	if (depth <= 0 || !value || typeof value !== "object") return undefined;
	if (Array.isArray(value)) {
		return value
			.slice(0, 16)
			.map((entry) => sanitizeValue(entry, depth - 1, secrets))
			.filter((entry) => entry !== undefined);
	}
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value).slice(0, 24)) {
		if (SENSITIVE_KEY.test(key)) continue;
		const sanitized = sanitizeValue(entry, depth - 1, secrets);
		if (sanitized !== undefined) {
			output[sanitizeTraceText(key, 80, secrets)] = sanitized;
		}
	}
	return output;
}

export function sanitizeTraceDetails(
	details: Record<string, unknown> | undefined,
	secrets: readonly string[] = [],
): Record<string, unknown> | undefined {
	if (!details) return undefined;
	return sanitizeValue(details, 3, secrets) as Record<string, unknown>;
}

function nonnegative(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

function summarize(
	metadata: TraceTaskMetadata,
	events: TraceEvent[],
): TaskTraceSummary {
	const summary: TaskTraceSummary = {
		...(metadata.finalState ? { finalState: metadata.finalState } : {}),
		stageDurationsMs: {},
		counters: {
			iterations: 0,
			inferenceCalls: 0,
			retries: 0,
			invalidProposals: 0,
			wrongClicks: 0,
			repeatedFrames: 0,
			lateResponses: 0,
			inputTokens: 0,
			outputTokens: 0,
		},
		evidence: metadata.traceFile ? [metadata.traceFile] : [],
	};
	for (const event of events) {
		if (event.status === "ok") summary.lastConfirmedStage = event.event;
		if (
			!summary.firstFailure &&
			(event.status === "failed" || event.status === "rejected")
		) {
			const error = event.details?.error ?? event.details?.code;
			summary.firstFailure = {
				event: event.event,
				atMs: event.atMs,
				iteration: event.iteration,
				status: event.status,
				...(typeof error === "string"
					? { error: sanitizeTraceText(error) }
					: {}),
			};
		}
		if (event.frameId && event.status === "ok")
			summary.lastFrameId = event.frameId;
		if (event.actionId && event.status === "ok")
			summary.lastActionId = event.actionId;
		if (event.durationMs !== undefined) {
			summary.stageDurationsMs[event.event] =
				(summary.stageDurationsMs[event.event] ?? 0) + event.durationMs;
		}
		summary.counters.iterations = Math.max(
			summary.counters.iterations,
			event.iteration,
		);
		if (event.event === "inference.started") summary.counters.inferenceCalls++;
		if (event.status === "started" && Number(event.details?.attempt) > 1)
			summary.counters.retries++;
		if (event.event === "action.rejected") summary.counters.invalidProposals++;
		if (event.event === "late_result.discarded")
			summary.counters.lateResponses++;
		if (event.details?.repeated === true) summary.counters.repeatedFrames++;
		if (typeof event.details?.inputTokens === "number")
			summary.counters.inputTokens += event.details.inputTokens;
		if (typeof event.details?.outputTokens === "number")
			summary.counters.outputTokens += event.details.outputTokens;
		if (typeof event.details?.evidencePath === "string") {
			const path = sanitizeTraceText(event.details.evidencePath);
			if (!summary.evidence.includes(path)) summary.evidence.push(path);
		}
	}
	return summary;
}

interface TraceRecord {
	metadata: TraceTaskMetadata;
	events: TraceEvent[];
	writes: Promise<void>;
	secrets: string[];
}

export interface MemoryTraceSinkOptions {
	maxEventsPerTask?: number;
	maxTasks?: number;
	now?: () => number;
	/** Optional ignored artifact directory. Omit for memory-only tests. */
	directory?: string;
}

/** One sanitized event stream per task. Persistence is observational and never blocks execution. */
export class MemoryTraceSink implements TraceSink {
	readonly #records = new Map<string, TraceRecord>();
	readonly #maxEvents: number;
	readonly #maxTasks: number;
	readonly #now: () => number;
	readonly #directory: string | undefined;
	readonly #ready: Promise<void>;

	constructor(options: MemoryTraceSinkOptions = {}) {
		this.#maxEvents = Math.max(1, Math.floor(options.maxEventsPerTask ?? 500));
		this.#maxTasks = Math.max(1, Math.floor(options.maxTasks ?? 100));
		this.#now = options.now ?? (() => performance.now());
		this.#directory = options.directory;
		this.#ready = this.#directory
			? mkdir(this.#directory, { recursive: true }).then(
					() => {},
					() => {},
				)
			: Promise.resolve();
	}

	begin(input: TraceMetadataInput): void {
		if (this.#records.has(input.taskId)) return;
		while (this.#records.size >= this.#maxTasks) {
			const oldest = this.#records.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.#records.delete(oldest);
		}
		const filename = `${createHash("sha256").update(input.taskId).digest("hex").slice(0, 24)}.jsonl`;
		const metadata: TraceTaskMetadata = {
			...input,
			model: { ...input.model },
			viewport: { ...input.viewport },
			...(this.#directory ? { traceFile: `artifacts/traces/${filename}` } : {}),
			eventCount: 0,
			droppedEvents: 0,
		};
		const record: TraceRecord = {
			metadata,
			events: [],
			writes: Promise.resolve(),
			secrets: [],
		};
		this.#records.set(input.taskId, record);
		this.#append(record, { type: "metadata", metadata });
	}

	protect(taskId: string, secrets: readonly string[]): void {
		const record = this.#records.get(taskId);
		if (!record) return;
		record.secrets = [
			...new Set([...record.secrets, ...secrets].filter(Boolean)),
		];
	}

	record(taskId: string, input: TraceEventInput): void {
		const record = this.#records.get(taskId);
		if (!record) return;
		const durationMs = nonnegative(input.durationMs);
		const details = sanitizeTraceDetails(input.details, record.secrets);
		const event: TraceEvent = {
			taskId,
			iteration: Math.max(0, Math.floor(input.iteration)),
			event: sanitizeTraceText(input.event, 100, record.secrets),
			atMs: nonnegative(input.atMs) ?? this.#now(),
			...(durationMs === undefined ? {} : { durationMs }),
			...(input.frameId
				? { frameId: sanitizeTraceText(input.frameId, 100, record.secrets) }
				: {}),
			...(input.actionId
				? { actionId: sanitizeTraceText(input.actionId, 100, record.secrets) }
				: {}),
			status: input.status,
			...(details ? { details } : {}),
		};
		record.metadata.eventCount++;
		record.events.push(event);
		if (record.events.length > this.#maxEvents) {
			record.events.shift();
			record.metadata.droppedEvents++;
		}
		this.#append(record, { type: "event", event });
	}

	forTask(taskId: string): TaskTracer {
		return { record: (event) => this.record(taskId, event) };
	}

	update(
		taskId: string,
		input: Partial<
			Pick<TraceTaskMetadata, "acceptedAtMs" | "terminalAtMs" | "finalState">
		>,
	): void {
		const record = this.#records.get(taskId);
		if (!record) return;
		Object.assign(record.metadata, input);
		this.#append(record, { type: "metadata", metadata: record.metadata });
	}

	get(taskId: string): TaskTrace | undefined {
		const record = this.#records.get(taskId);
		if (!record) return undefined;
		const metadata = {
			...record.metadata,
			model: { ...record.metadata.model },
			viewport: { ...record.metadata.viewport },
		};
		const events = record.events.map((event) => ({
			...event,
			...(event.details ? { details: structuredClone(event.details) } : {}),
		}));
		return { metadata, events, summary: summarize(metadata, events) };
	}

	async flush(): Promise<void> {
		await this.#ready;
		await Promise.all(
			[...this.#records.values()].map((record) => record.writes),
		);
	}

	#append(record: TraceRecord, line: unknown): void {
		const directory = this.#directory;
		if (!directory) return;
		const filename = record.metadata.traceFile?.split("/").pop();
		if (!filename) return;
		const serialized = `${JSON.stringify(line)}\n`;
		record.writes = record.writes
			.then(async () => {
				await this.#ready;
				await appendFile(join(directory, filename), serialized, "utf8");
			})
			.catch(() => {});
	}
}

export const defaultTraceMetadata = {
	serverVersion: "0.1.0",
	model: {
		requested: "unconfigured",
		temperature: 0,
		numCtx: 4096,
		numPredict: 256,
	},
	viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

export function isFailure(status: TraceStatus): boolean {
	return status === "failed" || status === "rejected";
}
