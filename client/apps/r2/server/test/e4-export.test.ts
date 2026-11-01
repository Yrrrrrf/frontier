import assert from "node:assert/strict";
import { test } from "node:test";
import { runE4Workflow } from "../src/workflows/e4-export-orders.ts";
import type {
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../src/workflow-types.ts";

const normalize = (value: string) =>
	value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function observation(text: string, hash = text): WorkflowObservation {
	const words: WorkflowWord[] = text.split(/\s+/).filter(Boolean).map((word, index) => ({
		text: word,
		x: 30 + (index % 8) * 120,
		y: 30 + Math.floor(index / 8) * 30,
	}));
	return { png: new Uint8Array(), width: 1280, height: 800, words, hash };
}

class FakeDriver implements WorkflowDriver {
	readonly actions: string[] = [];
	readonly steps: string[] = [];
	observeCalls = 0;
	exportClicks = 0;
	private screen = observation(
		"Entendido Comercial Ventas Pedidos Estado Desde Hasta Filtrar Exportar",
		"initial",
	);
	private selectedStatus = "";
	private from = "";
	private to = "";
	private exported = false;
	private polls = 0;

	constructor(
		private readonly confirmation?: string,
		private readonly confirmationAfterPolls = 0,
		private readonly showEnteredFilters = true,
	) {}

	private current(): WorkflowObservation {
		const filters = this.showEnteredFilters
			? `${this.selectedStatus} ${this.from} ${this.to}`
			: "";
		const confirmation =
			this.exported && this.confirmation && this.polls >= this.confirmationAfterPolls
				? this.confirmation
				: "";
		return observation(
			`Comercial Ventas Pedidos Estado Desde Hasta Filtrar Exportar ${filters} ${confirmation}`,
			`screen-${this.selectedStatus}-${this.from}-${this.to}-${this.exported}-${this.polls}`,
		);
	}

	async observe(): Promise<WorkflowObservation> {
		this.observeCalls++;
		if (this.exported) this.polls++;
		if (this.observeCalls === 1 && !this.exported) return this.screen;
		return this.current();
	}

	find(screen: WorkflowObservation, text: string): WorkflowWord | undefined {
		return screen.words.find((word) => normalize(word.text) === normalize(text));
	}

	requireWord(screen: WorkflowObservation, text: string): WorkflowWord {
		const word = this.find(screen, text);
		if (!word) throw new Error(`Missing OCR word: ${text}`);
		return word;
	}

	async click(screen: WorkflowObservation, text: string): Promise<WorkflowObservation> {
		this.requireWord(screen, text);
		this.actions.push(`click:${text}`);
		if (text === "Exportar") {
			this.exportClicks++;
			this.exported = true;
		}
		return this.current();
	}

	async clickPoint(): Promise<WorkflowObservation> {
		throw new Error("Absolute point input must not be used by this workflow");
	}

	async replace(
		screen: WorkflowObservation,
		label: string,
		text: string,
		dx = 80,
		dy = 24,
	): Promise<WorkflowObservation> {
		this.requireWord(screen, label);
		assert.ok(Number.isFinite(dx) && Number.isFinite(dy));
		this.actions.push(`replace:${label}=${text}`);
		if (label === "Desde") this.from = text;
		if (label === "Hasta") this.to = text;
		return this.current();
	}

	async replaceAt(): Promise<WorkflowObservation> {
		throw new Error("Absolute point input must not be used by this workflow");
	}

	async choose(
		screen: WorkflowObservation,
		label: string,
		text: string,
	): Promise<WorkflowObservation> {
		this.requireWord(screen, label);
		this.actions.push(`choose:${label}=${text}`);
		this.selectedStatus = text;
		return this.current();
	}

	async apply(): Promise<WorkflowObservation> {
		throw new Error("Apply is not part of the export workflow");
	}

	step(name: string, target?: string): void {
		this.steps.push(`${name}${target ? `:${target}` : ""}`);
	}
}

test("E4 derives status and native month boundaries from the user task", async () => {
	const driver = new FakeDriver("Reporte exportado correctamente");
	const summary = await runE4Workflow(
		"Exporta el reporte de pedidos entregados en febrero de 2024.",
		driver,
	);

	assert.deepEqual(driver.actions, [
		"click:Entendido",
		"click:Comercial",
		"click:Ventas",
		"click:Pedidos",
		"choose:Estado=Entregado",
		"replace:Desde=01/02/2024",
		"replace:Hasta=29/02/2024",
		"click:Filtrar",
		"click:Exportar",
	]);
	assert.equal(driver.exportClicks, 1);
	assert.match(summary, /2024-02-01 a 2024-02-29/);
	assert.deepEqual(driver.steps, ["completed:export_orders"]);
});

test("E4 accepts delayed download evidence without clicking Export again", async () => {
	const driver = new FakeDriver("pedidos_2023-02.csv", 2);
	const summary = await runE4Workflow(
		"Exportar el reporte de pedidos pendientes en febrero de 2023",
		driver,
	);

	assert.equal(driver.exportClicks, 1);
	assert.ok(driver.observeCalls >= 3);
	assert.match(summary, /Pedido|Pendiente/);
	assert.match(summary, /2023-02-28/);
});

test("E4 rejects unrelated tasks before any GUI operation", async () => {
	for (const task of [
		"Exporta el reporte de facturas entregadas en septiembre de 2026.",
		"¿Cuántos pedidos entregados hay en septiembre de 2026?",
		"Exporta el reporte de pedidos archivados en septiembre de 2026.",
	]) {
		const driver = new FakeDriver("Reporte exportado correctamente");
		await assert.rejects(() => runE4Workflow(task, driver));
		assert.equal(driver.observeCalls, 0);
		assert.deepEqual(driver.actions, []);
	}
});

test("E4 fails when Export was clicked but no success evidence appeared", async () => {
	const driver = new FakeDriver();
	await assert.rejects(
		() =>
			runE4Workflow(
				"Exporta el reporte de pedidos cancelados en noviembre de 2025.",
				driver,
			),
		/no se observó confirmación ni evidencia de descarga/i,
	);
	assert.equal(driver.exportClicks, 1);
	assert.equal(driver.steps.includes("completed:export_orders"), false);
});

test("E4 does not filter or export when entered dates are not visible", async () => {
	const driver = new FakeDriver("Reporte exportado correctamente", 0, false);
	await assert.rejects(
		() =>
			runE4Workflow(
				"Exporta el reporte de pedidos entregados en setiembre del 2026.",
				driver,
			),
		/No se pudieron confirmar visualmente los filtros/,
	);
	assert.equal(driver.exportClicks, 0);
	assert.equal(driver.actions.includes("click:Filtrar"), false);
});
