import type {
	PracticeWorkflow,
	WorkflowObservation,
} from "../workflow-types.ts";

interface ExportOrdersTask {
	status: string;
	fromIso: string;
	toIso: string;
	fromNative: string;
	toNative: string;
}

const MONTHS = new Map<string, number>([
	["enero", 1],
	["febrero", 2],
	["marzo", 3],
	["abril", 4],
	["mayo", 5],
	["junio", 6],
	["julio", 7],
	["agosto", 8],
	["septiembre", 9],
	["setiembre", 9],
	["octubre", 10],
	["noviembre", 11],
	["diciembre", 12],
]);

const STATUSES = new Map<string, string>([
	["pendiente", "Pendiente"],
	["pendientes", "Pendiente"],
	["entregado", "Entregado"],
	["entregados", "Entregado"],
	["cancelado", "Cancelado"],
	["cancelados", "Cancelado"],
]);

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();

function parseTask(task: string): ExportOrdersTask {
	const text = normalize(task).trim().replace(/\s+/g, " ");
	const match =
		/^exporta(?:r)? (?:el )?reporte de pedidos ([a-z]+(?: [a-z]+)*?) en (?:el mes de )?([a-z]+)(?: (?:de|del))? ([0-9]{4})[.!]?$/.exec(
			text,
		);
	if (!match)
		throw new Error(
			"Tarea no reconocida: se esperaba exportar pedidos con estado, mes y año.",
		);

	const status = STATUSES.get(match[1]!);
	const month = MONTHS.get(match[2]!);
	const year = Number(match[3]);
	if (!status || !month || year < 1000)
		throw new Error("La tarea de exportación tiene un estado, mes o año no válido.");

	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	const monthText = String(month).padStart(2, "0");
	const lastDay = String(days[month - 1]!).padStart(2, "0");
	return {
		status,
		fromIso: `${match[3]}-${monthText}-01`,
		toIso: `${match[3]}-${monthText}-${lastDay}`,
		// Chromium's native date control accepts the visible US-locale segments.
		fromNative: `${monthText}/01/${match[3]}`,
		toNative: `${monthText}/${lastDay}/${match[3]}`,
	};
}

function observationText(observation: WorkflowObservation): string {
	return normalize(observation.words.map((word) => word.text).join(" "))
		.replace(/\s*([/-])\s*/g, "$1")
		.replace(/\s+/g, " ");
}

function assertFiltersVisible(
	observation: WorkflowObservation,
	task: ExportOrdersTask,
): void {
	const text = observationText(observation);
	const fromVariants = new Set([
		task.fromNative,
		task.fromNative.replace(/(^|\/)0([1-9])/g, "$1$2"),
		task.fromIso,
	]);
	const toVariants = new Set([
		task.toNative,
		task.toNative.replace(/(^|\/)0([1-9])/g, "$1$2"),
		task.toIso,
	]);
	const missing: string[] = [];
	if (!text.includes(normalize(task.status))) missing.push(`estado ${task.status}`);
	if (![...fromVariants].some((date) => text.includes(normalize(date))))
		missing.push(`fecha Desde ${task.fromNative}`);
	if (![...toVariants].some((date) => text.includes(normalize(date))))
		missing.push(`fecha Hasta ${task.toNative}`);
	if (missing.length > 0)
		throw new Error(
			`No se pudieron confirmar visualmente los filtros: ${missing.join(", ")}.`,
		);
}

function exportEvidence(observation: WorkflowObservation): string | undefined {
	const text = observationText(observation);
	const patterns = [
		/\bexportacion\s+(?:completada|exitosa|realizada|finalizada)\b/,
		/\b(?:reporte|archivo)\b(?:\s+[a-z0-9_.-]+){0,7}\s+\b(?:exportad[oa]|exporto|descargad[oa]|descargo|generad[oa])\b/,
		/\bexportad[oa]\s+(?:correctamente|con\s+exito)\b/,
		/\bdescarga\b(?:\s+[a-z0-9_.-]+){0,5}\s+\b(?:iniciada|completada|finalizada)\b/,
		/\b[a-z0-9_.-]*(?:pedidos|reporte)[a-z0-9_.-]*\.(?:csv|xlsx?|pdf)\b/,
	];
	for (const pattern of patterns) {
		const match = pattern.exec(text);
		if (match) return match[0];
	}
	return undefined;
}

export const runE4Workflow: PracticeWorkflow = async (taskText, driver) => {
	// Reject unrelated or malformed tasks before touching the shared desktop.
	const task = parseTask(taskText);
	let screen = await driver.observe();
	if (driver.find(screen, "Entendido"))
		screen = await driver.click(screen, "Entendido");

	screen = await driver.click(screen, "Comercial");
	screen = await driver.click(screen, "Ventas");
	screen = await driver.click(screen, "Pedidos");
	screen = await driver.choose(screen, "Estado", task.status, 60, 18);
	screen = await driver.replace(screen, "Desde", task.fromNative, 70, 18);
	screen = await driver.replace(screen, "Hasta", task.toNative, 70, 18);
	assertFiltersVisible(screen, task);

	screen = await driver.click(screen, "Filtrar");
	assertFiltersVisible(screen, task);
	const evidenceBeforeExport = exportEvidence(screen);
	screen = await driver.click(screen, "Exportar");

	// Export is deliberately clicked once. A delayed toast/download is evidence;
	// an unchanged screen or the mere disappearance of the button is not.
	let evidence = exportEvidence(screen);
	for (let poll = 0; (!evidence || evidence === evidenceBeforeExport) && poll < 3; poll++) {
		screen = await driver.observe();
		evidence = exportEvidence(screen);
	}
	if (!evidence || evidence === evidenceBeforeExport)
		throw new Error(
			"Se solicitó Exportar una vez, pero no se observó confirmación ni evidencia de descarga.",
		);

	driver.step("completed", "export_orders");
	return `Reporte de pedidos ${task.status} exportado para ${task.fromIso} a ${task.toIso}; confirmación visual observada.`;
};
