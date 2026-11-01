import type {
	PracticeWorkflow,
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../workflow-types.ts";

const ROW_TOLERANCE = 10;
const FIELD_OFFSET_Y = 24;
const MAX_RESULT_PAGES = 50;
const CLIENT_CODE = /^[A-Z]+-\d+$/i;
const NIT = /^\d{6,}$/;

interface ClientRow {
	code: WorkflowWord;
	name: string;
	nit: string;
}

interface ClientTable {
	matches: ClientRow[];
	signature: string;
}

interface MatchScan {
	screen: WorkflowObservation;
	matches: ClientRow[];
}

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase();

const onSameRow = (left: WorkflowWord, right: WorkflowWord) =>
	Math.abs(left.y - right.y) <= ROW_TOLERANCE;

function rowWords(
	observation: WorkflowObservation,
	anchor: WorkflowWord,
): WorkflowWord[] {
	return observation.words
		.filter((word) => onSameRow(anchor, word))
		.sort((left, right) => left.x - right.x);
}

/** Read the client table using measured header positions, never fixed columns. */
function readClientTable(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	requestedName: string,
): ClientTable {
	const codeHeader = driver.requireWord(observation, "Código");
	const headers = rowWords(observation, codeHeader);
	const nameHeader = headers.find(
		(word) =>
			normalize(word.text) === "razon" || normalize(word.text) === "nombre",
	);
	const nitHeader = headers.find((word) => normalize(word.text) === "nit");
	if (!nameHeader || !nitHeader || nameHeader.x >= nitHeader.x) {
		throw new Error(
			"No se pudieron medir las columnas Código, nombre y NIT; no se editará ningún cliente.",
		);
	}
	const nitRightBoundary = headers.find((word) => word.x > nitHeader.x + 4);
	if (!nitRightBoundary) {
		throw new Error(
			"No se pudo delimitar la columna NIT; no se editará ningún cliente.",
		);
	}

	const rows = observation.words
		.filter(
			(word) =>
				CLIENT_CODE.test(word.text.trim()) &&
				word.y > codeHeader.y + ROW_TOLERANCE &&
				word.x < nameHeader.x - 8,
		)
		.sort((left, right) => left.y - right.y || left.x - right.x)
		.map((code) => {
			const row = rowWords(observation, code);
			const name = row
				.filter(
					(word) =>
						word.x >= nameHeader.x - 20 && word.x < nitHeader.x - 12,
				)
				.map((word) => word.text.trim())
				.filter(Boolean)
				.join(" ")
				.replace(/\s+/g, " ");
			const nitWords = row.filter(
				(word) =>
					NIT.test(word.text.trim()) &&
					word.x >= nitHeader.x - 20 &&
					word.x < nitRightBoundary.x - 12,
			);
			return { code, name, nitWords };
		});

	const matches = rows
		.filter((row) => normalize(row.name) === normalize(requestedName))
		.map((row) => {
			if (row.nitWords.length !== 1) {
				throw new Error(
					`No se pudo leer un único NIT visible para ${row.code.text}; no se modificará ningún teléfono.`,
				);
			}
			return { code: row.code, name: row.name, nit: row.nitWords[0]!.text.trim() };
		});

	// Include every visible row so a disabled Next button or repeated page is detected
	// even when none of its rows is an exact name match.
	const signature = rows
		.map(
			(row) =>
				`${row.code.text}|${normalize(row.name)}|${row.nitWords.map((word) => word.text).join(",")}`,
		)
		.join("\n");
	return { matches, signature };
}

async function searchClient(
	screen: WorkflowObservation,
	driver: WorkflowDriver,
	name: string,
): Promise<WorkflowObservation> {
	driver.step("search_client_full_name", name);
	screen = await driver.replace(screen, "Nombre", name, 50, 18);
	return driver.click(screen, "Filtrar");
}

async function scanExactMatches(
	initial: WorkflowObservation,
	driver: WorkflowDriver,
	requestedName: string,
): Promise<MatchScan> {
	let screen = initial;
	const matches = new Map<string, ClientRow>();
	const visitedPages = new Set<string>();

	for (let page = 0; page < MAX_RESULT_PAGES; page++) {
		const table = readClientTable(screen, driver, requestedName);
		if (visitedPages.has(table.signature)) return { screen, matches: [...matches.values()] };
		visitedPages.add(table.signature);
		driver.step("client_result_page", String(page + 1));

		for (const match of table.matches) {
			const key = normalize(match.code.text);
			const previous = matches.get(key);
			if (
				previous &&
				(previous.nit !== match.nit || normalize(previous.name) !== normalize(match.name))
			) {
				throw new Error(
					`El código ${match.code.text} apareció con identidades distintas durante la paginación; no se editará ningún cliente.`,
				);
			}
			matches.set(key, match);
		}

		if (!driver.find(screen, "Siguiente")) {
			return { screen, matches: [...matches.values()] };
		}
		const previousHash = screen.hash;
		const next = await driver.click(screen, "Siguiente");
		if (next.hash === previousHash) return { screen: next, matches: [...matches.values()] };
		screen = next;
	}
	throw new Error(
		`No se pudo revisar toda la paginación de clientes en ${MAX_RESULT_PAGES} páginas; no se editará ningún registro.`,
	);
}

/** Return to the first result page and reacquire a fresh OCR anchor for the row. */
async function locateSelected(
	initial: WorkflowObservation,
	driver: WorkflowDriver,
	selected: ClientRow,
	requestedName: string,
): Promise<{ screen: WorkflowObservation; row: ClientRow }> {
	let screen = initial;
	const visitedPages = new Set<string>();
	for (let page = 0; page < MAX_RESULT_PAGES; page++) {
		const table = readClientTable(screen, driver, requestedName);
		if (visitedPages.has(table.signature)) break;
		visitedPages.add(table.signature);
		const candidates = table.matches.filter(
			(row) =>
				normalize(row.code.text) === normalize(selected.code.text) &&
				row.nit === selected.nit,
		);
		if (candidates.length === 1) return { screen, row: candidates[0]! };
		if (candidates.length > 1) {
			throw new Error(
				`El cliente ${selected.code.text} aparece más de una vez; no se modificará su teléfono.`,
			);
		}
		if (!driver.find(screen, "Siguiente")) break;
		const previousHash = screen.hash;
		const next = await driver.click(screen, "Siguiente");
		if (next.hash === previousHash) break;
		screen = next;
	}
	throw new Error(
		`No se pudo reencontrar ${selected.code.text} con NIT ${selected.nit}; no se continuará con la edición.`,
	);
}

async function openSelected(
	screen: WorkflowObservation,
	driver: WorkflowDriver,
	selected: ClientRow,
	requestedName: string,
): Promise<WorkflowObservation> {
	screen = await searchClient(screen, driver, requestedName);
	const located = await locateSelected(screen, driver, selected, requestedName);
	driver.step("open_client", located.row.code.text);
	return driver.clickPoint(
		located.screen,
		located.row.code.x,
		located.row.code.y,
		`cliente ${located.row.code.text}`,
	);
}

function readFieldValue(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	label: string,
	rightLabel?: string,
): string {
	const anchor = driver.requireWord(observation, label);
	const right = rightLabel
		? driver.requireWord(observation, rightLabel)
		: undefined;
	return observation.words
		.filter(
			(word) =>
				Math.abs(word.y - (anchor.y + FIELD_OFFSET_Y)) <= ROW_TOLERANCE &&
				word.x >= anchor.x - 32 &&
				(!right || word.x < right.x - 32),
		)
		.sort((left, rightWord) => left.x - rightWord.x)
		.map((word) => word.text.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ");
}

function verifyDetailIdentity(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	selected: ClientRow,
	requestedName: string,
	requireSaveControl: boolean,
): void {
	const codeVisible = observation.words.some(
		(word) => normalize(word.text) === normalize(selected.code.text),
	);
	const visibleName = readFieldValue(observation, driver, "Razón");
	const visibleNit = readFieldValue(observation, driver, "NIT", "Teléfono");
	if (
		!codeVisible ||
		normalize(visibleName) !== normalize(requestedName) ||
		visibleNit !== selected.nit
	) {
		throw new Error(
			"El detalle abierto no coincide con el código, nombre y NIT seleccionados; no se modificará el teléfono.",
		);
	}
	if (requireSaveControl) driver.requireWord(observation, "Aplicar");
}

function requireVisiblePhone(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	expectedPhone: string,
): void {
	// The phone value shares its input row with NIT, not with Dirección.
	// The phone label's measured left edge excludes the NIT value.
	const visiblePhone = readFieldValue(observation, driver, "Teléfono");
	if (visiblePhone !== expectedPhone) {
		throw new Error(
			"El teléfono visible no coincide con el solicitado; no se confirmará la actualización.",
		);
	}
}

export const runE5Workflow: PracticeWorkflow = async (task, driver) => {
	const match = /^Cambia el teléfono de ([^,\r\n]+?) a (\d+)\.?$/i.exec(task.trim());
	const requestedName = match?.[1]?.trim().replace(/\s+/g, " ");
	const requestedPhone = match?.[2];
	if (!requestedName || !requestedPhone) {
		throw new Error(
			"La tarea no corresponde a un cambio de teléfono con nombre completo y número nuevo.",
		);
	}

	let screen = await driver.observe();
	if (driver.find(screen, "Entendido")) {
		screen = await driver.click(screen, "Entendido");
	}
	driver.step("navigate", "clients");
	screen = await driver.click(screen, "Comercial");
	screen = await driver.click(screen, "Maestros");
	screen = await driver.click(screen, "Clientes");
	screen = await searchClient(screen, driver, requestedName);

	const scan = await scanExactMatches(screen, driver, requestedName);
	screen = scan.screen;
	if (scan.matches.length !== 1) {
		if (scan.matches.length > 1) {
			const identifiers = scan.matches.map((client) => client.nit);
			driver.step("failed", "ambiguous_client_name");
			throw new Error(
				`Hay ${scan.matches.length} clientes llamados ${requestedName}; NIT ${identifiers.join(" y ")}. No se modificó ningún teléfono: se necesita un identificador único.`,
			);
		}
		throw new Error(
			`No se encontró una coincidencia exacta para ${requestedName} en todas las páginas revisadas; no se modificó ningún teléfono.`,
		);
	}

	const selected = scan.matches[0]!;
	screen = await openSelected(screen, driver, selected, requestedName);
	verifyDetailIdentity(screen, driver, selected, requestedName, true);

	driver.step("replace_phone", selected.code.text);
	screen = await driver.replace(screen, "Teléfono", requestedPhone, 100, 24);
	verifyDetailIdentity(screen, driver, selected, requestedName, true);
	requireVisiblePhone(screen, driver, requestedPhone);

	// Submit once. A click is not success: persistence is checked in a fresh editor.
	screen = await driver.apply(screen);
	if (driver.find(screen, "Cerrar")) screen = await driver.click(screen, "Cerrar");
	driver.requireWord(screen, "Filtrar");

	screen = await openSelected(screen, driver, selected, requestedName);
	verifyDetailIdentity(screen, driver, selected, requestedName, false);
	requireVisiblePhone(screen, driver, requestedPhone);

	driver.step("completed", "update_phone_verified");
	return `Teléfono de ${requestedName} (${selected.code.text}, NIT ${selected.nit}) actualizado a ${requestedPhone} y verificado al reabrir el cliente.`;
};
