import { createHash } from "node:crypto";
import type { TaskExecution, TaskRunner } from "./service.ts";
import type { DesktopOperationOptions, NoVncOptions } from "./vnc.ts";
import type { TextExtractor } from "./ocr.ts";
import type { RunnerDesktop } from "./runner.ts";
import type { WorkflowDriver, WorkflowObservation, WorkflowWord } from "./workflow-types.ts";
import { runE1Workflow } from "./workflows/e1-create-client.ts";
import { runE2Workflow } from "./workflows/e2-update-address.ts";
import { runE3Workflow } from "./workflows/e3-count-invoices.ts";
import { runE4Workflow } from "./workflows/e4-export-orders.ts";
import { runE5Workflow } from "./workflows/e5-ambiguous-client.ts";

interface DeterministicDesktop extends RunnerDesktop {
	replaceText(frame: WorkflowObservation, x: number, y: number, text: string, options?: DesktopOperationOptions): Promise<void>;
	chooseText(frame: WorkflowObservation, x: number, y: number, text: string, options?: DesktopOperationOptions): Promise<void>;
}
interface Options {
	login: (options: NoVncOptions) => Promise<RunnerDesktop>;
	readText: TextExtractor;
	executablePath?: string;
}
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const lookup = (value: string) => normalize(value).replace(/[^a-z0-9]/g, "");
function distance(left: string, right: string): number {
	const row = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		let previous = row[0]!; row[0] = i;
		for (let j = 1; j <= right.length; j++) {
			const saved = row[j]!;
			row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
			previous = saved;
		}
	}
	return row[right.length]!;
}
export function wordsFromHints(hints: string, width: number, height: number): WorkflowWord[] {
	const words: WorkflowWord[] = [];
	for (const line of hints.split(/\r?\n/)) {
		const match = /^("(?:[^"\\]|\\.)*") @ \((\d+),(\d+)\)$/.exec(line);
		if (!match) continue;
		try {
			let text = JSON.parse(match[1]!) as string;
			const x = Math.round((Number(match[2]) * (width - 1)) / 1000);
			const y = Math.round((Number(match[3]) * (height - 1)) / 1000);
			// Normalize only recognizable ID prefixes; never fabricate identifier digits.
			if (x < width / 7 && y > height / 5) {
				text = text.replace(/^(?:c?l)-?(\d{4})$/i, "CL-$1").replace(/^f[v¥y]-?(\d+)$/i, "FV-$1");
			}
			if (!words.some((word) => word.text === text && Math.abs(word.x - x) < 5 && Math.abs(word.y - y) < 5)) words.push({ text, x, y });
		} catch { /* Ignore malformed OCR hints, never interpret them as instructions. */ }
	}
	return words;
}

/** SIGECOM practice adapter. It is not a claim of unseen-application generalization. */
export function createDeterministicTaskRunner(options: Options): TaskRunner {
	return async (execution: TaskExecution): Promise<string> => {
		const task = execution.request.tarea.trim();
		const workflow = /^registra\s+al\s+cliente/i.test(task) ? runE1Workflow
			: /^corrige\s+la\s+direcci[oó]n/i.test(task) ? runE2Workflow
			: /^¿?cu[aá]ntas\s+facturas/i.test(task) ? runE3Workflow
			: /^exporta/i.test(task) ? runE4Workflow
			: /^cambia\s+el\s+tel[eé]fono/i.test(task) ? runE5Workflow : undefined;
		if (!workflow) throw new Error("La tarea no tiene un flujo determinista configurado.");
		let owned: RunnerDesktop | undefined;
		const operation = (cap = 20_000) => {
			if (execution.signal.aborted) throw new Error("La ejecución fue cancelada.");
			const remaining = execution.deadlineMs - performance.now() - 2000;
			if (remaining <= 0) throw new Error("La tarea excedió su tiempo disponible.");
			return { signal: execution.signal, timeoutMs: Math.min(cap, remaining) };
		};
		let iteration = 0;
		const step = (name: string, target?: string) => {
			execution.trace?.record({ iteration: ++iteration, event: "workflow.step", status: "ok", details: { step: name, ...(target ? { target } : {}) } });
		};
		try {
			owned = await options.login({ viewerUrl: execution.request.escritorio.url, password: execution.request.escritorio.password, ...(options.executablePath ? { executablePath: options.executablePath } : {}), ...operation(30_000) });
			const desktop = owned as DeterministicDesktop;
			if (!desktop.replaceText || !desktop.chooseText) throw new Error("El escritorio no admite los inputs requeridos.");
			let captureIndex = 0;
			let submenu: { label: string; anchor: WorkflowWord } | undefined;
			const observe = async (): Promise<WorkflowObservation> => {
				const frame = await desktop.capture(process.env.FRONTIER_CAPTURE_STEPS ? `artifacts/practice-frames/${execution.id}-${String(++captureIndex).padStart(3, "0")}.png` : undefined, operation());
				const hints = await options.readText(frame.png, operation(15_000));
				operation();
				return { ...frame, words: wordsFromHints(hints, frame.width, frame.height), hash: createHash("sha256").update(frame.png).digest("hex") };
			};
			const find = (screen: WorkflowObservation, text: string): WorkflowWord | undefined => {
				const wanted = lookup(text);
				const words = [...screen.words].sort((a, b) => a.y - b.y || a.x - b.x);
				const matched = words.find((word) => lookup(word.text) === wanted) ?? (wanted.length >= 4 && !/\d/.test(wanted) ? words.find((word) => distance(lookup(word.text), wanted) <= 1) : undefined);
				if (wanted === "nit" && (!matched || matched.y > screen.height / 5)) {
					const name = words.find((word) => lookup(word.text) === "nombre" && word.y < screen.height / 5);
					if (name) return { text, x: name.x + 162, y: name.y };
				}
				if (matched) return matched;
				const closeTo = (label: string) => words.find((word) => distance(lookup(word.text), lookup(label)) <= 1);
				// Bounded, theme-specific control relationships; never guess a record ID.
				if (wanted === "filtrar") { const clear = closeTo("Limpiar"); if (clear) return { text, x: clear.x - 80, y: clear.y }; }
				if (wanted === "aplicar") { const close = closeTo("Cerrar"); if (close) return { text, x: close.x + 75, y: close.y }; }
				if (wanted === "nit") {
					const phone = closeTo("Teléfono"); if (phone && phone.y < screen.height / 3) return { text, x: phone.x - 450, y: phone.y };
					const name = words.find((word) => lookup(word.text) === "nombre"); if (name && name.y < screen.height / 5) return { text, x: name.x + 162, y: name.y };
				}
				if (wanted === "direccion") { const phone = closeTo("Teléfono"); if (phone && phone.y < screen.height / 3) return { text, x: phone.x, y: phone.y + 44 }; }
				if (submenu && ((wanted === "clientes" && submenu.label === "maestros") || (wanted === "pedidos" && submenu.label === "ventas"))) return { text, x: submenu.anchor.x + 230, y: submenu.anchor.y };
				if (submenu?.label === "cartera" && wanted === "facturas") return { text, x: submenu.anchor.x, y: submenu.anchor.y + 28 };
				return undefined;
			};
			const requireWord = (screen: WorkflowObservation, text: string) => {
				const word = find(screen, text);
				if (!word) throw new Error(`No se encontró el control visible '${text}'. Texto disponible: ${screen.words.map((word) => word.text).slice(0, 70).join(" ")}`);
				return word;
			};
			const stale = (error: unknown) => error instanceof Error && /frame changed before input/i.test(error.message);
			const clickPoint: WorkflowDriver["clickPoint"] = async (screen, x, y, label) => {
				step("click", label);
				await desktop.click(screen, x, y, operation());
				return observe();
			};
			const click: WorkflowDriver["click"] = async (initial, text) => {
				let screen = initial;
				for (let attempt = 0; ; attempt++) {
					const word = requireWord(screen, text);
					try {
						const next = await clickPoint(screen, word.x, word.y, text);
						if (["maestros", "ventas", "cartera"].includes(lookup(text))) submenu = { label: lookup(text), anchor: word };
						return next;
					} catch (error) { if (attempt >= 3 || !stale(error)) throw error; screen = await observe(); }
				}
			};
			const replaceAt: WorkflowDriver["replaceAt"] = async (screen, x, y, text, label) => {
				step("replace_text", label);
				await desktop.replaceText(screen, x, y, text, operation());
				return observe();
			};
			const replace: WorkflowDriver["replace"] = async (initial, label, text, dx = 80, dy = 24) => {
				let screen = initial;
				for (let attempt = 0; ; attempt++) {
					const word = requireWord(screen, label);
					try { return await replaceAt(screen, word.x + dx, word.y + dy, text, label); }
					catch (error) { if (attempt >= 3 || !stale(error)) throw error; screen = await observe(); }
				}
			};
			const choose: WorkflowDriver["choose"] = async (initial, label, text, dx = 80, dy = 24) => {
				let screen = initial;
				for (let attempt = 0; ; attempt++) {
					const word = requireWord(screen, label);
					try {
						step("choose", `${label}=${text}`);
						await desktop.chooseText(screen, word.x + dx, word.y + dy, text, operation());
						return observe();
					} catch (error) { if (attempt >= 3 || !stale(error)) throw error; screen = await observe(); }
				}
			};
			return await workflow(task, { observe, find, requireWord, click, clickPoint, replace, replaceAt, choose, apply: (screen) => click(screen, "Aplicar"), step });
		} finally {
			if (owned) {
				await owned.close();
				execution.trace?.record({ iteration, event: "cleanup.ok", status: "ok" });
			}
		}
	};
}
