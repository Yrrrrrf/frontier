import assert from "node:assert/strict";
import { test } from "node:test";
import { runE3Workflow } from "../src/workflows/e3-count-invoices.ts";
import type {
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../src/workflow-types.ts";

const normalize = (value: string) =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();

let observationSequence = 0;
function observation(words: WorkflowWord[]): WorkflowObservation {
	observationSequence += 1;
	return {
		png: Uint8Array.of(observationSequence),
		width: 1280,
		height: 800,
		words,
		hash: `different-image-${observationSequence}`,
	};
}

const word = (text: string, x: number, y: number): WorkflowWord => ({
	text,
	x,
	y,
});

function invoiceRow(
	id: string,
	client: string,
	y: number,
	state = "Vencida",
): WorkflowWord[] {
	return [
		word(id, 40, y),
		...client.split(" ").map((part, index) => word(part, 160 + index * 70, y)),
		word("01/03/2026", 500, y),
		word("01/04/2026", 650, y),
		word("100.000", 800, y),
		word(state, 1000, y),
	];
}

function invoicePage(
	rows: WorkflowWord[][],
	hasNext = true,
): WorkflowObservation {
	return observation([
		word("Cliente", 50, 20),
		word("Estado", 250, 20),
		word("Filtrar", 400, 20),
		word("Código", 40, 100),
		word("Cliente", 160, 100),
		word("Fecha", 500, 100),
		word("Vence", 650, 100),
		word("Valor", 800, 100),
		word("Estado", 1000, 100),
		...rows.flat(),
		...(hasNext ? [word("Siguiente", 500, 700)] : []),
	]);
}

class FakeDriver implements WorkflowDriver {
	readonly replacements: Array<{ label: string; text: string }> = [];
	readonly choices: Array<{ label: string; text: string }> = [];
	readonly clicks: string[] = [];
	readonly steps: string[] = [];
	observations = 0;
	private pageIndex = 0;
	private screen = observation([word("Cartera", 200, 40)]);

	constructor(private readonly pages: WorkflowObservation[]) {}

	async observe(): Promise<WorkflowObservation> {
		this.observations += 1;
		return this.screen;
	}

	find(obs: WorkflowObservation, text: string): WorkflowWord | undefined {
		return obs.words.find((candidate) => normalize(candidate.text) === normalize(text));
	}

	requireWord(obs: WorkflowObservation, text: string): WorkflowWord {
		const found = this.find(obs, text);
		if (!found) throw new Error(`Missing fake word: ${text}`);
		return found;
	}

	async click(obs: WorkflowObservation, text: string): Promise<WorkflowObservation> {
		this.requireWord(obs, text);
		this.clicks.push(text);
		if (text === "Cartera") this.screen = observation([word("Facturas", 220, 80)]);
		else if (text === "Facturas") {
			this.screen = observation([
				word("Cliente", 50, 20),
				word("Estado", 250, 20),
				word("Filtrar", 400, 20),
			]);
		} else if (text === "Filtrar") {
			this.pageIndex = 0;
			this.screen = this.pages[0]!;
		} else if (text === "Siguiente") {
			this.pageIndex = Math.min(this.pageIndex + 1, this.pages.length - 1);
			this.screen = this.pages[this.pageIndex]!;
		}
		return this.screen;
	}

	async replace(
		obs: WorkflowObservation,
		label: string,
		text: string,
	): Promise<WorkflowObservation> {
		this.requireWord(obs, label);
		this.replacements.push({ label, text });
		return obs;
	}

	async choose(
		obs: WorkflowObservation,
		label: string,
		text: string,
	): Promise<WorkflowObservation> {
		this.requireWord(obs, label);
		this.choices.push({ label, text });
		return obs;
	}

	step(name: string): void {
		this.steps.push(name);
	}

	async clickPoint(): Promise<WorkflowObservation> {
		throw new Error("not used by E3");
	}
	async replaceAt(): Promise<WorkflowObservation> {
		throw new Error("not used by E3");
	}
	async apply(): Promise<WorkflowObservation> {
		throw new Error("not used by E3");
	}
}

test("E3 counts distinct exact-client invoices on every page and stops on a repeated invoice set", async () => {
	const first = invoicePage([
		invoiceRow("FV-2001", "Ferretería Ruiz", 160),
		invoiceRow("FV-2002", "Ferretería Ruiz", 200),
		invoiceRow("FV-2003", "Ferretería Ruiz e Hijos", 240),
	]);
	const last = invoicePage([
		invoiceRow("FV-2004", "Ferreteria Ruiz", 160),
		invoiceRow("FV-2002", "Ferretería Ruiz", 200),
	]);
	const driver = new FakeDriver([first, last]);

	assert.equal(
		await runE3Workflow("¿Cuántas facturas vencidas tiene Ferretería Ruiz?", driver),
		"respuesta: 3",
	);
	assert.deepEqual(driver.replacements, [
		{ label: "Cliente", text: "Ferretería Ruiz" },
	]);
	assert.deepEqual(driver.choices, [{ label: "Estado", text: "Vencida" }]);
	assert.deepEqual(driver.clicks, [
		"Cartera",
		"Facturas",
		"Filtrar",
		"Siguiente",
		"Siguiente",
	]);
	assert.equal(driver.steps.at(-1), "completed");
});

test("E3 rejects unrelated tasks before operating the desktop", async () => {
	const driver = new FakeDriver([invoicePage([], false)]);
	await assert.rejects(
		runE3Workflow("¿Cuántas facturas pagadas tiene Ferretería Ruiz?", driver),
		/no corresponde al conteo/,
	);
	assert.equal(driver.observations, 0);
	assert.equal(driver.clicks.length, 0);
});

test("E3 does not report a count when the overdue filter is not visibly applied", async () => {
	const driver = new FakeDriver([
		invoicePage(
			[invoiceRow("FV-3001", "Ferretería Ruiz", 160, "Pendiente")],
			false,
		),
	]);
	await assert.rejects(
		runE3Workflow("¿Cuántas facturas vencidas tiene Ferretería Ruiz?", driver),
		/filtro Vencida no quedó aplicado/,
	);
});

test("E3 returns a live zero count for an observed empty result table", async () => {
	const driver = new FakeDriver([invoicePage([], false)]);
	assert.equal(
		await runE3Workflow("¿Cuántas facturas vencidas tiene Cliente Sin Facturas?", driver),
		"respuesta: 0",
	);
	assert.deepEqual(driver.replacements, [
		{ label: "Cliente", text: "Cliente Sin Facturas" },
	]);
});
