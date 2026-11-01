import assert from "node:assert/strict";
import { test } from "node:test";
import { runE5Workflow } from "../src/workflows/e5-ambiguous-client.ts";
import type {
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../src/workflow-types.ts";

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.toLowerCase();

let observationSequence = 0;
const word = (text: string, x: number, y: number): WorkflowWord => ({
	text,
	x,
	y,
});

function observation(words: WorkflowWord[]): WorkflowObservation {
	observationSequence++;
	return {
		png: Uint8Array.of(observationSequence),
		width: 1280,
		height: 800,
		words,
		hash: `e5-observation-${observationSequence}`,
	};
}

function phrase(text: string, x: number, y: number): WorkflowWord[] {
	return text.split(/\s+/).filter(Boolean).map((part, index) =>
		word(part, x + index * 82, y),
	);
}

class FakeDriver implements WorkflowDriver {
	readonly actions: string[] = [];
	observeCalls = 0;

	constructor(
		private readonly initial: WorkflowObservation,
		private readonly results: WorkflowObservation[],
	) {}

	private next(action: string): WorkflowObservation {
		this.actions.push(action);
		const result = this.results.shift();
		if (!result) throw new Error(`No fake observation remains after ${action}`);
		return result;
	}

	async observe(): Promise<WorkflowObservation> {
		this.observeCalls++;
		return this.initial;
	}

	find(observation: WorkflowObservation, text: string): WorkflowWord | undefined {
		return observation.words.find(
			(candidate) => normalize(candidate.text) === normalize(text),
		);
	}

	requireWord(observation: WorkflowObservation, text: string): WorkflowWord {
		const found = this.find(observation, text);
		if (!found) throw new Error(`Missing fake word: ${text}`);
		return found;
	}

	async click(
		observation: WorkflowObservation,
		text: string,
	): Promise<WorkflowObservation> {
		this.requireWord(observation, text);
		return this.next(`click:${text}`);
	}

	async clickPoint(
		_observation: WorkflowObservation,
		x: number,
		y: number,
		label: string,
	): Promise<WorkflowObservation> {
		return this.next(`point:${label}@${x},${y}`);
	}

	async replace(
		observation: WorkflowObservation,
		label: string,
		text: string,
	): Promise<WorkflowObservation> {
		this.requireWord(observation, label);
		return this.next(`replace:${label}=${text}`);
	}

	async replaceAt(): Promise<WorkflowObservation> {
		throw new Error("replaceAt should not be used by E5");
	}

	async choose(): Promise<WorkflowObservation> {
		throw new Error("choose should not be used by E5");
	}

	async apply(observation: WorkflowObservation): Promise<WorkflowObservation> {
		this.requireWord(observation, "Aplicar");
		return this.next("apply");
	}

	step(): void {}
}

const home = () => observation([word("Comercial", 120, 45)]);
const masters = () => observation([word("Maestros", 270, 48)]);
const clientsMenu = () => observation([word("Clientes", 300, 75)]);

interface RowSpec {
	code: string;
	name: string;
	nit: string;
}

function clientPage(rows: RowSpec[], hasNext = false): WorkflowObservation {
	const words = [
		word("Clientes", 40, 75),
		word("Nombre", 40, 110),
		word("Filtrar", 540, 130),
		word("Código", 40, 210),
		word("Razón", 180, 210),
		word("social", 230, 210),
		word("o", 300, 210),
		word("nombre", 325, 210),
		word("NIT", 600, 210),
		word("Ciudad", 790, 210),
		word("Teléfono", 950, 210),
	];
	rows.forEach((row, index) => {
		const y = 245 + index * 28;
		words.push(
			word(row.code, 45, y),
			...phrase(row.name, 185, y),
			...(row.nit ? [word(row.nit, 610, y)] : []),
			word("Bogotá", 795, y),
			word("3000000000", 955, y),
		);
	});
	if (hasNext) words.push(word("Siguiente", 550, 700));
	return observation(words);
}

function clientDetail(row: RowSpec, phone: string): WorkflowObservation {
	return observation([
		word("Cliente", 40, 75),
		word(row.code, 120, 75),
		word("Código:", 45, 110),
		word(row.code, 125, 110),
		word("Razón", 45, 140),
		word("social", 95, 140),
		word("o", 160, 140),
		word("nombre", 180, 140),
		...phrase(row.name, 45, 164),
		word("NIT", 45, 200),
		word(row.nit, 45, 224),
		word("Teléfono", 480, 200),
		word(phone, 480, 224),
		word("Dirección", 480, 260),
		word("Calle", 480, 284),
		word("1", 540, 284),
		word("Cerrar", 790, 410),
		word("Aplicar", 865, 410),
	]);
}

const requestedName = "Persona Homónima de Prueba";
const requestedPhone = "3112223344";
const oldPhone = "3009998877";
const task = `Cambia el teléfono de ${requestedName} a ${requestedPhone}.`;
const first = { code: "ZX-8101", name: requestedName, nit: "700000001" };
const second = { code: "ZX-8102", name: requestedName, nit: "700000002" };

function navigationAndSearch(results: WorkflowObservation[]): WorkflowObservation[] {
	return [masters(), clientsMenu(), clientPage([]), clientPage([]), ...results];
}

function uniqueDriver(finalPhone = requestedPhone): FakeDriver {
	const page = () => clientPage([first]);
	return new FakeDriver(home(), [
		...navigationAndSearch([page()]),
		page(), // full-name replacement before opening
		page(), // filtered first page
		clientDetail(first, oldPhone),
		clientDetail(first, requestedPhone),
		clientDetail(first, requestedPhone), // Apply alone is not treated as proof
		page(), // Close
		page(), // full-name replacement before postcondition check
		page(), // filtered first page
		clientDetail(first, finalPhone),
	]);
}

test("E5 reports every on-screen NIT across pages without opening or editing either client", async () => {
	const longerName = {
		code: "ZX-8103",
		name: `${requestedName} Sucursal`,
		nit: "700000003",
	};
	const driver = new FakeDriver(
		home(),
		navigationAndSearch([
			clientPage([first, longerName], true),
			clientPage([second]),
		]),
	);

	await assert.rejects(runE5Workflow(task, driver), (error: Error) => {
		assert.match(error.message, /2 clientes/);
		assert.match(error.message, new RegExp(first.nit));
		assert.match(error.message, new RegExp(second.nit));
		assert.doesNotMatch(error.message, new RegExp(longerName.nit));
		assert.match(error.message, /No se modificó ningún teléfono/);
		return true;
	});
	assert.equal(driver.actions.some((action) => action === "apply"), false);
	assert.equal(driver.actions.some((action) => action.startsWith("point:")), false);
	assert.equal(
		driver.actions.some((action) => action.startsWith("replace:Teléfono")),
		false,
	);
	assert.deepEqual(
		driver.actions.filter((action) => action.startsWith("replace:")),
		[`replace:Nombre=${requestedName}`],
	);
});

test("E5 updates only the phone for a unique exact match and verifies persistence after reopening", async () => {
	const driver = uniqueDriver();
	const summary = await runE5Workflow(task, driver);

	assert.match(summary, /verificado al reabrir/);
	assert.match(summary, new RegExp(first.code));
	assert.equal(driver.actions.filter((action) => action === "apply").length, 1);
	assert.deepEqual(
		driver.actions.filter((action) => action.startsWith("replace:Teléfono")),
		[`replace:Teléfono=${requestedPhone}`],
	);
	assert.equal(
		driver.actions.some((action) => /Dirección|Observaciones|NIT=/.test(action)),
		false,
	);
	assert.equal(driver.actions.filter((action) => action.startsWith("point:")).length, 2);
});

test("E5 fails honestly when Apply does not persist the requested phone", async () => {
	const driver = uniqueDriver(oldPhone);
	await assert.rejects(
		runE5Workflow(task, driver),
		/teléfono visible no coincide|no se confirmará la actualización/,
	);
	assert.equal(driver.actions.filter((action) => action === "apply").length, 1);
});

test("E5 refuses an exact match whose NIT cannot be read unambiguously", async () => {
	const driver = new FakeDriver(
		home(),
		navigationAndSearch([clientPage([{ ...first, nit: "" }])]),
	);
	await assert.rejects(runE5Workflow(task, driver), /único NIT visible/);
	assert.equal(driver.actions.some((action) => action === "apply"), false);
	assert.equal(driver.actions.some((action) => action.startsWith("point:")), false);
});

test("E5 rejects unrelated tasks before observing or operating the desktop", async () => {
	const driver = new FakeDriver(home(), []);
	await assert.rejects(
		runE5Workflow("Corrige la dirección de un cliente: ahora es Calle 1.", driver),
		/no corresponde a un cambio de teléfono/,
	);
	assert.equal(driver.observeCalls, 0);
	assert.deepEqual(driver.actions, []);
});
