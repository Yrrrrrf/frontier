import type {
	PracticeWorkflow,
	WorkflowObservation,
	WorkflowWord,
} from "../workflow-types.ts";

const ROW_Y_TOLERANCE = 8;
const MAX_PAGES = 100;
const INVOICE_ID = /^FV-\d+$/i;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
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
	return observation.words
		.filter((word) => INVOICE_ID.test(word.text))
		.map((code) => {
			const words = rowWords(observation, code);
			const dates = words.filter((word) => DATE.test(word.text));
			const issued = dates[0];
			const due = dates[1];
			if (!issued || !due) {
				throw new Error(
					`No se pudieron leer las fechas de la factura visible ${code.text}.`,
				);
			}

			const client = words
				.filter((word) => word.x > code.x && word.x < issued.x)
				.map((word) => word.text)
				.join(" ");
			const state = normalize(words.at(-1)?.text ?? "");
			if (!client || !KNOWN_STATES.has(state)) {
				throw new Error(
					`No se pudo verificar el cliente y estado de la factura visible ${code.text}.`,
				);
			}
			if (state !== "vencida") {
				throw new Error(
					`El filtro Vencida no quedó aplicado: ${code.text} aparece como ${words.at(-1)?.text}.`,
				);
			}
			return { id: code.text.toUpperCase(), client, state };
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
			if (normalize(row.client) === normalize(requestedClient)) {
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
