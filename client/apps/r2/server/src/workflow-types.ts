import type { DesktopFrame } from "./vnc.ts";

export interface WorkflowWord {
	text: string;
	x: number;
	y: number;
}

export interface WorkflowObservation extends DesktopFrame {
	words: WorkflowWord[];
	hash: string;
}

export interface WorkflowDriver {
	observe(): Promise<WorkflowObservation>;
	find(observation: WorkflowObservation, text: string): WorkflowWord | undefined;
	requireWord(observation: WorkflowObservation, text: string): WorkflowWord;
	click(observation: WorkflowObservation, text: string): Promise<WorkflowObservation>;
	clickPoint(
		observation: WorkflowObservation,
		x: number,
		y: number,
		label: string,
	): Promise<WorkflowObservation>;
	replace(
		observation: WorkflowObservation,
		label: string,
		text: string,
		dx?: number,
		dy?: number,
	): Promise<WorkflowObservation>;
	replaceAt(
		observation: WorkflowObservation,
		x: number,
		y: number,
		text: string,
		label: string,
	): Promise<WorkflowObservation>;
	choose(
		observation: WorkflowObservation,
		label: string,
		text: string,
		dx?: number,
		dy?: number,
	): Promise<WorkflowObservation>;
	apply(observation: WorkflowObservation): Promise<WorkflowObservation>;
	step(name: string, target?: string): void;
}

export type PracticeWorkflow = (
	task: string,
	driver: WorkflowDriver,
) => Promise<string>;
