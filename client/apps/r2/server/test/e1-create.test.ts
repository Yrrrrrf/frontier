import assert from "node:assert/strict";
import { test } from "node:test";
import { runE1Workflow } from "../src/workflows/e1-create-client.ts";
import type {
	WorkflowDriver,
	WorkflowObservation,
	WorkflowWord,
} from "../src/workflow-types.ts";

const TASK =
	"Registra al cliente Papelería Los Andes, NIT 901234567, teléfono 3157654321, ciudad Pereira.";

type Mode = "home" | "commercial" | "masters" | "clients" | "form";
type ApplyBehavior = "save" | "unchanged" | "close-without-save" | "duplicate";

interface Client {
	code: string;
	name: string;
	nit: string;
	phone: string;
	city: string;
}

interface Form {
	name: string;
	nit: string;
	phone: string;
	city: string;
}

const emptyForm = (): Form => ({ name: "", nit: "", phone: "", city: "" });
const taskClient = (): Client => ({
	code: "CL-9001",
	name: "Papelería Los Andes",
	nit: "901234567",
	phone: "3157654321",
	city: "Pereira",
});

class FakeDriver implements WorkflowDriver {
	mode: Mode = "home";
	clients: Client[] = [];
	form = emptyForm();
	filterNit = "";
	applyBehavior: ApplyBehavior = "save";
	dropUnicode = false;
	applyCalls = 0;
	createClicks = 0;
	replacements: Array<{ label: string; text: string }> = [];
	steps: Array<{ name: string; target?: string }> = [];
	private version = 0;

	async observe(): Promise<WorkflowObservation> {
		return this.observation();
	}

	find(observation: WorkflowObservation, text: string): WorkflowWord | undefined {
		const normalize = (value: string) =>
			value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
		return observation.words.find((word) => normalize(word.text) === normalize(text));
	}

	requireWord(observation: WorkflowObservation, text: string): WorkflowWord {
		const word = this.find(observation, text);
		if (!word) throw new Error(`Missing fake OCR word: ${text}`);
		return word;
	}

	async click(observation: WorkflowObservation, text: string): Promise<WorkflowObservation> {
		this.requireWord(observation, text);
		switch (text) {
			case "Entendido":
				this.mode = "home";
				break;
			case "Comercial":
				this.mode = "commercial";
				break;
			case "Maestros":
				this.mode = "masters";
				break;
			case "Clientes":
				this.mode = "clients";
				break;
			case "Crear":
				this.createClicks++;
				this.mode = "form";
				this.form = emptyForm();
				break;
			case "Filtrar":
				break;
			case "Cerrar":
				this.mode = "clients";
				break;
			default:
				throw new Error(`Unexpected fake click: ${text}`);
		}
		this.version++;
		return this.observation();
	}

	async clickPoint(): Promise<WorkflowObservation> {
		throw new Error("The workflow must use OCR-labelled controls");
	}

	async replace(
		observation: WorkflowObservation,
		label: string,
		text: string,
		dx = 80,
		dy = 24,
	): Promise<WorkflowObservation> {
		const anchor = this.requireWord(observation, label);
		assert.equal(Number.isFinite(anchor.x + dx), true);
		assert.equal(Number.isFinite(anchor.y + dy), true);
		this.replacements.push({ label, text });
		const value = this.dropUnicode
			? text.normalize("NFD").replace(/\p{Diacritic}/gu, "")
			: text;
		if (this.mode === "form") {
			if (label === "Razón") this.form.name = value;
			else if (label === "NIT") this.form.nit = value;
			else if (label === "Teléfono") this.form.phone = value;
			else throw new Error(`Unexpected form replacement: ${label}`);
		} else if (this.mode === "clients" && label === "NIT") {
			this.filterNit = value;
		} else {
			throw new Error(`Unexpected replacement context: ${this.mode}/${label}`);
		}
		this.version++;
		return this.observation();
	}

	async replaceAt(): Promise<WorkflowObservation> {
		throw new Error("The workflow must not use coordinate-only field fallbacks");
	}

	async choose(
		observation: WorkflowObservation,
		label: string,
		text: string,
	): Promise<WorkflowObservation> {
		this.requireWord(observation, label);
		assert.equal(this.mode, "form");
		assert.equal(label, "Ciudad");
		this.form.city = text;
		this.version++;
		return this.observation();
	}

	async apply(observation: WorkflowObservation): Promise<WorkflowObservation> {
		this.applyCalls++;
		this.requireWord(observation, "Aplicar");
		if (this.applyBehavior === "save" || this.applyBehavior === "duplicate") {
			this.clients.push({ code: "CL-9001", ...this.form });
			if (this.applyBehavior === "duplicate")
				this.clients.push({ code: "CL-9002", ...this.form });
			this.mode = "clients";
		} else if (this.applyBehavior === "close-without-save") {
			this.mode = "clients";
		}
		this.version++;
		return this.observation();
	}

	step(name: string, target?: string): void {
		this.steps.push({ name, ...(target ? { target } : {}) });
	}

	private observation(): WorkflowObservation {
		const words: WorkflowWord[] = [];
		const add = (text: string, x: number, y: number) => words.push({ text, x, y });
		const addPhrase = (phrase: string, x: number, y: number) => {
			phrase.split(/\s+/).forEach((part, index) => add(part, x + index * 90, y));
		};
		add("Comercial", 120, 48);
		if (this.mode === "commercial") add("Maestros", 120, 76);
		if (this.mode === "masters") add("Clientes", 330, 76);
		if (this.mode === "clients") {
			add("Nombre", 52, 113);
			add("NIT", 188, 113);
			add("Ciudad", 360, 113);
			if (this.filterNit) add(this.filterNit, 240, 131);
			add("Filtrar", 540, 131);
			add("Crear", 1200, 185);
			add("Código", 48, 214);
			add("Razón", 230, 214);
			add("NIT", 548, 214);
			add("Ciudad", 740, 214);
			add("Teléfono", 960, 214);
			const visible = this.clients.filter((client) => client.nit.includes(this.filterNit));
			visible.forEach((client, index) => {
				const y = 237 + index * 23;
				add(client.code, 48, y);
				addPhrase(client.name, 190, y);
				add(client.nit, 548, y);
				addPhrase(client.city, 740, y);
				add(client.phone, 960, y);
				add("Activo", 1150, y);
			});
		}
		if (this.mode === "form") {
			add("Razón", 80, 117);
			add("NIT", 34, 161);
			add("Teléfono", 498, 161);
			add("Ciudad", 43, 205);
			add("Dirección", 510, 205);
			if (this.form.name) addPhrase(this.form.name, 65, 136);
			if (this.form.nit) add(this.form.nit, 90, 181);
			if (this.form.phone) add(this.form.phone, 540, 181);
			if (this.form.city) add(this.form.city, 65, 225);
			add("Cerrar", 790, 377);
			add("Aplicar", 866, 377);
		}
		this.version++;
		return {
			png: Uint8Array.of(this.version),
			width: 1280,
			height: 800,
			words,
			hash: `${this.mode}-${this.version}`,
		};
	}
}

test("E1 creates once and confirms the exact unique client through OCR", async () => {
	const driver = new FakeDriver();
	const result = await runE1Workflow(TASK, driver);
	assert.match(result, /Papelería Los Andes registrado y verificado/);
	assert.equal(driver.applyCalls, 1);
	assert.equal(driver.createClicks, 1);
	assert.equal(driver.clients.length, 1);
	assert.deepEqual(driver.clients[0], taskClient());
	assert.ok(
		driver.replacements.some(
			(replacement) =>
				replacement.label === "Razón" && replacement.text === "Papelería Los Andes",
		),
	);
	assert.ok(driver.steps.some((step) => step.target === "create_client_verified"));
});

test("E1 rejects unrelated tasks before using the desktop", async () => {
	const driver = new FakeDriver();
	await assert.rejects(
		runE1Workflow("Exporta el reporte de clientes.", driver),
		/no corresponde al registro/,
	);
	assert.equal(driver.applyCalls, 0);
	assert.equal(driver.replacements.length, 0);
});

test("E1 detects dropped Unicode before submit", async () => {
	const driver = new FakeDriver();
	driver.dropUnicode = true;
	await assert.rejects(runE1Workflow(TASK, driver), /Razón no muestra el valor/);
	assert.equal(driver.applyCalls, 0);
	assert.equal(driver.clients.length, 0);
});

test("E1 never repeats Apply when the form remains visible", async () => {
	const driver = new FakeDriver();
	driver.applyBehavior = "unchanged";
	await assert.rejects(runE1Workflow(TASK, driver), /guardado no está confirmado/);
	assert.equal(driver.applyCalls, 1);
});

test("E1 does not claim success when Apply closes without a saved row", async () => {
	const driver = new FakeDriver();
	driver.applyBehavior = "close-without-save";
	await assert.rejects(runE1Workflow(TASK, driver), /guardado no está confirmado/);
	assert.equal(driver.applyCalls, 1);
});

test("E1 rejects duplicate post-save rows instead of reporting success", async () => {
	const driver = new FakeDriver();
	driver.applyBehavior = "duplicate";
	await assert.rejects(runE1Workflow(TASK, driver), /varios clientes/);
	assert.equal(driver.applyCalls, 1);
});

test("E1 preflight accepts an already present exact client without resubmitting", async () => {
	const driver = new FakeDriver();
	driver.clients = [taskClient()];
	const result = await runE1Workflow(TASK, driver);
	assert.match(result, /confirmado como ya registrado/);
	assert.equal(driver.createClicks, 0);
	assert.equal(driver.applyCalls, 0);
	assert.equal(driver.clients.length, 1);
});

test("E1 refuses to duplicate an existing NIT with conflicting visible data", async () => {
	const driver = new FakeDriver();
	driver.clients = [{ ...taskClient(), phone: "3000000000" }];
	await assert.rejects(runE1Workflow(TASK, driver), /datos visibles no coinciden/);
	assert.equal(driver.createClicks, 0);
	assert.equal(driver.applyCalls, 0);
});
