import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { chromium } from "playwright-core";
import type { TaskExecution, TaskRunner } from "./service.ts";
import {
	NoVncDesktop,
	DesktopOperationError,
	type DesktopFrame,
	type DesktopOperationOptions,
	type NoVncOptions,
} from "./vnc.ts";
import type { VisionInput, VisionResult } from "./vision.ts";

const CLEANUP_RESERVE_MS = 2_000;
const MAX_CAPTURE_MS = 20_000;
const MAX_INFERENCE_MS = 60_000;
const MAX_LOGIN_MS = 30_000;

interface Observation extends DesktopFrame {
	id: string;
	hash: string;
}

export interface RunnerDesktop {
	capture(
		path?: string,
		options?: DesktopOperationOptions,
	): Promise<DesktopFrame>;
	click(
		frame: DesktopFrame,
		x: number,
		y: number,
		options?: DesktopOperationOptions,
	): Promise<void>;
	close(): Promise<void>;
}

export interface RunnerVision {
	proposeAction(
		input: VisionInput,
		options?: { timeoutMs?: number; signal?: AbortSignal },
	): Promise<VisionResult>;
}

export interface DesktopTaskRunnerOptions {
	vision: RunnerVision;
	login: (options: NoVncOptions) => Promise<RunnerDesktop>;
	executablePath?: string;
	model?: string;
	now?: () => number;
}

function supportedSingleClick(goal: string): boolean {
	const normalized = goal.trim();
	return (
		/^(?:haz|haga)\s+clic\s+(?:en|sobre)\b/i.test(normalized) ||
		/^(?:click|press)\s+(?:on\s+)?/i.test(normalized)
	);
}

function observation(frame: DesktopFrame): Observation {
	return {
		...frame,
		id: randomUUID(),
		hash: createHash("sha256").update(frame.png).digest("hex"),
	};
}

function retryableVision(result: VisionResult): boolean {
	if (result.ok) return false;
	const { error } = result;
	return (
		error.code === "timeout" ||
		error.code === "unavailable" ||
		error.code === "invalid_response" ||
		error.code === "invalid_action" ||
		(error.code === "http_error" &&
			(error.httpStatus === 429 || (error.httpStatus ?? 500) >= 500))
	);
}

export function createDesktopTaskRunner(
	options: DesktopTaskRunnerOptions,
): TaskRunner {
	const now = options.now ?? (() => performance.now());
	return async (execution: TaskExecution): Promise<string> => {
		const trace = execution.trace;
		const runStartedAt = now();
		let iteration = 1;
		let iterationStartedAt = runStartedAt;
		let previousObservation: Observation | undefined;
		if (!supportedSingleClick(execution.request.tarea)) {
			throw new Error(
				"Objetivo no compatible: este ejecutor limitado solo admite una acción de clic visible; no se ejecutaron cambios.",
			);
		}
		const signal = execution.signal;
		const operationOptions = (capMs: number): DesktopOperationOptions => {
			if (signal.aborted)
				throw new Error(
					"La ejecución fue cancelada antes de completar la tarea.",
				);
			const remaining = execution.deadlineMs - now() - CLEANUP_RESERVE_MS;
			if (remaining <= 0)
				throw new Error(
					"La tarea no tiene tiempo suficiente para otra operación.",
				);
			return { signal, timeoutMs: Math.min(capMs, remaining) };
		};
		const ensureActive = () => {
			operationOptions(1);
		};
		const capture = async (desktop: RunnerDesktop): Promise<Observation> => {
			let lastError: unknown;
			for (let attempt = 0; attempt < 2; attempt++) {
				const startedAt = now();
				trace?.record({
					iteration,
					event: "capture.started",
					status: "started",
					details: {
						attempt: attempt + 1,
						remainingMs: Math.max(0, execution.deadlineMs - startedAt),
					},
				});
				try {
					const frame = await desktop.capture(
						undefined,
						operationOptions(MAX_CAPTURE_MS),
					);
					ensureActive();
					const observed = observation(frame);
					const repeated = previousObservation?.hash === observed.hash;
					previousObservation = observed;
					trace?.record({
						iteration,
						event: "capture.ok",
						status: "ok",
						durationMs: now() - startedAt,
						frameId: observed.id,
						details: {
							attempt: attempt + 1,
							width: observed.width,
							height: observed.height,
							imageHash: observed.hash.slice(0, 16),
							repeated,
						},
					});
					return observed;
				} catch (error) {
					lastError = error;
					trace?.record({
						iteration,
						event: "capture.rejected",
						status: "rejected",
						durationMs: now() - startedAt,
						details: {
							attempt: attempt + 1,
							code:
								error instanceof DesktopOperationError
									? "desktop_operation"
									: "capture_error",
							error: error instanceof Error ? error.message : "Capture failed",
						},
					});
				}
			}
			throw new Error("No se pudo obtener una captura fiable del escritorio.", {
				cause: lastError,
			});
		};
		const propose = async (
			frame: Observation,
			goal = execution.request.tarea,
		) => {
			let lastCode = "unknown";
			for (let attempt = 0; attempt < 2; attempt++) {
				const queuedAt = now();
				trace?.record({
					iteration,
					event: "inference.queued",
					status: "started",
					frameId: frame.id,
					details: { attempt: attempt + 1 },
				});
				trace?.record({
					iteration,
					event: "inference.started",
					status: "started",
					frameId: frame.id,
					details: {
						attempt: attempt + 1,
						timeoutRemainingMs: Math.max(0, execution.deadlineMs - queuedAt),
						imageHash: frame.hash.slice(0, 16),
					},
				});
				const result = await options.vision.proposeAction(
					{
						frameId: frame.id,
						goal,
						image: {
							bytes: frame.png,
							width: frame.width,
							height: frame.height,
						},
					},
					operationOptions(MAX_INFERENCE_MS),
				);
				ensureActive();
				if (result.ok) {
					trace?.record({
						iteration,
						event: "inference.response",
						status: "ok",
						durationMs: result.value.elapsedMs,
						frameId: frame.id,
						details: {
							attempt: attempt + 1,
							requestedModel: options.model ?? "configured",
							reportedModel: result.value.model,
							loadMs: result.value.loadMs,
							promptEvalMs: result.value.promptEvalMs,
							generationMs: result.value.generationMs,
							inputTokens: result.value.inputTokens,
							outputTokens: result.value.outputTokens,
							condition: attempt === 0 ? "uncontended_unknown" : "retry",
						},
					});
					trace?.record({
						iteration,
						event: "response.parsed",
						status: "ok",
						frameId: frame.id,
					});
					if (result.value.frameId !== frame.id) {
						trace?.record({
							iteration,
							event: "action.rejected",
							status: "rejected",
							frameId: frame.id,
							details: { code: "frame_mismatch" },
						});
						throw new Error(
							"La propuesta no corresponde a la captura vigente.",
						);
					}
					const actionId = randomUUID();
					const action = result.value.action;
					trace?.record({
						iteration,
						event: "action.proposed",
						status: "ok",
						frameId: frame.id,
						actionId,
						details: {
							kind: action.kind,
							...(action.kind === "click" ? { x: action.x, y: action.y } : {}),
						},
					});
					return { action, actionId };
				}
				lastCode = result.error.code;
				trace?.record({
					iteration,
					event: "inference.failed",
					status: "failed",
					durationMs: result.error.elapsedMs,
					frameId: frame.id,
					details: {
						attempt: attempt + 1,
						code: result.error.code,
						httpStatus: result.error.httpStatus,
						error: result.error.message,
					},
				});
				if (result.error.code === "invalid_response") {
					trace?.record({
						iteration,
						event: "response.parsed",
						status: "failed",
						frameId: frame.id,
						details: {
							code: result.error.code,
							diagnostic: result.error.diagnostic,
						},
					});
				}
				if (result.error.code === "invalid_action") {
					trace?.record({
						iteration,
						event: "action.rejected",
						status: "rejected",
						frameId: frame.id,
						details: {
							code: result.error.code,
							diagnostic: result.error.diagnostic,
						},
					});
				}
				if (!retryableVision(result) || attempt === 1) break;
			}
			throw new Error(`La propuesta visual falló (${lastCode}).`);
		};

		let desktop: RunnerDesktop | undefined;
		try {
			let lastLoginError: unknown;
			for (let attempt = 0; attempt < 2; attempt++) {
				const loginStartedAt = now();
				trace?.record({
					iteration: 0,
					event: "desktop.connect.started",
					status: "started",
					details: {
						attempt: attempt + 1,
						driver: "noVNC/playwright",
						remainingMs: Math.max(0, execution.deadlineMs - loginStartedAt),
					},
				});
				try {
					desktop = await options.login({
						viewerUrl: execution.request.escritorio.url,
						password: execution.request.escritorio.password,
						...(options.executablePath
							? { executablePath: options.executablePath }
							: {}),
						...operationOptions(MAX_LOGIN_MS),
					});
					trace?.record({
						iteration: 0,
						event: "desktop.login.ok",
						status: "ok",
						durationMs: now() - loginStartedAt,
						details: { attempt: attempt + 1, driver: "noVNC/playwright" },
					});
					break;
				} catch (error) {
					lastLoginError = error;
					trace?.record({
						iteration: 0,
						event: "desktop.connect.started",
						status: "failed",
						durationMs: now() - loginStartedAt,
						details: {
							attempt: attempt + 1,
							code:
								error instanceof DesktopOperationError
									? "desktop_operation"
									: "login_failed",
							error:
								error instanceof Error ? error.message : "Desktop login failed",
						},
					});
					if (
						attempt === 1 ||
						!(error instanceof DesktopOperationError) ||
						!error.retryable
					)
						throw error;
				}
			}
			if (!desktop)
				throw new Error("No se pudo abrir el escritorio remoto.", {
					cause: lastLoginError,
				});

			let frame = await capture(desktop);
			trace?.record({
				iteration: 1,
				event: "desktop.session.ready",
				status: "ok",
				durationMs: now() - runStartedAt,
				frameId: frame.id,
				details: { driver: "noVNC/playwright", viewport: "1280x800@1" },
			});
			iterationStartedAt = now();
			let staleRecoveryUsed = false;
			while (true) {
				const { action, actionId } = await propose(frame);
				if (action.kind === "fail") {
					trace?.record({
						iteration,
						event: "closure.proposed",
						status: "rejected",
						frameId: frame.id,
						actionId,
						details: { code: "model_fail", error: action.reason },
					});
					throw new Error(
						`El objetivo visible no es ejecutable: ${action.reason}`,
					);
				}
				if (action.kind === "finish") {
					trace?.record({
						iteration,
						event: "closure.proposed",
						status: "rejected",
						frameId: frame.id,
						actionId,
						details: { code: "unverified_finish", evidence: action.evidence },
					});
					throw new Error(
						"El modelo propuso terminar sin una postcondición visual verificable.",
					);
				}

				// Reobserve immediately before input. A different frame invalidates the proposal.
				const current = await capture(desktop);
				trace?.record({
					iteration,
					event: "guard.started",
					status: "started",
					frameId: frame.id,
					actionId,
					details: { remainingMs: Math.max(0, execution.deadlineMs - now()) },
				});
				try {
					ensureActive();
				} catch (error) {
					trace?.record({
						iteration,
						event: "guard.rejected",
						status: "rejected",
						frameId: frame.id,
						actionId,
						details: { code: "inactive_or_expired" },
					});
					throw error;
				}
				if (current.hash !== frame.hash) {
					trace?.record({
						iteration,
						event: "guard.rejected",
						status: "rejected",
						frameId: frame.id,
						actionId,
						details: {
							code: "stale_frame",
							expectedFrameId: frame.id,
							currentFrameId: current.id,
						},
					});
					if (staleRecoveryUsed)
						throw new Error("La pantalla cambió repetidamente antes del clic.");
					staleRecoveryUsed = true;
					frame = current;
					trace?.record({
						iteration,
						event: "iteration.completed",
						status: "ok",
						durationMs: now() - iterationStartedAt,
					});
					iteration++;
					iterationStartedAt = now();
					continue;
				}
				trace?.record({
					iteration,
					event: "guard.ok",
					status: "ok",
					frameId: frame.id,
					actionId,
					details: {
						remainingMs: Math.max(0, execution.deadlineMs - now()),
						expectedFrameId: frame.id,
						currentFrameId: current.id,
						sourceWidth: frame.width,
						sourceHeight: frame.height,
					},
				});
				trace?.record({
					iteration,
					event: "side_effect.before",
					status: "ok",
					frameId: frame.id,
					actionId,
					details: { kind: "click", x: action.x, y: action.y },
				});

				let clickError: unknown;
				const inputStartedAt = now();
				try {
					await desktop.click(
						frame,
						action.x,
						action.y,
						operationOptions(MAX_CAPTURE_MS),
					);
				} catch (error) {
					clickError = error;
				}
				const mayBeApplied =
					clickError instanceof DesktopOperationError &&
					clickError.inputMayBeApplied;
				trace?.record({
					iteration,
					event: "input.executed",
					status: clickError ? "failed" : "ok",
					durationMs: now() - inputStartedAt,
					frameId: frame.id,
					actionId,
					details: {
						confirmation: clickError
							? mayBeApplied
								? "uncertain"
								: "not_sent"
							: "sent",
						...(clickError instanceof Error
							? { error: clickError.message }
							: {}),
					},
				});
				if (!clickError) {
					trace?.record({
						iteration,
						event: "repaint.waited",
						status: "ok",
						frameId: frame.id,
						actionId,
						details: { waitMs: 1_000, holdMs: 120 },
					});
				}
				if (clickError && !mayBeApplied) throw clickError;

				// One post-click observation (plus capture's single retry); never repeat input.
				let after: Observation | undefined;
				try {
					after = await capture(desktop);
				} catch (error) {
					if (!clickError) throw error;
				}
				if (after && after.hash !== frame.hash) {
					trace?.record({
						iteration,
						event: "effect.observed",
						status: "ok",
						durationMs: now() - inputStartedAt,
						frameId: after.id,
						actionId,
						details: {
							claim: "screen_changed_not_goal_verified",
							previousImageHash: frame.hash.slice(0, 16),
							newImageHash: after.hash.slice(0, 16),
						},
					});
					const verification = await propose(
						after,
						`Verifica visualmente si esta acción quedó completada: ${execution.request.tarea.slice(0, 3_500)}. Usa finish solo si la postcondición es visible; en caso contrario usa fail.`,
					);
					if (verification.action.kind === "finish") {
						trace?.record({
							iteration,
							event: "closure.verified",
							status: "ok",
							frameId: after.id,
							actionId: verification.actionId,
							details: { evidence: verification.action.evidence },
						});
						trace?.record({
							iteration,
							event: "iteration.completed",
							status: "ok",
							durationMs: now() - iterationStartedAt,
						});
						return `Acción de clic y postcondición visual verificadas: ${verification.action.evidence}`;
					}
					trace?.record({
						iteration,
						event: "closure.verified",
						status: "rejected",
						frameId: after.id,
						actionId: verification.actionId,
						details: { code: "postcondition_not_verified" },
					});
				} else {
					trace?.record({
						iteration,
						event: "effect.unknown",
						status: "rejected",
						frameId: after?.id ?? frame.id,
						actionId,
						details: {
							code: after ? "frame_unchanged" : "post_frame_unavailable",
						},
					});
				}
				if (clickError)
					throw new Error(
						"El clic pudo aplicarse, pero su efecto no pudo verificarse; no se repitió la acción.",
						{ cause: clickError },
					);
				throw new Error(
					"El clic fue enviado, pero su postcondición no pudo verificarse; no se repitió la acción.",
				);
			}
		} finally {
			if (desktop) {
				const cleanupStartedAt = now();
				let cleanupError: unknown;
				await desktop.close().catch((error) => {
					cleanupError = error;
				});
				trace?.record({
					iteration,
					event: "desktop.closed",
					status: cleanupError ? "failed" : "ok",
					durationMs: now() - cleanupStartedAt,
					details:
						cleanupError instanceof Error
							? { error: cleanupError.message }
							: {},
				});
				trace?.record({
					iteration,
					event: cleanupError ? "cleanup.failed" : "cleanup.ok",
					status: cleanupError ? "failed" : "ok",
					durationMs: now() - cleanupStartedAt,
				});
			}
		}
	};
}

export interface LocalReadinessOptions {
	baseUrl: string;
	model: string;
	executablePath?: string;
	refreshMs?: number;
}

/** Cached local preflight. Health requests only read the latest boolean. */
export function createLocalReadiness(options: LocalReadinessOptions) {
	let ready = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let checking: Promise<boolean> | undefined;
	const refresh = () => {
		checking ??= (async () => {
			const controller = new AbortController();
			let timeout: ReturnType<typeof setTimeout> | undefined;
			try {
				const base = new URL(options.baseUrl);
				if (!/^https?:$/.test(base.protocol) || !options.model.trim())
					throw new Error("Invalid local model configuration");
				const executable = options.executablePath ?? chromium.executablePath();
				await access(executable, constants.X_OK);
				timeout = setTimeout(() => controller.abort(), 3_000);
				const response = await fetch(
					`${options.baseUrl.replace(/\/+$/, "")}/api/tags`,
					{
						signal: controller.signal,
					},
				);
				if (!response.ok) throw new Error("Local model runtime is unavailable");
				const payload = (await response.json()) as {
					models?: Array<{ name?: unknown; model?: unknown }>;
				};
				const available = payload.models?.some(
					(model) =>
						model.name === options.model || model.model === options.model,
				);
				if (!available)
					throw new Error("Configured local model is not installed");
				ready = true;
			} catch {
				ready = false;
			} finally {
				if (timeout) clearTimeout(timeout);
			}
			return ready;
		})().finally(() => {
			checking = undefined;
		});
		return checking;
	};
	return {
		isReady: () => ready,
		refresh,
		degrade: () => {
			ready = false;
		},
		start: () => {
			timer ??= setInterval(() => void refresh(), options.refreshMs ?? 30_000);
			timer.unref();
		},
		stop: () => {
			if (timer) clearInterval(timer);
			timer = undefined;
		},
	};
}

export const loginNoVnc = (options: NoVncOptions) =>
	NoVncDesktop.login(options);
