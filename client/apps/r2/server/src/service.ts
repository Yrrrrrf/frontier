import { randomUUID } from "node:crypto";
import type {
	CreateTaskRequest,
	TaskResult,
} from "../../../../sdk/core/src/schemas/frontier.ts";
import {
	defaultTraceMetadata,
	sanitizeTraceText,
	type TaskTracer,
	type TraceSink,
} from "./trace.ts";

export interface TaskExecution {
	id: string;
	request: CreateTaskRequest;
	deadlineMs: number;
	signal: AbortSignal;
	trace?: TaskTracer;
}

export interface CreateTaskOptions {
	id?: string;
	runId?: string;
	receivedAtMs?: number;
}

export type TaskRunner = (execution: TaskExecution) => Promise<string>;

interface TaskRecord {
	result: TaskResult;
	terminal: boolean;
	receivedAtMs: number;
}

export const unavailableRunner: TaskRunner = async () => {
	throw new Error("El ejecutor del escritorio todavía no está configurado.");
};

function redact(message: string, request: CreateTaskRequest): string {
	const password = request.escritorio.password;
	return password ? message.split(password).join("[secreto]") : message;
}

function publicError(error: unknown, request: CreateTaskRequest): string {
	return redact(
		error instanceof Error ? error.message : "La tarea falló.",
		request,
	);
}

/** One-process prototype state. Terminal results cannot be reopened by late work. */
export class TaskService {
	readonly #tasks = new Map<string, TaskRecord>();
	readonly #controllers = new Map<string, AbortController>();
	readonly #timeouts = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		private readonly runner: TaskRunner,
		private readonly taskBudgetMs = 300_000,
		private readonly now: () => number = () => performance.now(),
		private readonly trace?: TraceSink,
	) {}

	create(
		request: CreateTaskRequest,
		options: CreateTaskOptions = {},
	): { task_id: string } {
		const id = options.id ?? randomUUID();
		const receivedAtMs = options.receivedAtMs ?? this.now();
		const deadlineMs = receivedAtMs + this.taskBudgetMs;
		this.trace?.begin({
			...defaultTraceMetadata,
			taskId: id,
			runId: options.runId ?? randomUUID(),
			createdAt: new Date().toISOString(),
			receivedAtMs,
			deadlineAtMs: deadlineMs,
		});
		this.trace?.protect(id, [
			request.escritorio.password,
			request.escritorio.url,
		]);
		this.#tasks.set(id, {
			result: {
				estado: "en_curso",
				resumen: "Tarea registrada; ejecución pendiente.",
			},
			terminal: false,
			receivedAtMs,
		});
		const controller = new AbortController();
		this.#controllers.set(id, controller);
		this.trace?.record(id, {
			iteration: 0,
			event: "task.registered",
			status: "ok",
			details: { deadlineAtMs: deadlineMs },
		});
		void this.#execute(id, request, deadlineMs, controller);
		return { task_id: id };
	}

	get(id: string): TaskResult | undefined {
		return this.#tasks.get(id)?.result;
	}

	async #execute(
		id: string,
		request: CreateTaskRequest,
		deadlineMs: number,
		controller: AbortController,
	): Promise<void> {
		const expired = () => this.now() >= deadlineMs;
		const expire = () =>
			this.#finish(id, {
				estado: "fallida",
				resumen: "La tarea excedió el límite de cinco minutos.",
			});
		const remaining = Math.max(0, deadlineMs - this.now());
		const timeout = setTimeout(expire, remaining);
		this.#timeouts.set(id, timeout);
		try {
			// Keep request admission independent from runner setup and synchronous work.
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (expired()) {
				expire();
				return;
			}
			this.trace?.record(id, {
				iteration: 0,
				event: "runner.started",
				status: "started",
				details: { remainingMs: Math.max(0, deadlineMs - this.now()) },
			});
			const resumen = await this.runner({
				id,
				request,
				deadlineMs,
				signal: controller.signal,
				...(this.trace ? { trace: this.trace.forTask(id) } : {}),
			});
			if (expired()) expire();
			else if (controller.signal.aborted) {
				this.#finish(id, {
					estado: "fallida",
					resumen: "La ejecución fue cancelada antes de completar la tarea.",
				});
			} else {
				this.#finish(id, {
					estado: "terminada",
					resumen: redact(resumen, request),
				});
			}
		} catch (error) {
			this.trace?.record(id, {
				iteration: 0,
				event: "runner.failed",
				status: "failed",
				details: {
					code: expired() ? "deadline_exceeded" : "runner_error",
					error: sanitizeTraceText(publicError(error, request)),
				},
			});
			if (expired()) expire();
			else {
				this.#finish(id, {
					estado: "fallida",
					resumen: publicError(error, request),
				});
			}
		} finally {
			clearTimeout(timeout);
			this.#timeouts.delete(id);
			this.#controllers.delete(id);
		}
	}

	#finish(id: string, result: TaskResult): void {
		const task = this.#tasks.get(id);
		if (!task) return;
		if (task.terminal) {
			this.trace?.record(id, {
				iteration: 0,
				event: "late_result.discarded",
				status: "rejected",
				details: { attemptedState: result.estado },
			});
			return;
		}
		// Publish first: abort listeners must never observe a task still en_curso.
		task.result = result;
		task.terminal = true;
		const terminalAtMs = this.now();
		this.trace?.update(id, {
			terminalAtMs,
			finalState: result.estado,
		});
		this.trace?.record(id, {
			iteration: 0,
			event: "task.terminal",
			atMs: terminalAtMs,
			durationMs: Math.max(0, terminalAtMs - task.receivedAtMs),
			status: result.estado === "fallida" ? "failed" : "ok",
			details: {
				state: result.estado,
				summaryLength: result.resumen.length,
				secretRedaction: "applied",
			},
		});
		const timeout = this.#timeouts.get(id);
		if (timeout) clearTimeout(timeout);
		this.#timeouts.delete(id);
		this.#controllers.get(id)?.abort(new Error(result.resumen));
	}

	dispose(): void {
		for (const id of this.#controllers.keys()) {
			this.#finish(id, {
				estado: "fallida",
				resumen: "El servidor se detuvo antes de completar la tarea.",
			});
		}
		this.#controllers.clear();
	}
}
