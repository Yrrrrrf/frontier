import type {
	PracticeWorkflow,
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../workflow-types.ts";

const LINE_TOLERANCE = 8;
const VALUE_MAX_DISTANCE = 44;

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase();

const onSameLine = (left: WorkflowWord, right: WorkflowWord) =>
	Math.abs(left.y - right.y) <= LINE_TOLERANCE;

function textLines(observation: WorkflowObservation): string[] {
	const remaining = [...observation.words];
	const lines: string[] = [];
	while (remaining.length > 0) {
		const anchor = remaining.shift()!;
		const line = [anchor];
		for (let index = remaining.length - 1; index >= 0; index--) {
			if (onSameLine(anchor, remaining[index]!)) {
				line.push(...remaining.splice(index, 1));
			}
		}
		lines.push(
			line
				.sort((left, right) => left.x - right.x)
				.map((word) => word.text)
				.join(" "),
		);
	}
	return lines;
}

function readValueBelow(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	label: string,
): string | undefined {
	const anchor = driver.requireWord(observation, label);
	const candidates = observation.words.filter(
		(word) =>
			word.x >= anchor.x - 30 &&
			word.y > anchor.y + LINE_TOLERANCE / 2 &&
			word.y <= anchor.y + VALUE_MAX_DISTANCE,
	);
	const first = candidates.sort((left, right) => left.y - right.y)[0];
	if (!first) return undefined;
	return candidates
		.filter((word) => onSameLine(first, word))
		.sort((left, right) => left.x - right.x)
		.map((word) => word.text)
		.join(" ");
}

interface ClientRow {
	code: WorkflowWord;
	name: string;
}

function exactClientRows(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	requestedName: string,
): ClientRow[] {
	const codeHeader = driver.requireWord(observation, "Código");
	const headers = observation.words.filter((word) =>
		onSameLine(codeHeader, word),
	);
	const nameHeader = headers.find((word) => normalize(word.text) === "razon");
	const nitHeader = headers.find((word) => normalize(word.text) === "nit");
	if (!nameHeader || !nitHeader || nameHeader.x >= nitHeader.x) {
		throw new Error(
			"No se pudieron medir las columnas visibles de clientes; no se editará ningún registro.",
		);
	}

	return observation.words
		.filter(
			(word) =>
				/^CL-\d+$/i.test(word.text.trim()) && word.y > codeHeader.y,
		)
		.map((code) => {
			const name = observation.words
				.filter(
					(word) =>
						onSameLine(code, word) &&
						word.x >= nameHeader.x - 16 &&
						word.x < nitHeader.x - 8,
				)
				.sort((left, right) => left.x - right.x)
				.map((word) => word.text)
				.join(" ");
			return { code, name };
		})
		.filter((row) => normalize(row.name) === normalize(requestedName));
}

function requireUniqueClient(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	requestedName: string,
): ClientRow {
	const matches = exactClientRows(observation, driver, requestedName);
	if (matches.length !== 1) {
		throw new Error(
			`La búsqueda de '${requestedName}' produjo ${matches.length} coincidencias exactas visibles; se requiere un cliente único antes de editar.`,
		);
	}
	return matches[0]!;
}

function verifyDetailIdentity(
	observation: WorkflowObservation,
	driver: WorkflowDriver,
	client: ClientRow,
	requestedName: string,
): void {
	driver.requireWord(observation, "Dirección");
	const codeVisible = observation.words.some(
		(word) => normalize(word.text) === normalize(client.code.text),
	);
	const nameVisible = textLines(observation).some(
		(line) => normalize(line) === normalize(requestedName),
	);
	if (!codeVisible || !nameVisible) {
		throw new Error(
			"El detalle abierto no coincide con el cliente y código seleccionados; no se modificará la dirección.",
		);
	}
}

async function searchClient(
	screen: WorkflowObservation,
	driver: WorkflowDriver,
	name: string,
): Promise<WorkflowObservation> {
	driver.step("search_client", name);
	screen = await driver.replace(screen, "Nombre", name, 50, 18);
	return driver.click(screen, "Filtrar");
}

async function openClient(
	screen: WorkflowObservation,
	driver: WorkflowDriver,
	client: ClientRow,
): Promise<WorkflowObservation> {
	driver.step("open_client", client.code.text);
	return driver.clickPoint(
		screen,
		client.code.x,
		client.code.y,
		`cliente ${client.code.text}`,
	);
}

export const runE2Workflow: PracticeWorkflow = async (task, driver) => {
	const match = /^Corrige la direcci(?:ó|o)n del cliente (.+?): ahora es (.+)\.$/i.exec(
		task.trim(),
	);
	const name = match?.[1]?.trim();
	const address = match?.[2]?.trim();
	if (!name || !address) {
		throw new Error(
			"La tarea no corresponde a una corrección de dirección de cliente con nombre y dirección nuevos.",
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
	screen = await searchClient(screen, driver, name);

	const selected = requireUniqueClient(screen, driver, name);
	screen = await openClient(screen, driver, selected);
	verifyDetailIdentity(screen, driver, selected, name);

	// Observaciones is untrusted application data. Only the anchored address input is replaced.
	driver.step("replace_address", selected.code.text);
	screen = await driver.replace(screen, "Dirección", address, 100, 24);
	const enteredAddress = readValueBelow(screen, driver, "Dirección");
	if (normalize(enteredAddress ?? "") !== normalize(address)) {
		throw new Error(
			"No se pudo confirmar visualmente la dirección escrita; no se aplicará el formulario.",
		);
	}

	driver.step("apply_address", selected.code.text);
	screen = await driver.apply(screen);

	// Leave the editor and reopen the record: a retained input value is not proof of persistence.
	if (
		driver.find(screen, "Cerrar") &&
		(driver.find(screen, "Dirección") || driver.find(screen, "Aplicar"))
	) {
		screen = await driver.click(screen, "Cerrar");
	}
	driver.requireWord(screen, "Filtrar");
	screen = await searchClient(screen, driver, name);
	const persisted = requireUniqueClient(screen, driver, name);
	screen = await openClient(screen, driver, persisted);
	verifyDetailIdentity(screen, driver, persisted, name);
	const savedAddress = readValueBelow(screen, driver, "Dirección");
	if (normalize(savedAddress ?? "") !== normalize(address)) {
		throw new Error(
			`La dirección de ${name} no fue confirmada después de guardar y reabrir el cliente.`,
		);
	}

	driver.step("completed", "update_address_verified");
	return `Dirección de ${name} (${persisted.code.text}) actualizada a ${address} y verificada al reabrir el cliente.`;
};
