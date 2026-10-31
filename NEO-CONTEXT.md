# FRONTIER / RETO 2 — CURRENT CONTEXT & PROTOTYPE HANDOFF

> Snapshot: 2026-10-31, after the accepted technical design v2. Owner: Fernando / Yrrrrrf.
> Purpose: initialize a fresh model or coding session without importing obsolete assumptions.
> Status: design and documentation exist; the actual screen-control agent has NOT been implemented or benchmarked in this conversation.
> This file replaces the earlier contents of `FRONTIER-RETO-2-CONTEXT.md`. Read it as the current handoff, not as a transcript.

## 0. Start here: the idea and the immediate objective

Build our own service that accepts a natural-language task and access to a remote desktop, observes the screen, asks a local vision-language model for the next action, validates the response, clicks through our controller, and observes again. It must adapt to an application it has never seen and complete or report failure within five minutes.

The core loop is **capture → interpret/evaluate/propose → validate → click → capture again**. The next inference evaluates the previous click and proposes the next one. A finish/failure proposal exits the loop through code that records a terminal state and summary. No second planner or verifier model is required by default.

**Our agent is the complete service and execution loop. Ollama is its inference server. Qwen3-VL is a candidate model running inside Ollama.** The model can reason about progress and propose a click or closure; the service owns actual execution, credentials, session lifecycle, state, validation, deadlines and resource limits.

The next engineering goal is a **small feasibility prototype**, not a production rewrite or a larger UI. First prove capture and a programmatic click against the real permitted desktop channel. Then prove useful visual grounding, then one complete task, then the public HTTP contract.

This request produced context documentation only. Do not treat documentation generators, diagrams, TypeScript examples or the PDF as an implemented agent. The next implementation session should use the build sequence below and inspect the actual project before editing it.

## 1. Read this file using these evidence labels

| Label | Meaning |
| --- | --- |
| CONFIRMED | Explicit user constraint, supplied official brief/contract, or inspected source snapshot. |
| BASELINE | Current recommended prototype design, accepted as the working direction; subject to measured feasibility. |
| CANDIDATE | Choice requiring comparison or compatibility testing; not already selected or proven. |
| UNKNOWN | Information not supplied or not verified on the real machine/environment. |
| NOT DONE | Work not performed in this conversation. |

Authority when facts conflict: current direct user instructions and current official challenge material; then the actual current repository/environment; then this handoff and the technical design v2; then older notes. An old screenshot, export or planned installation is not a live-system observation. Keep facts, proposals and test results separate.

Do not silently promote suggestions to requirements. Do not reintroduce earlier assumptions merely because they appeared earlier in the conversation.

## 2. Challenge, scope and constraints

**Selected challenge:** RETO 2, **“El agente que opera lo que no tiene API”**. RETO 1 and its anonymization requirements are outside this project.

The supplied brief describes legacy management software used for fifteen years, with no API, no documentation and no available vendor. Employees currently use clicks, forms, dialogs and exported reports. There are five systems, so the agent must adapt rather than encode one application's workflow. Evaluation uses a previously unseen app and a clean desktop.

### Confirmed interaction boundary

- **No DOM access. Screen observations and clicks only.** This is an explicit user constraint, not an inference from the screenshot.
- Do not read selectors, accessibility trees, hidden markup, app JavaScript state, network payloads, databases or internal application APIs to solve tasks.
- A browser automation library is a proposed low-level transport for screenshots and mouse events, not permission to inspect the application internals.
- Text entry, keyboard shortcuts, scrolling, dragging, clipboard and file access are **not confirmed**. They are not baseline actions. Clarify allowed channels before implementing tasks that require them.
- A form visible on screen does not imply that typing is allowed. A task requiring an unsupported input must be reported as blocked or handled through a confirmed permitted mechanism.
- Do not use turnkey external computer-use agents/providers that perform this challenge for us. Claude/ChatGPT computer control was explicitly discussed as outside the intended solution.
- Local raw model inference through Ollama is the current direction. The exact interpretation of allowed tools should still be checked against the complete README.

### Entry point: exact known external requirements

Every call carries `Authorization: Bearer <team token>`.

| Endpoint | Known requirement | Still unknown |
| --- | --- | --- |
| `GET /health` | Return HTTP 200 when the service is ready. | Any additional required body or readiness details. |
| `POST /tasks` | Receive task text and desktop access, including URL/password; return `{"task_id":"…"}` in less than 2 seconds. | Exact request field names, additional properties, success/error status codes and admission rules. |
| `GET /tasks/{task_id}` | Return state and summary. State values are `en_curso`, `terminada`, `fallida`. | Exact JSON property names, summary format and evaluation rules. |
| Task execution | Maximum 5 minutes per task; unseen app, clean desktop. | Concurrency schedule and evaluator-specific timing details. |

**Do not invent the public request DTO or summary schema.** The README has not been supplied in this conversation. Internal types below are our proposed implementation contracts, not the evaluator's API schema.

### Event and evaluation context

- Systems design: **30%**; execution: **40%**; demo day: **15%**; individual technical depth/debrief: **15%**.
- Systems design submission: one-page PDF or link, plus a separate architecture diagram as image/PDF/link. Original deadline supplied: **12:00 CDMX**.
- Design criteria, scored 1–4: understanding with assumptions/limits/difficult cases; architecture with justified alternatives/trade-offs; concrete measurement plan before building.
- Execution: public repository, public entrypoint and public video of at most two minutes; original deadline supplied: **19:00**.
- Availability excerpts conflict between 19:00 and 20:00. Conservative plan: ready by 19:00 and available until demo day ends; confirm current instructions.
- Pitch material is optional; individual debrief is ten minutes.
- The event says it evaluates submissions, deployment and explanations; it does not collect development-tool sessions/transcripts.
- Files were generated, but **submission to the Frontier platform has not been demonstrated**. Do not claim the design was submitted or accepted by judges. The original design deadline may already have passed when another instance reads this.

## 3. Environment and source state

### User machine: last reported state, not a live probe

- NixOS; Nushell; Bun available in the user's command history.
- Local work directory shown: `~/Documents/frontier`; another prompt showed the repository name `frontier` on branch `main`. This does not establish the new session's checkout path.
- Hardware reported: NVIDIA RTX 4060. Available VRAM, GPU utilization, driver/CUDA compatibility, CPU and RAM are **not measured** here.
- Ollama was **not active yet** at the last explicit user report; installation was planned through an `# llms` section in `g14.nix`. A thirty-minute estimate is not proof installation completed. Recheck current readiness.
- Do not assume Node.js, Chromium, model weights, a public URL or a working GPU inference stack are installed just because they are in the design.
- The real remote desktop transport, URL and login flow have not been supplied in this context file. noVNC is a hypothesis, not a confirmed interface.

### Existing client: inspected export snapshot

Source reviewed: `frontier--client-20261031_110721.txt`, an export of roughly 72 files / 2,104 lines. These observations describe that snapshot, not uninspected later edits:

- Deno workspace with Svelte apps `client/apps/minimal` and `client/apps/r2`; `r2` was a copy of the starter.
- SDK layers: core, api, state and ui. Keep UI composition and HTTP/state concerns within the existing architecture when integration becomes necessary.
- Root `client/deno.json` supplies workspace/import aliases such as `@sdk`; no `package.json` was present in the export.
- SvelteKit static adapter, prerender enabled and SSR disabled. The static client is **not** a place to run the long-lived agent or hide the team token.
- `client/sdk/api/src/client.ts` and `endpoints.ts` were empty; the API module was a scaffold, not an already wired task client.
- Core kernel/schema scaffolds were also empty. Item/comment/auth entities and stores were starter examples. The sample AuthStore is not the challenge's server-side Bearer authentication.
- An `r2` page test still expected `@apps/minimal`; treat that as a starter-copy observation, not proof a new version remains broken.
- `just` recipes include run/build/test/check/audit/ci/cycle. The root justfile uses Nushell.
- In the inspected scripts, `ci` covers tests/checks, Fallow audit is separate, and some lint exit codes were ignored. Inspect the actual current recipes before relying on them.
- `cycle` invokes preparation/pruning that removes generated caches/lock state. Do not run it simply to inspect the project.
- A flake referenced a native Nix file not included in the export. That does not establish that the file is missing in the actual checkout.

**Preserve the existing client's configuration, scripts, layout and SDK structure.** Adding the server must not become an unsolicited migration of the Deno/Svelte client to Node/Bun or another framework.

### Critical filesystem distinction

The document-authoring workspace used to produce PDFs/diagrams is not the user's live NixOS machine or a verified project checkout. It contains documentation tools, not the screen-control prototype. A fresh model must locate the actual repository and credentials through the provided environment; it must not infer access from old scratch paths. If only the export/context exists, state that limitation precisely.

## 4. Current architecture baseline and why it is small

| Responsibility | Baseline technology/mechanism | Reason | Limit / proof needed |
| --- | --- | --- | --- |
| Public API | TypeScript on Node.js; native `node:http.createServer()` | Documented Node path for Playwright; retain TypeScript without introducing another language or HTTP framework. | Proposed backend runtime, not an installed/implemented fact. Pin versions after compatibility checks. |
| Task state | A backend `Map<task_id, TaskRecord>` | One-process prototype; same state read by polling and updated by runner. | RAM state is lost on restart; do not imply persistence or multi-process coordination. |
| Execution | Logical asynchronous `TaskRunner`, initially one executor | Network/browser I/O does not hold the HTTP request open. Simple resource accounting for one GPU. | This is not necessarily a worker thread/process. CPU-heavy synchronous work can still block Node. Concurrency/admission remain to be confirmed. |
| Desktop I/O | `DesktopDriver` implemented with Playwright + Chromium **if access is through a compatible web viewer** | `browser.newContext()`, `page.screenshot()`, `page.mouse.click()` provide isolated sessions, pixels and coordinate clicks. | Prove real transport/login and click effect first. For another transport, change the driver rather than the whole loop. |
| Inference | Native `fetch()` to local Ollama `/api/chat` | Direct HTTP, images and structured output; no agent framework or extra SDK required. | Need model installation, GPU readiness, real latency and grounding tests. |
| Model | **Candidates:** `qwen3-vl:2b` and `qwen3-vl:4b` | Compare smaller/faster versus larger candidate on identical tasks. | Neither candidate has been benchmarked here. Parameter count/download size is not required VRAM or achieved performance. |
| Action boundary | TypeScript union + explicit runtime guards | JSON from a model must be checked before any side effect. | Compile-time types alone do not validate untrusted JSON. |
| Optional UI | Existing Deno/Svelte SDK client | Reuse current project structure for task submission/status. | The evaluator can call HTTP directly; UI is not required to prove the execution loop. |

This baseline is a working recommendation after the technical design v2, not an instruction to defend a library that fails the transport test. Any change should identify the concrete failed assumption and the smallest justified alternative.

### Alternatives already considered

- **Python + uv:** available as an alternative if a required driver/library materially makes the prototype easier or more reliable. Not required just because the user mentioned Python.
- **Rust / Burn:** possible later production research after a working prototype and measured bottleneck. No scheduled rewrite, no assumed model importer/operator support, no claim of automatic speedup.
- **Separate planner + verifier models:** not the default; add latency and coordination. The current VLM can evaluate previous effects and propose the next action in one call.
- **Standalone OCR:** not needed initially because the VLM already receives the image. Add only for a measured failure/improvement, not as automatic architecture decoration.
- **Redis, distributed queues, persistent databases, microservices, agent frameworks:** not required for the first single-host proof. They would introduce operations without proving visual control.
- **DOM selectors, application APIs or hardcoded app-specific workflows:** excluded by channel constraints or the unseen-app objective.

## 5. The complete task pipe

1. **Receive/authenticate:** validate the request against the actual README, establish the task's monotonic deadline, register state and return `task_id` in under two seconds. Do not open the browser or await inference before returning the id.
2. **Initialize permitted session:** connect to the supplied desktop using confirmed channels. One isolated session/context per task; credentials remain in execution code.
3. **Capture:** obtain the screen image, its dimensions, identity and geometry from DesktopDriver.
4. **Decide with the VLM:** send task objective, current image, input dimensions and bounded recent history. The model evaluates the previous action's effect and proposes `click`, `finish` or `fail`.
5. **Validate in code:** parse model output, check the action schema, bind it to its originating Frame, verify coordinates/current task state/time budget, and reject invalid proposals.
6. **Act:** for `click`, map coordinates if necessary and call the permitted controller. Wait for the effect with a bounded controller policy, then obtain a **new** screenshot.
7. **Repeat:** new image returns to the **same model decision in step 4**. It does not require restarting the task, maintaining a second planning service, or invoking another verifier after every click.
8. **Exit:** a sufficiently supported finish proposal is accepted as `terminada`; a supported failure, unrecoverable error or deadline expiry becomes `fallida`. Publish state/summary through the public contract. Close the task session.

The controller may capture and wait without those operations being VLM-selected desktop actions. Any extension of the action union should solve an observed need and remain within permitted channels.

## 6. Internal technical contracts — proposed, not implemented

### Screenshot and geometry

The simplest baseline is a fixed viewport and a full screenshot in CSS scale. `1280 × 720` is an illustrative proposed viewport, not an evaluator requirement. Test whether the real viewer is usable at the chosen size.

```typescript
// Private server-side data, not a public challenge DTO.
type Frame = {
  id: string;
  png: Uint8Array;
  inputWidthPx: number;
  inputHeightPx: number;
  capturedAtMonotonicMs: number;
  viewportWidthCss: number;
  viewportHeightCss: number;
};

type Action =
  | { kind: "click"; x: number; y: number }
  | { kind: "finish"; evidence: string }
  | { kind: "fail"; reason: string };

type Proposal = {
  frameId: string; // Associated by our adapter with the inference input.
  action: Action;
};
```

Proposed DesktopDriver boundary: connect/open session, `capture(): Frame`, `click(xCss, yCss)`, close. Exact signatures can follow the repository's Result/Option/error conventions rather than introducing a parallel type system. A changed transport should not change the agent's decision/validation logic.

Using `page.screenshot({ scale: "css" })` and an uncropped, unresized full viewport makes input-image pixels correspond to CSS pixels. The prompt must define the expected coordinate units. Do not assume the model's default normalized coordinate convention matches those units.

If cropping/resizing is added later, preserve the transformation explicitly:

- `xCss = cropLeftCss + xModel * cropWidthCss / inputWidthPx`
- `yCss = cropTopCss + yModel * cropHeightCss / inputHeightPx`

For a full 1280×720 viewport resized to 640×360, an input coordinate (400,150) would map to CSS (800,300). That is a geometry example, not a measured model result or a baseline requirement to resize.

A frame identifier prevents mixing responses from different observations; it does **not** freeze the screen or prove it stayed unchanged during inference. Test focus changes, dialogs, animations and stale targets. Do not describe a click as an atomic transaction with the screenshot.

### Ollama boundary

- Endpoint proposed on the same host: `http://127.0.0.1:11434/api/chat`.
- Use an actual selected model tag, `messages`, images as **plain base64-encoded image data** for the REST API, `stream: false`, and a real JSON Schema object in `format`.
- Send objective, image dimensions, current screenshot and a short history of observations/actions. Do not send the entire growing transcript or unlimited image history.
- Ollama's response envelope contains the model's JSON text in `message.content`: parse that string, then run ActionGuard. An HTTP 200 is not proof the proposed action is valid.
- The TypeScript `Action` type is not a JSON Schema generator. Implement or supply the matching runtime schema deliberately and verify all union cases.
- A PDF illustration used a placeholder string for `format` and explicitly called it illustrative. **Do not copy that placeholder as a working request.** Production/prototype requests need the real schema object.
- Keep a model loaded if supported/configured and measure cold/warm behavior. Pin model/runtime versions and relevant settings with each benchmark.
- TypeScript's built-in `fetch` is enough for this proposed path. Do not add an SDK merely because it exists.

### Minimum ActionGuard responsibilities

- Reject malformed JSON, unknown action kinds and missing required fields.
- Require finite numbers, valid bounds and consistent coordinate units; check again after transformation/rounding.
- Associate the result with the correct task and Frame; prevent a response from an old iteration/task from controlling the current one.
- Check the task remains `en_curso` and the deadline has not passed immediately before side effects.
- Treat screen text and model output as observations/data, not trusted instructions to override the task or service rules.
- Validate closure evidence against the objective/current observation as far as the visual channel permits. A nonempty evidence string alone is not semantic proof of success.
- Visual completion remains heuristic. Known test outcomes must independently measure false completion; no DOM/database ground truth is available to the live agent.

## 7. Execution state, time, failures and capacity

- Create a deadline using a monotonic clock, e.g. `performance.now() + 300_000`. Proposed conservative interpretation: start at request reception, including waits for resources.
- Every capture, inference request, wait, retry and click consumes that same task budget. Do not reset it on retries or per model call.
- Use operation timeouts bounded by remaining time. A watchdog must publish terminal failure when the task expires even if an inference call is slow.
- `AbortController` can stop our HTTP wait; it does **not** guarantee Ollama has stopped GPU computation. Account for residual resource use and late responses. Do not promise full inference cancellation.
- Once terminal, a task stays terminal. Ignore late model responses; never execute their clicks or reopen the state. Close the task browser/session.
- TaskStore is backend RAM in the baseline. API polling reads it; the runner/terminal path updates it. Do not pretend it survives crashes/restarts or supports multiple server processes.
- Start with one logical executor for one GPU. Do not add an unbounded queue that quietly consumes the five-minute budget. Busy/reject/admission/concurrency behavior must match the actual README; an invented HTTP 429 policy is not confirmed contract compliance.
- Handle malformed model output, wrong/stale targets, no visual progress, repeated actions, dialogs, ambiguous entities and broken sessions with bounded recovery.
- Before repeating an uncertain write/save/export, observe its effect to avoid duplicates. Do not interpret unchanged pixels as a universally correct failure detector.
- Retry/step limits should be explicit and configurable in the prototype; record their actual values when testing. No specific retry count has been accepted as an official requirement.
- Return useful failure reasons. Do not mark `terminada` merely because the model said so, a click happened, a loading state appeared or an export button was pressed.

## 8. Deployment boundary

Baseline: one host with RTX 4060 runs API/TaskRunner, Chromium and Ollama. Public HTTPS ingress routes to the API. Ollama remains local to that same host, conventionally loopback port 11434. The remote desktop is outside our service.

- A public VM cannot reach the laptop's Ollama through its own `127.0.0.1`. If the service is split across machines, explicitly design and test that private connection and its latency; do not accidentally expose the inference server.
- HTTPS routing, domain/reachability, firewall/NAT behavior and hosting method are **not configured/proven** in this conversation. No specific tunnel/proxy/cloud vendor has been selected.
- NixOS requires validating Chromium executable/dependencies and GPU inference compatibility. Do not assume a standard downloaded Linux browser will work on NixOS; fix the smallest necessary environment/config boundary after inspection.
- Keep team tokens and desktop passwords server-side, out of UI bundles/logs/summaries. No real secrets belong in this handoff or repository.
- `GET /health` should reflect actual readiness for the chosen design, not just that a socket is open. Exact required body is still unknown.
- Availability through the event is an operational requirement, not something the diagrams establish.

## 9. Observed example app and difficult cases

The screenshot showed **SIGECOM · Distribuidora Andina v3.9**, with invoice list controls: Cliente, Estado, Buscar, Limpiar, Exportar; columns Código, Cliente, Fecha, Vence, Valor, Estado. This screenshot does not prove whether the application itself is web/native or which remote-viewer protocol is used.

Relevant test cases, not hardcoded workflows:

- Several customers include “Gómez”; match the task's actual invoice/customer identity rather than choosing the first name match.
- Visible rows are only a viewport; do not claim a complete aggregate/report from an unvisited table. Scroll/pagination support must respect confirmed inputs.
- Dates look like DD/MM/YYYY and amounts like `1.810.000`; preserve locale meaning.
- The app's displayed date was **14/10/2026**, different from the event date. Use the task/application context for “today” when appropriate and clarify ambiguity.
- Popups, incomplete loading, duplicate saves and a clean initial desktop can change the interaction sequence.

## 10. Prototype build order and gates

Do the smallest useful proof at each gate. Do not build a dashboard, production rewrite or distributed service before the interaction path works.

### P0 — Inspect and resolve prerequisites

1. Locate actual repo, current working tree and any project instructions. Read the current README and supplied test environment material.
2. Inspect the existing SDK/setup instead of creating a conflicting root project configuration.
3. Check current runtimes, Chromium availability, Ollama readiness/model tags and GPU resources without printing credentials.
4. Identify desktop transport, login steps, permitted input channels and concurrency/admission rules. Missing desktop access blocks a real G0 test; do not claim a local fake is the event environment.

### P1 / G0 — Driver smoke test

Implement only what is necessary to connect through the permitted channel, capture the real screen, send a known permitted click and capture its observed effect. Use a harmless known control or the provided test environment. Reset to a clean session and repeat.

Evidence: before/after images or a private local run log showing the intended control, coordinate units, click and effect. No VLM is needed to prove the driver. A manual smoke-test target does not authorize hardcoded agent workflows for hidden evaluation.

**Exit:** real capture/click works in a clean session. If not, fix transport/runtime/login first.

### P2 / G1 — Vision grounding probe

Call one candidate through Ollama with known screenshots, dimensions and an explicit action schema. Check whether it can locate a button and read exact relevant facts. Verify raw HTTP response parsing, schema handling and coordinate interpretation.

Compare 2B and 4B on the same ten screens with manual expected boxes/values. Keep output concise and history controlled. Measure load/cold time separately from warmed inference.

**Internal initial target:** at least 8/10 correct localizations for a candidate. This is a smoke-test target, not the judge's rubric or proof of generalization. If neither candidate can ground controls reliably, reassess before implementing a full service.

### P3 / G2 — One end-to-end local task

Implement TaskRunner + ActionGuard around the proven driver/model path. Run one complete task with a clean session, a hard deadline, fresh screenshots and an independently known expected result. Include the `finish` and `fail` paths.

Only after that succeeds, compare four task cases × two repeats × two candidate models. Suggested categories: opening the correct invoice, entity disambiguation, dialog navigation and verifying closure. Tasks must be achievable through allowed inputs.

**Internal evaluation targets:** at least 80% visible-task success, zero false completions, accepted tasks terminal within 300 seconds. Small samples are descriptive; do not claim statistical confidence or hidden-evaluator performance.

### P4 / G3 — Thin HTTP service

Add/complete the exact external routes and Bearer checks using the README. Return the id before browser/model work; polling must observe the same TaskStore updated by execution. Test valid/invalid auth, readiness, create/status, forced timeout and late responses. A fake driver/model can test API control flow but cannot prove screen-control success.

**Exit:** creation under two seconds; exact required JSON/summary and status values; terminal before the task deadline; no post-terminal clicks.

### P5 / G4 — Public deployment and unseen-app checks

Expose the service correctly through HTTPS, test from outside its host/network and keep inference private. Verify resource limits, clean session isolation and availability. Run varied screens/tasks, ambiguity cases and app changes. Then integrate UI only if it helps the demo or participant workflow.

Collect repo, entrypoint and <=2-minute video evidence as required. Update the technical design if measured behavior changes a decision.

## 11. Measurements: what to record, not invented results

For each run record: model tag/version/settings, viewport and image dimensions, cold/warm condition, task/case id, initial state, duration, terminal state, independently judged success and failure reason.

Per iteration record: capture latency, inference latency, action/wait latency, schema errors, target/action, visible outcome and number of retries. Keep credentials and sensitive screen contents out of public summaries.

Compare:

- Task success count / attempts and scenario-specific failures.
- Grounding accuracy and exact-value reading accuracy.
- Wrong clicks and especially **false successful closures**.
- End-to-end duration; per-stage p50/p95 with sample size and clock definition.
- Calls per task and token/output volume where the runtime exposes it.
- Peak VRAM and actual resource use; model download size is not VRAM usage.
- Cold model startup versus warm iteration speed.
- POST response time, deadline compliance and behavior after termination.

Local inference has no provider per-call charge, but hardware time, energy and operational availability still cost resources. Optimize **successful tasks within the time budget**, not just model size or calls avoided. Add components only when the measurements identify the problem they solve.

## 12. Implementation boundaries and style preferences

- Fernando prefers minimal declarations/boilerplate, strict typing and existing abstractions. Avoid `any`; follow existing Result/Option/error conventions where applicable.
- Preserve the Deno/Svelte SDK and current scripts/configuration/layout. Do not add a root package.json or migrate the client merely to accommodate a new backend.
- Proposed backend modules are responsibilities, not a mandatory proliferation of files/services: API/auth, TaskStore/admission, TaskRunner/deadline, DesktopDriver, Ollama adapter, ActionGuard and evidence/metrics.
- An optional sibling `server/` directory could house a backend if the actual repo has no established server convention. It has **not** been created or approved as an exact layout; inspect first.
- Do not infer that every cool idea is a requirement. Python, Rust, Burn, additional models and tooling were discussed as options.
- Do not re-ask decisions already settled. Resolve routine implementation choices within scope; ask for genuinely missing material after checking connected/project sources.
- Earlier in the conversation the user requested LLM/AI expert review and two agents reviewed the conceptual design. There is no need for perpetual delegation or re-review before each small change; follow the active session's delegation rules.
- Development tools such as pi/OpenRouter are not the deployed visual agent. Old setup/credits troubleshooting is not a requirement of the local inference architecture.
- No actual API keys, desktop passwords or team tokens are included. An OpenRouter key was exposed earlier; do not reproduce it or assume it was rotated. Use secure configuration when relevant.

## 13. Documentation and artifacts already prepared

The latest technical design v2 was accepted as the basis for this context after the user rejected the original text-heavy one-page draft and a concept-only diagram. The corrected documentation emphasizes concrete components, libraries, functions, interfaces, data and deployment.

| Artifact | Current role |
| --- | --- |
| `frontier-design.pdf` | Five-page illustrated technical design: architecture, model/control contracts, technology trade-offs, execution/deployment and evaluation. |
| `frontier-design-submission.pdf` | Separate one-page visual sheet for the platform's design field. The five-page explainer does not replace that format requirement. |
| `frontier-design.typ` | Typst source for both outputs, selected with `--input mode=full` or `--input mode=submission`. |
| `frontier-architecture.excalidraw` | Editable technical architecture scene, using actual Excalidraw export tooling. |
| `frontier-architecture.png` | High-resolution diagram export. |
| `frontier-architecture.svg` | Vector export embedded by Typst. |
| `frontier-technical-v2.zip` | PDFs, Typst source, Excalidraw, PNG, SVG and source instructions in a portable folder structure. |

Portable source structure in the ZIP: `pdf/frontier-design.typ` references `../architecture/frontier-architecture.svg`. Compile from the extracted bundle root, with Typst 0.15.0 and DejaVu Sans/DejaVu Sans Mono fonts:

```text
typst compile --root . --input mode=full pdf/frontier-design.typ frontier-design.pdf
typst compile --root . --input mode=submission pdf/frontier-design.typ frontier-design-submission.pdf
```

If a diagram is changed, export the SVG as well as PNG before recompiling the PDF. Keep technical content aligned across source, diagram and submission sheet. Prefer clear visual hierarchy, diagrams, payloads and decision tables over wall-of-text formatting. No new documentation overhaul is needed before the prototype.

The earlier `FRONTIER-RETO-2-PIPELINE.mmd` and the first one-page PDF/conceptual image are obsolete design representations. They must not overrule the current technical design or this handoff. The approved simple HTML loop explained chronology; Excalidraw additionally supplies components/interfaces. Both describe the same loop, not different agents.

This handoff is self-contained for the idea/decisions. File names above do not imply the files or the actual repository are automatically present in the next model's filesystem.

## 14. Current fact / decision / result ledger

| Item | Status at this handoff |
| --- | --- |
| Challenge selection | CONFIRMED: Reto 2. |
| No DOM, screenshot/click channel | CONFIRMED by the user. |
| Other desktop inputs | UNKNOWN / not confirmed. |
| Client architecture | CONFIRMED export snapshot: Deno/Svelte SDK starter. Reinspect live checkout before changes. |
| Backend TS/Node, native HTTP, RAM state | BASELINE recommendation from technical design v2; NOT DONE. |
| DesktopDriver with Playwright | CANDIDATE conditioned on a compatible web viewer. |
| Ollama running on user machine | UNKNOWN now; last explicit report said not active yet. |
| Qwen3-VL 2B vs 4B selection | CANDIDATES; no benchmark and no winner. |
| Capture → click against real desktop | NOT DONE in this conversation. |
| VLM grounding / complete task | NOT DONE. |
| Public agent/API/deployment | NOT DONE. |
| Design documentation and exports | DONE; technical revision v2 generated and reviewed visually. |
| Submission to event platform | UNKNOWN; generating files is not submitting them. |
| README / exact public JSON | UNKNOWN / not supplied. |
| Concurrency/admission/evaluator details | UNKNOWN. |
| NixOS GPU/Chromium compatibility and VRAM | UNKNOWN / not tested on the user machine. |

## 15. Prevent rotten context: update rules

After a concrete test or code change, update this canonical file rather than adding contradictory unversioned notes:

1. Record date, environment and source of each new fact.
2. Mark a prerequisite as complete only with observed evidence, not an elapsed installation estimate.
3. Replace candidate decisions with measured choices, including the rejected alternative and reason.
4. Record actual command/test, inputs, sample size and result. Keep mock/local/real-environment outcomes distinct.
5. Record actual repository paths and committed modules only after they exist.
6. Amend public DTOs only from the actual README/current official material.
7. Preserve unresolved questions explicitly. Do not fill them with plausible fields, transport names, metrics or deadlines.
8. If a design changes, update this file and the affected artifacts; do not silently leave incompatible diagrams as current.
9. Keep credentials out of handoff files and screenshots intended for public delivery.

Suggested compact update entry:

```text
Date/environment:
Changed fact or decision:
Evidence (test + inputs/sample size + outcome):
Files/modules actually changed:
Remaining limits:
Next smallest test:
```

## 16. Fresh-instance bootstrap prompt

> Read this context completely and treat it as the current project snapshot. Our next objective is a minimal prototype of the screenshot → local VLM → validated click → new screenshot loop for Frontier Reto 2. Start by locating the actual repo/README and checking current desktop transport, permitted inputs, Chromium and Ollama/GPU readiness. Preserve the existing Deno/Svelte SDK and scripts. The recommended backend baseline is TypeScript/Node.js + Playwright (if the viewer is web) + Ollama; Qwen3-VL 2B/4B are untested candidates. Prove real capture/click first, then grounding and one complete task before UI or production expansion. Do not invent public DTOs, claim unrun tests, use DOM access, or turn Python/Rust/Burn into requirements. Explain evidence, implement only the next authorized necessary step, and update the fact/result ledger as work proceeds.

## 17. Technical reference points

These were official technical references consulted during design; verify current exact versions/APIs when implementing rather than assuming an unpinned dependency behaves identically:

- Node HTTP: https://nodejs.org/api/http.html
- Playwright library: https://playwright.dev/docs/library
- Playwright screenshot API: https://playwright.dev/docs/api/class-page#page-screenshot
- Playwright mouse / CSS coordinates: https://playwright.dev/docs/api/class-mouse
- Ollama chat / structured response settings: https://docs.ollama.com/api/chat
- Ollama vision / REST base64 input: https://docs.ollama.com/capabilities/vision
- Candidate model family/tags: https://ollama.com/library/qwen3-vl

Event requirements in this file come from the participant-supplied brief, contract and rubric. Current official README details, once available, take precedence over unresolved assumptions here.
