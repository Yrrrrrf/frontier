import type {
	PracticeWorkflow,
	WorkflowObservation,
	WorkflowWord,
} from "../workflow-types.ts";

const ROW_Y_TOLERANCE = 8;
const MAX_PAGES = 100;
const INVOICE_ID = /^[FE][V¥Y]-?\d+$/i;
const KNOWN_STATES = new Set(["vencida", "pendiente", "pagada", "anulada"]);

interface InvoiceRow {
	id: string;
	client: string;
	state: string;
}

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");

function rowWords(
	observation: WorkflowObservation,
	anchor: WorkflowWord,
): WorkflowWord[] {
	return observation.words
		.filter((word) => Math.abs(word.y - anchor.y) <= ROW_Y_TOLERANCE)
		.sort((left, right) => left.x - right.x);
}

function requireInvoiceTable(observation: WorkflowObservation): void {
	const hasHeader = observation.words.some(
		(code) =>
			normalize(code.text) === "codigo" &&
			["cliente", "fecha", "estado"].every((header) =>
				observation.words.some(
					(word) =>
						normalize(word.text) === header &&
						Math.abs(word.y - code.y) <= ROW_Y_TOLERANCE,
				),
			),
	);
	if (!hasHeader) {
		throw new Error(
			"No se pudo verificar la tabla de facturas después de aplicar los filtros.",
		);
	}
}

function readInvoiceRows(observation: WorkflowObservation): InvoiceRow[] {
	const header = observation.words.find((word) => normalize(word.text) === "codigo");
	if (!header) throw new Error("No se encontró la cabecera de facturas.");
	const headers = rowWords(observation, header);
	const clientHeader = headers.find((word) => normalize(word.text) === "cliente");
	const dateHeader = headers.find((word) => normalize(word.text) === "fecha");
	const stateHeader = headers.find((word) => normalize(word.text) === "estado");
	if (!clientHeader || !dateHeader || !stateHeader) throw new Error("No se pudieron medir las columnas de facturas.");
	const anchors = observation.words.filter((word) => word.y > header.y + 12 && Math.abs(word.x - stateHeader.x) < 100 && KNOWN_STATES.has(normalize(word.text)));
	const rows: InvoiceRow[] = [];
	const seenY: number[] = [];
	for (const anchor of anchors) {
		if (seenY.some((y) => Math.abs(y - anchor.y) <= ROW_Y_TOLERANCE)) continue;
		seenY.push(anchor.y);
		const words = rowWords(observation, anchor);
		const client = words.filter((word) => word.x >= clientHeader.x - 28 && word.x < dateHeader.x - 24).map((word) => word.text).join(" ");
		const state = normalize(anchor.text);
		if (state !== "vencida") throw new Error(`El filtro Vencida no quedó aplicado: aparece ${anchor.text}.`);
		const code = words.find((word) => word.x < clientHeader.x - 28 && INVOICE_ID.test(word.text.replace(/[—–]/g, "-")));
		const cells = words.filter((word) => word.x >= dateHeader.x - 24).map((word) => normalize(word.text)).join("|");
		const visibleCode = code?.text.toUpperCase().replace(/[—–]/g, "-");
		const fallbackCode = words.filter((word) => word.x < clientHeader.x - 28).map((word) => word.text).join("");
		if (!client) throw new Error("Una factura visible no tiene cliente legible.");
		rows.push({ id: `${visibleCode ?? fallbackCode}|${cells}`, client, state });
	}
	return rows;
}

function sameClient(observed: string, requested: string): boolean {
	const left = normalize(observed).split(" "), right = normalize(requested).split(" ");
	if (left.length !== right.length) return false;
	return left.every((part, index) => {
		const wanted = right[index]!;
		if (part === wanted) return true;
		// Permit a single OCR substitution only in a long token; surnames and
		// extra words remain exact, so similarly named subsidiaries stay excluded.
		if (part.length < 8 || part.length !== wanted.length) return false;
		return [...part].filter((character, i) => character !== wanted[i]).length <= 1;
	});
}

export const runE3Workflow: PracticeWorkflow = async (task, driver) => {
	const match = /^¿\s*cuántas\s+facturas\s+vencidas\s+tiene\s+(.+?)\s*\?\s*$/iu.exec(
		task.trim(),
	);
	const requestedClient = match?.[1]?.trim().replace(/\s+/g, " ");
	if (!requestedClient) {
		throw new Error(
			"La tarea no corresponde al conteo de facturas vencidas de un cliente.",
		);
	}

	let screen = await driver.observe();
	if (driver.find(screen, "Entendido")) {
		screen = await driver.click(screen, "Entendido");
	}
	screen = await driver.click(screen, "Cartera");
	screen = await driver.click(screen, "Facturas");
	screen = await driver.replace(screen, "Cliente", requestedClient, 50, 18);
	screen = await driver.choose(screen, "Estado", "Vencida", 60, 18);
	screen = await driver.click(screen, "Filtrar");

	const invoices = new Set<string>();
	const visitedPages = new Set<string>();
	for (let page = 0; page < MAX_PAGES; page++) {
		requireInvoiceTable(screen);
		const rows = readInvoiceRows(screen);
		const pageKey = rows
			.map((row) => row.id)
			.sort()
			.join("\n");
		if (visitedPages.has(pageKey)) {
			driver.step("completed", "count_overdue_invoices");
			return `respuesta: ${invoices.size}`;
		}
		visitedPages.add(pageKey);

		for (const row of rows) {
			if (sameClient(row.client, requestedClient)) {
				invoices.add(row.id);
			}
		}

		if (!driver.find(screen, "Siguiente")) {
			driver.step("completed", "count_overdue_invoices");
			return `respuesta: ${invoices.size}`;
		}
		driver.step("invoice_page", String(page + 1));
		screen = await driver.click(screen, "Siguiente");
	}

	throw new Error(
		`No se pudo completar la paginación de facturas después de ${MAX_PAGES} páginas.`,
	);
};
