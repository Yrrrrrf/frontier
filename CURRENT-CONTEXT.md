# FRONTIER RETO 2 — CURRENT PROTOTYPE CONTEXT

Snapshot: 2026-10-31. This is the current implementation handoff. The official contract remains `reto-2/README.md`; it takes precedence over this file.

## Implemented now

### Shared official contract

- `client/sdk/core/src/schemas/frontier.ts`: ArkType schemas for `{ tarea, escritorio: { url, password } }`, `{ task_id }`, and `{ estado, resumen }`, plus separate read-only observability DTO types.
- `client/sdk/api/src/frontier.ts`: typed `health`, `createTask`, and `getTask` methods using the existing Axios SDK and response validation.
- Public task states remain exactly `en_curso`, `terminada`, and `fallida`; observability does not extend the official task result.

### Node server, lifecycle, and runner

- `client/apps/r2/server/src/http.ts`: native `node:http`, Bearer authentication, official routes, JSON validation, truthful readiness/admission, and an authenticated development-only `GET /tasks/{task_id}/trace` route.
- `client/apps/r2/server/src/main.ts`: composes the Ollama adapter, noVNC runner, cached local preflight, and persistent trace sink. Chromium and the selected local model must pass preflight before new work is admitted.
- `client/apps/r2/server/src/service.ts`: RAM task state, background execution, one absolute monotonic deadline, exact-expiry and post-`await` checks, terminal-before-abort, late-result protection, shutdown cancellation, and password redaction.
- `client/apps/r2/server/src/runner.ts`: a bounded visual runner for click-only objectives, including multi-step recovery. It preserves the original goal and recent step context, can dismiss benign blocking modals, allows up to 8 click attempts and 12 planning iterations, detects repeated goal states, revalidates source-frame/geometry before every click, and requires a separate visual completion check. It does not support text entry or claim general task completion.
- `client/apps/r2/server/src/vision.ts`: Ollama `/api/chat` with `qwen3-vl:2b` by default. Timeout/cancellation covers headers and body streaming, preserves the first abort cause, bounds response bytes, separates envelope/action failures, and validates dynamic action schemas and coordinates.
- `client/apps/r2/server/src/vnc.ts`: Playwright controls only the noVNC viewer and remote canvas, never the target application's DOM. Login/capture/input accept deadline/cancellation options; clicks use the exact source frame and geometry, hold for 120 ms, and wait one second. Cleanup is bounded and idempotent.

### Observability and r2 dashboard

- `client/apps/r2/server/src/trace.ts`: bounded per-task in-memory traces, monotonic event timings, run/model/viewport metadata, task-specific secret redaction, sanitized JSONL persistence, and failure/timing/counter summaries.
- Events cover HTTP admission, task registration, runner/desktop setup, capture, inference/parsing, proposals/guards, input/repaint/effect, terminal/late results, and cleanup where those boundaries execute.
- JSONL files are written under ignored `client/apps/r2/server/artifacts/traces/`; screenshots/base64, passwords, Bearer tokens, sensitive URLs, and unbounded responses are not trace payload fields.
- `client/apps/r2/src/routes/+page.svelte`: the main app is now a live observability dashboard with agent/token/task connection controls, polling, current/terminal state, last confirmed stage, first failure, event timeline, model/token/frame/action metadata, per-stage durations, evidence references, and honest loading/error/empty states.
- `client/apps/r2/src/lib/observability.ts`: authenticated trace loading, URL/payload checks, and formatting helpers. Credentials remain in memory and are not written to browser storage or URLs.
- Browser access uses explicit CORS origins. Local r2 dev/preview origins are allowed by default; deployments can set comma-separated `FRONTIER_UI_ORIGINS`.

## Observed evidence

### Historical real evidence (not rerun during this implementation)

- Ollama 0.40.3; `qwen3-vl:2b`; RTX 4060; Ollama reported 100% GPU after inference.
- Real noVNC login/capture: PASS; SIGECOM visible at 1280×800.
- Latest real vision run: 3/3 valid clicks inside the independently marked Comercial rectangle `[180,68)-[315,123)`, all at `(192,120)` and approximately 1.1 seconds per warm proposal.
- These were repeated proposals over the same smoke capture, not proof of generalization, execution, or reliable completion.

Generated real evidence remains ignored by Git:

- `client/apps/r2/server/artifacts/desktop-login.png`
- `client/apps/r2/server/artifacts/vision-sigecom.png`
- `client/apps/r2/server/artifacts/vision-report.json`
- `client/apps/r2/server/artifacts/traces/`

### Current local validation evidence

- Server `npm run validate`: TypeScript PASS and 34/34 Node tests PASS, including lifecycle/deadline regressions, Ollama header/body aborts, multi-step modal recovery, stale-coordinate rejection, action bounds, repeated-state protection, trace redaction/bounds/JSONL, authenticated trace reads, and CORS.
- Client `just cycle`: client tests, six type-check jobs, formatting/lint, and both app builds PASS. r2 has three observability helper tests and zero r2 lint diagnostics.
- These are mocked/control-flow and UI/build results. No real desktop click, full task, E1, deployment, or unseen-app execution was performed during this implementation.

No desktop password or team token belongs in source, reports, summaries, trace events, or committed screenshots containing secrets.

## Next gate

Perform the FR-0153 real acceptance flow through the composed runner and inspect it in the r2 dashboard:

1. Start on the new theme with its startup modal and create a Comercial click-only task through the public API.
2. Observe fresh login/capture, modal dismissal as intermediate progress, renewed inference on the post-modal frame, and source-frame/deadline guards before every input.
3. Locate the moved/current Comercial control without reusing old coordinates, execute the required click, and capture the visible menu.
4. Verify the original postcondition separately from modal closure or screen change, close the desktop session, and retain before/after plus trace evidence. Independently mark the new target region; do not reuse or widen the historical rectangle.

Then add text replacement (`Ctrl+A`, then type) and bounded task-specific recovery for E1. Do not claim E1, a complete general agent, public deployment, or unseen-app generalization until those are observed.

## Ownership note

There is no separate vision worker. The same server owns capture, inference, guarded execution, and traces. Vision inference remains click-free and independently testable; the runner owns side effects and verification. The aborted multi-agent workflow is not an active worker; subsequent integration was completed directly in the main session.
