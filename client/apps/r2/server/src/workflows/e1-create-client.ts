import type {
	PracticeWorkflow,
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../workflow-types.ts";

interface ClientRequest {
	name: string;
	nit: string;
	phone: string;
	city: string;
}

interface ClientSearch {
	count: number;
	exactMatch: boolean;
}

const FORM_FIELD = { dx: 100, dy: 24 } as const;
const FILTER_FIELD = { dx: 70, dy: 18 } as const;
const ROW_TOLERANCE = 10;
const MAX_RESULT_PAGES = 50;

function parseClientRequest(task: string): ClientRequest {
	const match = /^Registra al cliente ([^,\r\n]+?), NIT (\d+), teléfono (\d+), ciudad ([^,\r\n]+?)\.?$/i.exec(
		task.trim(),
	);
	if (!match) {
		throw new Error(
			"La tarea no corresponde al registro de un cliente con nombre, NIT, teléfono y ciudad.",
		);
	}
	const [, rawName, nit, phone, rawCity] = match;
	const name = rawName!.trim();
	const city = rawCity!.trim().replace(/\.$/, "").trim();
	if (!name || !city) throw new Error("El nombre y la ciudad son obligatorios.");
	return { name, nit: nit!, phone: phone!, city };
}

function normalizedLine(words: WorkflowWord[]): string {
	return words
		.sort((left, right) => left.x - right.x)
		.map((word) => word.text.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ");
}

/** Verify the value in the field, rather than assuming that keyboard input worked. */
function requireFieldValue(
	driver: WorkflowDriver,
	observation: WorkflowObservation,
	label: string,
	expected: string,
	offset: { dx: number; dy: number },
	rightLabel?: string,
): void {
	const anchor = driver.requireWord(observation, label);
	const right = rightLabel
		? driver.requireWord(observation, rightLabel)
		: undefined;
	const targetY = anchor.y + offset.dy;
	const words = observation.words.filter(
		(word) =>
			Math.abs(word.y - targetY) <= ROW_TOLERANCE &&
			word.x >= anchor.x - 48 &&
			(!right || right.x <= anchor.x || word.x < right.x - 48),
	);
	const actual = normalizedLine(words);
	if (actual !== expected) {
		throw new Error(
			`El campo ${label} no muestra el valor solicitado; no se enviará el formulario. Valor visible: ${actual || "(vacío)"}.`,
		);
	}
}

async function filterByNit(
	driver: WorkflowDriver,
	observation: WorkflowObservation,
	nit: string,
): Promise<WorkflowObservation> {
	let screen = await driver.replace(
		observation,
		"NIT",
		nit,
		FILTER_FIELD.dx,
		FILTER_FIELD.dy,
	);
	requireFieldValue(driver, screen, "NIT", nit, FILTER_FIELD, "Ciudad");
	screen = await driver.click(screen, "Filtrar");
	driver.requireWord(screen, "Código");
	return screen;
}

function rowHasExactClient(
	observation: WorkflowObservation,
	nitWord: WorkflowWord,
	client: ClientRequest,
): boolean {
	const row = observation.words
		.filter((word) => Math.abs(word.y - nitWord.y) <= ROW_TOLERANCE)
		.sort((left, right) => left.x - right.x);
	const nitIndex = row.indexOf(nitWord);
	// The first cell is the client code. All remaining comparisons come from OCR.
	if (nitIndex < 2) return false;
	const name = normalizedLine(row.slice(1, nitIndex));
	if (name !== client.name) return false;
	const phoneIndex = row.findIndex(
		(word, index) => index > nitIndex && word.text.trim() === client.phone,
	);
	if (phoneIndex < 0) return false;
	const city = normalizedLine(row.slice(nitIndex + 1, phoneIndex));
	return city === client.city;
}

async function searchClients(
	driver: WorkflowDriver,
	observation: WorkflowObservation,
	client: ClientRequest,
): Promise<ClientSearch> {
	let screen = observation;
	let count = 0;
	let exactMatch = false;
	const visited = new Set<string>();

	for (let page = 0; page < MAX_RESULT_PAGES; page++) {
		if (visited.has(screen.hash)) {
			throw new Error("La paginación de clientes repitió una pantalla; no se puede confirmar unicidad.");
		}
		visited.add(screen.hash);
		const header = driver.requireWord(screen, "Código");
		const nitWords = screen.words.filter(
			(word) => word.text.trim() === client.nit && word.y > header.y + ROW_TOLERANCE,
		);
		count += nitWords.length;
		for (const nitWord of nitWords) {
			if (rowHasExactClient(screen, nitWord, client)) exactMatch = true;
		}

		if (!driver.find(screen, "Siguiente")) return { count, exactMatch };
		const next = await driver.click(screen, "Siguiente");
		if (next.hash === screen.hash) return { count, exactMatch };
		screen = next;
	}
	throw new Error("Hay demasiadas páginas de resultados para confirmar un cliente único.");
}

function summary(client: ClientRequest, alreadyPresent = false): string {
	return `Cliente ${client.name} ${alreadyPresent ? "confirmado como ya registrado" : "registrado y verificado"} con NIT ${client.nit}, teléfono ${client.phone} y ciudad ${client.city}.`;
}

/**
 * Deterministic E1 workflow. Every coordinate is derived by WorkflowDriver from
 * an OCR anchor; no application DOM, API, or fixture value is consulted.
 */
export const runE1Workflow: PracticeWorkflow = async (task, driver) => {
	const client = parseClientRequest(task);
	let screen = await driver.observe();
	if (driver.find(screen, "Entendido")) screen = await driver.click(screen, "Entendido");

	screen = await driver.click(screen, "Comercial");
	screen = await driver.click(screen, "Maestros");
	screen = await driver.click(screen, "Clientes");

	// A NIT preflight makes retries idempotent and avoids creating a duplicate.
	screen = await filterByNit(driver, screen, client.nit);
	const existing = await searchClients(driver, screen, client);
	if (existing.count > 0) {
		if (existing.count === 1 && existing.exactMatch) return summary(client, true);
		throw new Error(
			existing.count === 1
				? `Ya existe un cliente con NIT ${client.nit}, pero sus datos visibles no coinciden; no se creó otro.`
				: `El NIT ${client.nit} aparece en más de un cliente; no se creó otro registro.`,
		);
	}

	screen = await driver.click(screen, "Crear");
	for (const label of ["Razón", "NIT", "Teléfono", "Ciudad"])
		driver.requireWord(screen, label);

	screen = await driver.replace(
		screen,
		"Razón",
		client.name,
		150,
		FORM_FIELD.dy,
	);
	requireFieldValue(driver, screen, "Razón", client.name, {
		dx: 150,
		dy: FORM_FIELD.dy,
	});
	screen = await driver.replace(
		screen,
		"NIT",
		client.nit,
		FORM_FIELD.dx,
		FORM_FIELD.dy,
	);
	requireFieldValue(driver, screen, "NIT", client.nit, FORM_FIELD, "Teléfono");
	screen = await driver.replace(
		screen,
		"Teléfono",
		client.phone,
		FORM_FIELD.dx,
		FORM_FIELD.dy,
	);
	requireFieldValue(driver, screen, "Teléfono", client.phone, FORM_FIELD);
	screen = await driver.choose(
		screen,
		"Ciudad",
		client.city,
		FORM_FIELD.dx,
		FORM_FIELD.dy,
	);
	requireFieldValue(driver, screen, "Ciudad", client.city, FORM_FIELD, "Dirección");

	// Never retry this operation from the workflow: its effect may be uncertain.
	screen = await driver.apply(screen);
	if (driver.find(screen, "Aplicar") || driver.find(screen, "Cerrar")) {
		throw new Error(
			"Aplicar no produjo evidencia visible de guardado; no se repetirá el envío.",
		);
	}
	driver.requireWord(screen, "Código");

	screen = await filterByNit(driver, screen, client.nit);
	const saved = await searchClients(driver, screen, client);
	if (saved.count !== 1 || !saved.exactMatch) {
		throw new Error(
			saved.count === 0
				? `No se encontró el cliente con NIT ${client.nit} después de Aplicar; el guardado no está confirmado.`
				: saved.count > 1
					? `Después de Aplicar hay varios clientes con NIT ${client.nit}; no se confirmará un guardado duplicado.`
					: `El cliente con NIT ${client.nit} no muestra exactamente el nombre, teléfono y ciudad solicitados.`,
		);
	}

	driver.step("completed", "create_client_verified");
	return summary(client);
};
