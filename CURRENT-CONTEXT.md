# FRONTIER RETO 2 — CURRENT PROTOTYPE CONTEXT

Snapshot: 2026-10-31. This is the current implementation handoff. The official contract remains `reto-2/README.md`; it takes precedence over this file.

## Implemented now

### Shared official contract

- `client/sdk/core/src/schemas/frontier.ts`: ArkType schemas for `{ tarea, escritorio: { url, password } }`, `{ task_id }`, and `{ estado, resumen }`.
- `client/sdk/api/src/frontier.ts`: typed `health`, `createTask`, and `getTask` methods using the existing Axios SDK and response validation.
- Public states are exactly `en_curso`, `terminada`, and `fallida`.

### Node server

- `server/src/http.ts`: native `node:http`, Bearer authentication, official routes, and JSON validation.
- `server/src/service.ts`: RAM task state, background execution boundary, monotonic task deadline, terminal-state protection, and password redaction.
- The default runner deliberately returns `fallida` because the real agent loop is not connected yet. HTTP tests inject runners; those tests are control-flow evidence, not task-completion evidence.

### Real desktop transport

- `server/src/vnc.ts`: Playwright controls only the noVNC viewer login and remote canvas. It never reads the target application's DOM.
- Real noVNC login and raw 1280×800 SIGECOM capture are proven.
- `capture()` reads the remote canvas without noVNC overlays.
- `click()` maps image coordinates to the canvas, holds for 120 ms, and waits one second. A real click has NOT yet been executed.

### Local vision

- `server/src/vision.ts`: native-fetch Ollama `/api/chat` adapter using `qwen3-vl:2b` by default.
- Internal actions: `click`, `finish`, and `fail` with a dynamic JSON Schema and explicit runtime guards.
- Coordinates are integer pixels of the exact input PNG, origin top-left.
- Frame identity is attached by our code. Timeout/cancellation, malformed responses, dimensions, extra fields, and coordinate bounds are checked.
- Current inference settings: temperature 0, `num_ctx` 4096, `num_predict` 256.
- `server/src/validate-vision.ts` performs a real login/capture and three inference proposals. It never executes the proposed click.

## Observed evidence

- Ollama 0.40.3; `qwen3-vl:2b`; RTX 4060; Ollama reported 100% GPU after inference.
- Real noVNC login/capture: PASS; SIGECOM visible at 1280×800.
- Latest real vision run: 3/3 valid clicks inside the independently marked Comercial rectangle `[180,68)-[315,123)`.
- All three latest proposals were `(192,120)`; elapsed times were approximately 1108, 1066, and 1081 ms.
- Latest run used 1210 input tokens and 128 output tokens per proposal.
- An earlier initial attempt returned invalid action content; subsequent repeated real runs passed. This is a smoke result, not proof of generalization or reliable completion.
- Client `just cycle` passed: tests, six type-check jobs, and both app builds.
- Server `npm run validate` passed with six tests after the HTTP/vision implementation.

Generated evidence is intentionally ignored by Git:

- `server/artifacts/desktop-login.png`
- `server/artifacts/vision-sigecom.png`
- `server/artifacts/vision-report.json`

No desktop password or team token belongs in source, reports, summaries, or committed screenshots containing secrets.

## Next gate

Integrate `server/src/vision.ts` with the real desktop driver in a TaskRunner and perform one harmless real action:

1. Log in and capture a fresh frame.
2. Ask for a click on Comercial.
3. Check task state, deadline, frame identity, schema, and bounds immediately before clicking.
4. Execute the click, wait for repaint, and capture the visible menu.
5. Close the desktop session and record before/after evidence.

Then add bounded recovery and text replacement (`Ctrl+A`, then type) for E1. Do not claim E1, a complete agent, public deployment, or unseen-app generalization until those are observed. The `r2` UI remains a starter and is not required for the next gate.

## Ownership note

There is no separate vision worker now. The same server implementation owns capture, inference, validation, and upcoming execution. Keep vision inference free of clicks so it remains independently testable.
