import { randomUUID } from "node:crypto";
import type {
	CreateTaskRequest,
	TaskResult,
} from "../../../../sdk/core/src/schemas/frontier.ts";

export interface TaskExecution {
	id: string;
	request: CreateTaskRequest;
	deadlineMs: number;
	signal: AbortSignal;
}

export type TaskRunner = (execution: TaskExecution) => Promise<string>;

interface TaskRecord {
	result: TaskResult;
	terminal: boolean;
}

export const unavailableRunner: TaskRunner = async () => {
	throw new Error("El ejecutor del escritorio todavía no está configurado.");
};

function publicError(error: unknown, request: CreateTaskRequest): string {
	const message = error instanceof Error ? error.message : "La tarea falló.";
	const password = request.escritorio.password;
	return password ? message.split(password).join("[secreto]") : message;
}

/** One-process prototype state. Terminal results cannot be reopened by late work. */
export class TaskService {
	readonly #tasks = new Map<string, TaskRecord>();
	readonly #controllers = new Map<string, AbortController>();

	constructor(
		private readonly runner: TaskRunner,
		private readonly taskBudgetMs = 300_000,
		private readonly now: () => number = () => performance.now(),
	) {}

	create(request: CreateTaskRequest): { task_id: string } {
		const id = randomUUID();
		this.#tasks.set(id, {
			result: {
				estado: "en_curso",
				resumen: "Tarea registrada; ejecución pendiente.",
			},
			terminal: false,
		});
		const controller = new AbortController();
		this.#controllers.set(id, controller);
		const deadlineMs = this.now() + this.taskBudgetMs;
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
		const remaining = Math.max(0, deadlineMs - this.now());
		const timeout = setTimeout(() => {
			controller.abort(
				new Error("La tarea excedió el límite de cinco minutos."),
			);
			this.#finish(id, {
				estado: "fallida",
				resumen: "La tarea excedió el límite de cinco minutos.",
			});
		}, remaining);
		try {
			const resumen = await this.runner({
				id,
				request,
				deadlineMs,
				signal: controller.signal,
			});
			this.#finish(id, { estado: "terminada", resumen });
		} catch (error) {
			this.#finish(id, {
				estado: "fallida",
				resumen: publicError(error, request),
			});
		} finally {
			clearTimeout(timeout);
			this.#controllers.delete(id);
		}
	}

	#finish(id: string, result: TaskResult): void {
		const task = this.#tasks.get(id);
		if (!task || task.terminal) return;
		task.result = result;
		task.terminal = true;
		this.#controllers.get(id)?.abort();
	}

	dispose(): void {
		for (const controller of this.#controllers.values()) controller.abort();
		this.#controllers.clear();
	}
}
