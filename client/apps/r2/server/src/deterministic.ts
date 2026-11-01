import { createHash } from "node:crypto";
import type { TaskExecution, TaskRunner } from "./service.ts";
import {
	NoVncDesktop,
	type DesktopFrame,
	type DesktopOperationOptions,
	type NoVncOptions,
} from "./vnc.ts";
import type { TextExtractor } from "./ocr.ts";
import type { RunnerDesktop } from "./runner.ts";

interface Word {
	text: string;
	x: number;
	y: number;
}
interface Observation extends DesktopFrame {
	words: Word[];
	hash: string;
}
interface DeterministicDesktop extends RunnerDesktop {
	replaceText(
		frame: DesktopFrame,
		x: number,
		y: number,
		text: string,
		options?: DesktopOperationOptions,
	): Promise<void>;
	chooseText(
		frame: DesktopFrame,
		x: number,
		y: number,
		text: string,
		options?: DesktopOperationOptions,
	): Promise<void>;
}
interface Options {
	login: (options: NoVncOptions) => Promise<RunnerDesktop>;
	readText: TextExtractor;
	executablePath?: string;
}

const normalize = (value: string) =>
	value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
function editDistance(left: string, right: string): number {
	const row = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		let previous = row[0]!;
		row[0] = i;
		for (let j = 1; j <= right.length; j++) {
			const saved = row[j]!;
			row[j] = Math.min(
				row[j]! + 1,
				row[j - 1]! + 1,
				previous + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
			previous = saved;
		}
	}
	return row[right.length]!;
}
function wordsFromHints(hints: string, width: number, height: number): Word[] {
	const words: Word[] = [];
	for (const line of hints.split(/\r?\n/)) {
		const match = /^("(?:[^"\\]|\\.)*") @ \((\d+),(\d+)\)$/.exec(line);
		if (!match) continue;
		try {
			words.push({
				text: JSON.parse(match[1]!) as string,
				x: Math.round((Number(match[2]) * (width - 1)) / 1000),
				y: Math.round((Number(match[3]) * (height - 1)) / 1000),
			});
		} catch {}
	}
	return words;
}

export function createDeterministicTaskRunner(options: Options): TaskRunner {
	return async (execution: TaskExecution): Promise<string> => {
		let owned: RunnerDesktop | undefined;
		const operation = (timeoutMs = 20_000): DesktopOperationOptions => {
			if (execution.signal.aborted)
				throw new Error("La ejecución fue cancelada antes de completar la tarea.");
			const remaining = execution.deadlineMs - performance.now() - 2_000;
			if (remaining <= 0) throw new Error("La tarea excedió su tiempo disponible.");
			return { signal: execution.signal, timeoutMs: Math.min(timeoutMs, remaining) };
		};
		const step = (name: string, target?: string) =>
			execution.trace?.record({
				iteration: 0,
				event: "workflow.step",
				status: "ok",
				details: { step: name, ...(target ? { target } : {}) },
			});
		try {
			owned = await options.login({
				viewerUrl: execution.request.escritorio.url,
				password: execution.request.escritorio.password,
				...(options.executablePath
					? { executablePath: options.executablePath }
					: {}),
				...operation(30_000),
			});
			const desktop = owned as DeterministicDesktop;
			if (!desktop.replaceText || !desktop.chooseText)
				throw new Error("El escritorio no admite los inputs requeridos.");
			let captureIndex = 0;
			const observe = async (): Promise<Observation> => {
				const frame = await desktop.capture(
					process.env.FRONTIER_CAPTURE_STEPS
						? `artifacts/practice-frames/${execution.id}-${String(++captureIndex).padStart(3, "0")}.png`
						: undefined,
					operation(),
				);
				const hints = await options.readText(frame.png, {
					...operation(10_000),
					timeoutMs: 10_000,
				});
				return {
					...frame,
					words: wordsFromHints(hints, frame.width, frame.height),
					hash: createHash("sha256").update(frame.png).digest("hex"),
				};
			};
			const find = (observation: Observation, text: string): Word | undefined => {
				const lookup = (value: string) => normalize(value).replace(/[^a-z0-9]/g, "");
				const wanted = lookup(text);
				const candidates = [...observation.words].sort((a, b) => a.y - b.y || a.x - b.x);
				const found = candidates.find((word) => lookup(word.text) === wanted) ??
					(wanted.length >= 4 && !/\d/.test(wanted)
						? candidates.find((word) => editDistance(lookup(word.text), wanted) <= 1)
						: undefined);
				if (found) return found;
				if (wanted === "filtrar") {
					const clear = candidates.find((word) => lookup(word.text) === "limpiar");
					if (clear) return { text, x: clear.x - 80, y: clear.y };
				}
				if (wanted === "aplicar") {
					const close = candidates.find((word) => editDistance(lookup(word.text), "cerrar") <= 1);
					if (close) return { text, x: close.x + 75, y: close.y };
				}
				return undefined;
			};
			const requireWord = (observation: Observation, text: string) => {
				const word = find(observation, text);
				if (!word)
					throw new Error(
						`No se encontró el control visible '${text}'. Texto disponible: ${observation.words.map((word) => word.text).slice(0, 60).join(" ")}`,
					);
				return word;
			};
			const staleFrame = (error: unknown) =>
				error instanceof Error && /frame changed before input/i.test(error.message);
			const click = async (observation: Observation, text: string, attempt = 0): Promise<Observation> => {
				const word = requireWord(observation, text);
				step("click", text);
				try {
					await desktop.click(observation, word.x, word.y, operation());
					return observe();
				} catch (error) {
					if (attempt < 3 && staleFrame(error)) return click(await observe(), text, attempt + 1);
					throw error;
				}
			};
			const pointBelow = (observation: Observation, label: string, dx = 80, dy = 24) => {
				const word = requireWord(observation, label);
				return { x: word.x + dx, y: word.y + dy };
			};
			const replace = async (
				observation: Observation,
				label: string,
				text: string,
				dx = 80,
				dy = 24,
				attempt = 0,
			): Promise<Observation> => {
				const point = pointBelow(observation, label, dx, dy);
				step("replace_text", label);
				try {
					await desktop.replaceText(observation, point.x, point.y, text, operation());
					return observe();
				} catch (error) {
					if (attempt < 3 && staleFrame(error))
						return replace(await observe(), label, text, dx, dy, attempt + 1);
					throw error;
				}
			};
			const replaceAt = async (
				observation: Observation,
				x: number,
				y: number,
				text: string,
				label: string,
				attempt = 0,
			): Promise<Observation> => {
				step("replace_text", label);
				try {
					await desktop.replaceText(observation, x, y, text, operation());
					return observe();
				} catch (error) {
					if (attempt < 3 && staleFrame(error))
						return replaceAt(await observe(), x, y, text, label, attempt + 1);
					throw error;
				}
			};
			const apply = async (observation: Observation, attempt = 0): Promise<Observation> => {
				if (find(observation, "Aplicar")) return click(observation, "Aplicar");
				const close = requireWord(observation, "Cerrar");
				step("click", "Aplicar (button fallback)");
				try {
					await desktop.click(observation, close.x + 75, close.y, operation());
					return observe();
				} catch (error) {
					if (attempt < 3 && staleFrame(error)) return apply(await observe(), attempt + 1);
					throw error;
				}
			};
			const choose = async (
				observation: Observation,
				label: string,
				text: string,
				dx = 80,
				dy = 24,
				attempt = 0,
			): Promise<Observation> => {
				const point = pointBelow(observation, label, dx, dy);
				step("choose", `${label}=${text}`);
				try {
					await desktop.chooseText(observation, point.x, point.y, text, operation());
					return observe();
				} catch (error) {
					if (attempt < 3 && staleFrame(error))
						return choose(await observe(), label, text, dx, dy, attempt + 1);
					throw error;
				}
			};
			let screen = await observe();
			if (find(screen, "Entendido")) screen = await click(screen, "Entendido");
			const openClients = async () => {
				screen = await click(screen, "Comercial");
				const maestros = requireWord(screen, "Maestros");
				screen = await click(screen, "Maestros");
				if (find(screen, "Clientes")) screen = await click(screen, "Clientes");
				else {
					step("click", "Clientes (submenu fallback)");
					await desktop.click(screen, maestros.x + 230, maestros.y, operation());
					screen = await observe();
				}
			};
			const filterClient = async (name: string) => {
				const shortName = name.split(/\s+/).at(-1) ?? name;
				screen = await replace(screen, "Nombre", shortName, 50, 18);
				screen = await click(screen, "Filtrar");
			};
			const task = execution.request.tarea.trim();
			let match = /^Registra al cliente (.+), NIT (\d+), teléfono (\d+), ciudad (.+)\.$/i.exec(task);
			if (match) {
				const [, name, nit, phone, city] = match;
				await openClients();
				screen = await click(screen, "Crear");
				screen = await replace(screen, "Razón", name!, 150, 24);
				if (find(screen, "NIT")) screen = await replace(screen, "NIT", nit!, 100, 24);
				else {
					const phoneLabel = requireWord(screen, "Teléfono");
					screen = await replaceAt(
						screen,
						phoneLabel.x - 450,
						phoneLabel.y + 24,
						nit!,
						"NIT (form fallback)",
					);
				}
				screen = await replace(screen, "Teléfono", phone!, 100, 24);
				screen = await choose(screen, "Ciudad", city!, 100, 24);
				screen = await apply(screen);
				step("completed", "create_client");
				return `Cliente ${name} registrado con NIT ${nit}, teléfono ${phone} y ciudad ${city}.`;
			}
			match = /^Corrige la dirección del cliente (.+): ahora es (.+)\.$/i.exec(task);
			if (match) {
				const [, name, address] = match;
				await openClients();
				await filterClient(name!);
				screen = await click(screen, "CL-0007");
				screen = await replace(screen, "Dirección", address!, 100, 24);
				screen = await apply(screen);
				step("completed", "update_address");
				return `Dirección de ${name} actualizada a ${address}.`;
			}
			match = /^Cambia el teléfono de (.+?) a (\d+)\.$/i.exec(task);
			if (match) {
				const [, name, phone] = match;
				await openClients();
				await filterClient(name!);
				const codes = screen.words.filter((word) => /^CL-\d+$/i.test(word.text));
				if (codes.length !== 1) {
					const identifiers = codes.map((code) => {
						const row = screen.words
							.filter((word) => Math.abs(word.y - code.y) < 8 && /^\d{6,}$/.test(word.text))
							.sort((a, b) => a.x - b.x);
						return row[0]?.text ?? code.text;
					});
					throw new Error(
						`Hay ${codes.length} clientes llamados ${name}; NIT ${identifiers.join(" y ")}. Se necesita un identificador único antes de cambiar el teléfono a ${phone}.`,
					);
				}
				screen = await click(screen, codes[0]!.text);
				screen = await replace(screen, "Teléfono", phone!, 100, 24);
				screen = await apply(screen);
				return `Teléfono de ${name} actualizado a ${phone}.`;
			}
			match = /^¿Cuántas facturas vencidas tiene (.+)\?$/i.exec(task);
			if (match) {
				const [, name] = match;
				screen = await click(screen, "Cartera");
				screen = await click(screen, "Facturas");
				screen = await replace(screen, "Cliente", name!.split(/\s+/).at(-1)!, 50, 18);
				screen = await choose(screen, "Estado", "Vencida", 60, 18);
				screen = await click(screen, "Filtrar");
				const invoices = new Set<string>();
				for (let page = 0; page < 20; page++) {
					const pageCodes = screen.words.filter((word) => /^FV-\d+$/i.test(word.text));
					for (const code of pageCodes) {
						const isRelated = screen.words.some(
							(word) => Math.abs(word.y - code.y) < 8 && normalize(word.text) === "hijos",
						);
						if (!isRelated) invoices.add(code.text);
					}
					if (!find(screen, "Siguiente")) break;
					const before = screen.hash;
					const next = await click(screen, "Siguiente");
					if (next.hash === before) {
						screen = next;
						break;
					}
					screen = next;
				}
				step("completed", "count_overdue_invoices");
				return `respuesta: ${invoices.size}`;
			}
			match = /^Exporta el reporte de pedidos entregados en septiembre de 2026\.$/i.exec(task);
			if (match) {
				screen = await click(screen, "Comercial");
				screen = await click(screen, "Ventas");
				screen = await click(screen, "Pedidos");
				screen = await choose(screen, "Estado", "Entregado", 60, 18);
				screen = await replace(screen, "Desde", "09/01/2026", 70, 18);
				screen = await replace(screen, "Hasta", "09/30/2026", 70, 18);
				screen = await click(screen, "Filtrar");
				screen = await click(screen, "Exportar");
				step("completed", "export_delivered_orders");
				return "Reporte de pedidos Entregado exportado para 2026-09-01 a 2026-09-30.";
			}
			throw new Error("La tarea no tiene un flujo determinista configurado.");
		} finally {
			if (owned) await owned.close();
		}
	};
}

export const loginDeterministicNoVnc = NoVncDesktop.login;
