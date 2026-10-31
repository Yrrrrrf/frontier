# FRONTIER — RETO 2 — PORTABLE CONTEXT & EXECUTION BRIEF

Version: 1.0 • Updated: 2026-10-31 • Event timezone: America/Mexico_City (CDMX).
Owner: Fernando / Yrrrrrf. Language: English for portability; official labels, statuses and source excerpts retain Spanish.
Purpose: give another model enough verified context to continue this hackathon without rediscovering requirements, inventing contracts, or treating proposals as completed work.
Scope: Frontier Challenge 2, its setup, design, implementation, evaluation and delivery. This is a handoff document, not the official one-page systems-design submission.

## 0. Read this first: operational summary

Fernando has SELECTED RETO 2, “El agente que opera lo que no tiene API.” Selection is fixed. Build an internet-accessible HTTP service that accepts a natural-language task plus a remote desktop URL/password, returns a task_id in under two seconds, operates the application through the permitted desktop interface, and reports progress/completion. Each task has five minutes. Evaluation uses an application the agent has not seen and a clean evaluation desktop. The organization describes five legacy systems and expects adaptation across them.

The hard problem is screen-based generalization, execution, recovery and verifiable completion under a tight time budget. A scripted workflow for the sample application alone is insufficient. A concrete workflow is useful as an integration test.

CRITICAL MISSING INPUT: the challenge README/material, detailed rubric, clarifications, desktop access protocol, exact request/result schemas, and permitted runtime tooling have NOT been supplied in this conversation. Read those before implementing integration-specific code.

Immediate priorities:
1. Resolve/observe the local Pi + event OpenRouter key test.
2. Obtain the official README, clarifications and rubric.
3. Connect to the practice desktop, capture one screen and perform one allowed action.
4. Establish an end-to-end asynchronous task path.
5. Exercise different tasks/screens and recovery.
6. Deploy and validate the actual public entrypoint; finish design, video and repository deliverables.

Last observed setup status:
- Frontier checks for Pi installed and Pi running are green.
- “La key de OpenRouter responde” remains red: “Tu key todavía no registra ninguna llamada.”
- Fernando loaded an environment variable via hidden Nushell input, ran the pipeline and received “Frontier: recibimos el resultado. Vuelve a Herramientas y presiona ‘Verificar mi setup’.”
- That acknowledgment proves the setup endpoint received a submission; it does not expose what Pi produced.
- The Pi output was piped away. A successful model response has not yet been observed in the shared transcript.
- A full provider credential was exposed in a later message. Its value is intentionally excluded from this file. Replacement/revocation has been advised; completion of that action is UNKNOWN.
- There is no confirmed implementation repository, working desktop adapter, deployed backend, evaluation score or completed deliverable yet.

## 1. Evidence rules and authority

Use these labels throughout the handoff:
- CONFIRMED: explicitly present in the user-provided event text/screenshot or an observed command result.
- DOCUMENTED: supported by linked official technical documentation; check installed-version help if behavior differs.
- PROPOSED: an engineering recommendation, not an organizer requirement.
- UNKNOWN: missing information; do not fill it with invented facts.

Authority order:
1. Latest explicit organizer clarifications and challenge README/contracts/rubric, when supplied.
2. Latest actual evaluation responses and supplied practice-environment behavior.
3. The event UI text quoted by Fernando, preserved in this document.
4. Official software documentation for implementation details.
5. Proposals in this document.

Resolve conflicts explicitly. Do not silently reinterpret rules. Keep official Spanish status strings exact. Never claim a test passed, key became active, deployment exists, or app interaction succeeded without observing the corresponding evidence.

Earlier conversation included broad encouragement and a provisional recommendation to start with a narrow workflow. The full brief now establishes unseen-app evaluation. The design must reflect that requirement.

## 2. Participant, environment and collaboration context

Fernando is a full-stack developer, recently finished Computer Engineering studies with degree formalities previously pending, with approximately three months of formal employment and around three years of independent software development at the time of application. He self-describes AI knowledge as basic; explain model/API/agent mechanics clearly without assuming ML specialization.

Relevant experience:
- Rust, TypeScript/JavaScript, Python; APIs, databases, reusable SDKs, UI libraries and developer tools.
- Rune Lab: Svelte plugin kernel/application infrastructure.
- Arkano: Svelte interoperability with React/Vue.
- Prism-Py / Aether / Axion: schema/API/type-tooling work at differing maturity levels.
These establish transferable skills; they do not prove this computer-use agent already exists.

Local environment:
- NixOS and Nushell.
- bunx is the launcher being used for @earendil-works/pi-coding-agent.
- Recent working directory shown: ~/Documents/frontier.
- Earlier prompt showed a nixos git repository; do not assume it is the challenge repository.
- Fernando reports SecretSpec is not installed/available for this setup.
- Uploaded NixOS source snapshot: nixos-20261031_102531.txt. It defines Nushell and mentions SecretSpec in development configuration, but a source declaration is not evidence the binary is installed in the current shell.
- The inspected Nushell module enables programs.nushell and configures shell integrations. No system rebuild is required merely to set a process environment variable.

Implementation preferences, applied with judgment:
- Minimal declarations and boilerplate; explicit boundaries; strict types.
- Prefer a small understandable core over speculative abstractions.
- Preserve existing project scripts/configuration when an actual project is supplied.
- Do not import unrelated SPA, native, branding or application-shell requirements from earlier projects into this backend task.
- No preferred runtime/language has been selected for this challenge.
- No new multi-agent implementation has been requested in this active task. If delegation is later authorized, use clear ownership and integration criteria.

This context is sufficient for the challenge discussion; prior portfolio, logo, sponsor research and personal application essays do not need to be replayed.

## 3. Confirmed event mechanics and deadlines

Event: Frontier, presencial in CDMX, Saturday 2026-10-31.
Timezone for all deadlines below: America/Mexico_City.

The pasted interface included a “FRONTIERBOG / 26” label, while other event information identifies CDMX. Do not substitute a Bogotá event's dates or rules because of this UI label.

Challenge selection:
- Latest pasted UI: selection closes at 10:30.
- Anyone who fails to choose is assigned to the challenge with fewer participants.
- Selection cannot be changed.
- Fernando has already selected RETO 2; do not ask him to select again.
- A teammate who chose the same challenge may be added after systems design closes.
- Current teammate/team membership is UNKNOWN; “Mi equipo se asigna el sábado” was UI text, not proof a team has since been assigned.
- Earlier UI suggested selection stayed open all day. The later 10:30 UI supersedes that older wording.

Deliverables:
| Milestone | Deadline | Required material |
|---|---|---|
| Systems design | 12:00 | One-page design document, PDF or link; architecture diagram, image/PDF/link. |
| Execution | 19:00 | Public repository URL; public deployed entrypoint and team token; public video no longer than two minutes. |
| Demo day | Before the team's turn | Pitch slides/PDF/link are optional. |

Availability conflict:
- A short restrictions paragraph says the agent must be reachable from 20:00.
- The detailed entrypoint contract says reachable from 19:00 until the end of demo day.
- PROPOSED conservative plan: be live and ready by 19:00 and keep it available until demo day ends.
- Ask organizers for authoritative resolution when practical; do not present the conflict as resolved.

No exact current time or countdown should be inferred from old screenshots or pasted clocks. Recalculate using CDMX time.

## 4. Official Challenge 2 text supplied by Fernando

The following Spanish excerpt is the challenge wording supplied in the conversation, not a newly retrieved README.

### Title and summary

RETO 2 — ABIERTO  
El agente que opera lo que no tiene API

“Un agente que aprende a operar sistemas sin API, por pantalla, y ejecuta tareas en lenguaje natural en apps que nunca ha visto.”

### Brief

“Tenemos un sistema de gestión que usamos hace 15 años. No tiene API, no tiene documentación y el proveedor desapareció. Todo se hace a mano: clics, formularios, ventanas emergentes, reportes que se exportan uno por uno. Queremos un agente que aprenda a usar ese sistema como lo haría un empleado nuevo y que ejecute tareas que le pidamos en lenguaje natural, aunque nunca las haya hecho antes. Tenemos 5 sistemas como estos, así que el agente se debe poder adaptar a cualquiera.”

### Restrictions

“No uses herramientas ni proveedores externos que hagan esto por ti.”

“Las apps se acceden igual que la de pruebas.”

“Entregable: el agente desplegado y accesible desde internet desde las 20:00 hasta que termine el demo day, con el contrato de abajo.”

### Detailed entrypoint contract excerpt

“Desplegado por tu equipo, accesible desde internet desde las 19:00 hasta que termine el demo day. Todas las llamadas llevan Authorization: Bearer <token>. Despliégalo donde quieras.”

“GET /health — Responde 200 cuando el servicio está listo.”

“POST /tasks — Recibe la tarea en lenguaje natural y el escritorio (URL y contraseña). Responde {\"task_id\": \"…\"} en menos de 2 segundos.”

“GET /tasks/{task_id} — Devuelve estado (en_curso, terminada, fallida) y resumen. Cada tarea tiene 5 minutos. Se evalúa sobre una app que tu agente no ha visto, en un escritorio limpio de evaluación. El formato del resumen y las reglas de evaluación están en el README de tu material.”

Important interpretation boundary: these excerpts establish the goal and partial contract. They do NOT define every JSON field, allowed library, transport, concurrency limit or scoring rule.

## 5. Contract matrix: implement exactly what is known

| Item | Confirmed | Missing / must not assume |
|---|---|---|
| Authentication | Every call includes Authorization: Bearer <token>. | Exact unauthorized response schema; token issuance/rotation details. |
| GET /health | HTTP 200 when ready. | Response body; startup/readiness semantics beyond that. |
| POST /tasks input | Natural-language task plus desktop URL/password. | Exact JSON names, nesting, validation rules and optional fields. |
| POST /tasks output | JSON object with task_id; response in under two seconds. | Required success status code: do not assume 200 versus 202. |
| GET /tasks/{task_id} | State and summary. | JSON field names and detailed result schema. |
| State values | en_curso, terminada, fallida. | Whether any additional externally visible states are allowed. |
| Task budget | Five minutes per task. | Precise timer start, queue behavior and timeout scoring. |
| Evaluation environment | Unseen app; clean desktop. | Desktop reset/isolation details and initial authentication state. |
| Reachability | Public internet entrypoint; maintained through demo day. | Evaluator network restrictions, request cadence and maximum concurrency. |

Do not invent request fields such as task, prompt, desktop_url or password as though they were the official schema. A proposed internal type may use descriptive names, but the HTTP adapter must use the README's exact wire format.

Do not translate status values into running/completed/failed at the public boundary unless the README explicitly permits it. Internal status enums may be richer, with an explicit mapping to the required external values.

A POST handler must not wait for the model, desktop login or complete task execution before responding. Register the task, schedule execution and return the ID promptly.

The team bearer token is not the OpenRouter API key and is not the personal setup identifier below.

## 6. Restriction interpretation: unresolved and important

The phrase “No uses herramientas ni proveedores externos que hagan esto por ti” has not been clarified in the supplied material.

UNKNOWN until official clarification:
- Whether raw model APIs are allowed at runtime.
- Whether the provided OpenRouter allowance is for coding, the submitted runtime agent, or both.
- Which screenshot, desktop transport, keyboard/mouse or browser libraries are allowed.
- Whether DOM, accessibility tree, OCR, clipboard, filesystem or process inspection is permitted.
- Whether existing computer-use model endpoints are permitted versus forbidden turnkey agents.
- Whether provided sample-app internals may be inspected.
- Whether cross-task memory or advance exploration of the practice system is allowed.

PROPOSED baseline: build the orchestration/control loop ourselves and use the permitted screen/input transport. Verify allowed perception/model components against the README before choosing a provider.

Do not assume the restriction bans all dependencies or all external inference. Do not assume it permits hosted browser agents, managed computer-use services or a prebuilt end-to-end agent. Those conclusions require evidence.

Likewise, “no API” describes the target application. A remote-desktop transport may legitimately expose a protocol/API for pixels and input. Distinguish permitted desktop control from direct calls to the target application's hidden backend.

Coding assistants used during development and the runtime agent being evaluated are separate concerns.

## 7. Questions to resolve first

Priority P0 — determines whether the implementation can run:
1. Where are the official README/material, practice desktop and detailed rubric?
2. What exactly is the desktop URL: VNC/RFB, noVNC/WebSocket, a browser page, an organizer-provided gateway, or something else?
3. How is the desktop password supplied? What viewport/resolution and input protocol apply?
4. Which models, inference providers and transport/control libraries are permitted?
5. What are the exact POST /tasks and GET /tasks/{task_id} schemas, including the summary?

Priority P1 — determines correctness and throughput:
6. When does the five-minute budget start, and does it include queued time?
7. How many tasks can arrive concurrently? Is each desktop distinct?
8. What is allowed to persist between tasks, and what does “clean desktop” mean operationally?
9. What observable task outcomes are evaluated? Are files/reports expected, and how are they returned?
10. Which errors/status codes are expected for invalid credentials, unavailable desktops and unknown task IDs?
11. Is there a supplied validator or sample evaluation harness? What constitutes an evaluation attempt?
12. Which availability deadline, 19:00 or 20:00, is authoritative?

Do not block independent preparation on every P1 answer; isolate uncertainty so the integration can be corrected without rewriting the core.

## 8. Proposed architecture: minimal service with explicit boundaries

Status: PROPOSED. No backend or desktop adapter has been implemented in the shared work.

Start with one long-running service/container that hosts:
- HTTP contract/authentication.
- Task registry and bounded execution scheduler.
- Agent worker.
- Desktop session adapter.
- Model/perception adapter, if permitted.
- Progress/evidence recording.

This is a practical default for a one-day event. It is not a required stack or a request to build a reusable agent framework.

Logical components:
1. HTTP adapter: wire schema, bearer authentication, task registration, state lookup.
2. Task runner: owns deadline, cancellation, session lifetime and terminal state.
3. Agent policy: consumes task + current observation + compact execution memory; selects an allowed next action.
4. Desktop adapter: obtains observations and executes input using the documented remote protocol.
5. Result verifier: checks task-specific completion against observed application state.
6. Evidence store: records actions, observations and concise outcome summaries.

A small dependency graph:
| Component | Depends on | Must not depend on |
|---|---|---|
| HTTP adapter | Task service + contract types. | A specific application's screen layout. |
| Task runner | Agent policy + desktop/model interfaces + clock. | Hardcoded sample-app workflows. |
| Desktop adapter | Allowed transport/protocol. | Business semantics of customers, invoices or reports. |
| Agent policy | Goal, fresh screen and execution memory. | Private target backend endpoints unless expressly allowed. |
| Verifier | Explicit success conditions and observations. | The model's unsupported assertion that a click succeeded. |
| Evidence store | Structured execution events. | Provider keys/passwords as log fields. |

No runtime language has been selected. Fernando knows Rust/TypeScript/Python. Choose based on the allowed desktop protocol, working library support and fastest reliable deployment. Do not prescribe a multi-runtime stack without a demonstrated need.

A static SPA host alone cannot run this long-lived HTTP/desktop workload. Any UI is supplementary; the required service contract is the delivery target.

## 9. Proposed agent loop and runtime memory

Baseline execution:
1. Receive task and establish an absolute deadline.
2. Open an isolated desktop session using the supplied access details.
3. Capture an initial screen; note image dimensions and connection state.
4. Turn the requested outcome into a short set of success conditions.
5. Choose the next action from the allowed action vocabulary.
6. Validate the action; execute it through the desktop adapter.
7. Observe again; assess change, progress, errors and side effects.
8. Update the plan/memory using observed facts.
9. Continue until success is verified, the task is impossible, or the deadline ends.
10. Release session resources and publish a terminal result/summary.

The loop should initially execute one action, then observe. Optimize with short batches only after correctness is understood and the rules permit them. Avoid blind long action chains on an unknown UI.

Suggested per-task memory:
- Original user goal and explicit constraints.
- Current subgoal and remaining success conditions.
- Last fresh screenshot/observation and its dimensions.
- Facts actually observed, including record identifiers and application feedback.
- Last action, expected effect and observed effect.
- Steps attempted and failed strategies.
- Side effects that have been confirmed versus merely attempted.
- Outstanding ambiguity.
- Remaining time and bounded retry/progress counters.

Keep a compact trace instead of repeatedly sending every full screenshot/history. Never compress away exact user-requested values or unresolved uncertainty.

The word “learns” in the brief does not itself establish a requirement to train/fine-tune a model. PROPOSED interpretation: discover navigation and behavior from interaction and retain useful observations during execution. Verify expectations in the rubric.

## 10. Proposed action and observation boundary

The following is a design vocabulary, NOT the organizer's API:
- Observe current screen.
- Move pointer/click/double-click if supported.
- Type text.
- Press key or key combination.
- Scroll.
- Wait briefly for a visible transition, subject to remaining time.
- Signal candidate completion or inability to proceed.

Only expose capabilities that the permitted adapter actually implements. Do not advertise nonexistent actions to the model.

Action validation:
- Coordinates correspond to the most recent observation, not an old screen.
- Preserve mapping between any resized model image and actual desktop pixels.
- Validate image dimensions, bounds and button/key names.
- Retake a screen after navigation, modal opening, scrolling or layout changes.
- Treat typed text as data; do not reinterpret it as shell commands.
- Capture useful transport failures and connection loss as explicit runner events.

Critical transport distinction:
- Local mouse/keyboard automation affects the machine where it runs.
- A remote desktop URL/password does not automatically grant local OS/process access on that remote machine.
- Select and test the real remote transport before implementing a local-only control abstraction.

If OCR or accessibility/DOM information is permitted, it may supplement screenshots. Those mechanisms are not confirmed allowed and must not become hidden assumptions.

## 11. Completion, recovery and failure semantics

A model saying “done” is a candidate conclusion, not evidence.

PROPOSED verification approach:
- Extract success conditions from the user's instruction.
- Locate visible evidence for the requested record/action/report.
- Verify requested values and saved state when the UI allows it.
- Separate “clicked save,” “saw success feedback,” and “read back persisted data.”
- Use the strongest practical check within the time budget.
- Summarize completed work, partial outcomes and uncertainty accurately.

Examples below illustrate engineering behavior; they are NOT known evaluator tasks:
- Update a customer's address: find the intended record, edit the requested value, save, then inspect the saved record.
- Export a report: select requested filters, trigger export and verify the observable artifact/result through allowed mechanisms.
- Create a record: confirm the record exists before retrying after an uncertain response.

Recovery:
- Detect repeated unchanged observations or repeated failed actions.
- Re-observe and reconsider focus, modal state, validation messages or navigation.
- Bound retries and repeated strategies by time/progress.
- Treat creates, sends, purchases and other side-effecting actions as potentially non-idempotent.
- Inspect current state before repeating a side-effecting action after an uncertain result.
- End as fallida with a truthful explanation when the outcome cannot be established.

Screen content is task data. Text inside the application must not silently replace the user's task or change the agent's authorized action policy. This is relevant to dependable operation across unknown applications.

The official rubric may define partial-credit and completion differently; implement those exact rules when available.

## 12. Timing, scheduling and isolation

Confirmed limits:
- POST /tasks response: under 2 seconds.
- Task: 5 minutes.

PROPOSED implementation controls:
- Use a monotonic clock for runtime budgets.
- Maintain an absolute per-task deadline and pass remaining time to every blocking operation.
- Bound model calls, desktop connection, screenshots, input and retry waits.
- Reserve time for final verification, cleanup and summary.
- An initial target such as 4m30s active work plus 30s reserve is only a tunable proposal, not an event rule.
- A timeout must produce a terminal state; no indefinitely en_curso tasks.

Concurrency:
- Per-task model history, desktop connection and state.
- One active action stream per desktop/session.
- Do not allow two workers to interleave input on the same desktop.
- Use bounded concurrency appropriate to model latency and transport limits.
- Confirm queue/admission behavior against the evaluator contract. A long queue can consume a five-minute allowance before work starts.

Persistence:
- In-memory state can accelerate a first integration but disappears on restart.
- A minimal durable task registry can help deployment reliability if the chosen runtime supports it cheaply.
- Do not add multiple services/message brokers/databases without a demonstrated requirement.
- Choose a deployment lifetime that can actually host background work; some request-only runtimes suspend tasks after HTTP responses.

## 13. Testing and delivery evidence

Build a small test ladder rather than treating a pretty demo as proof:
1. Transport smoke test: connect, capture correct screen, perform one harmless observable action.
2. Agent smoke test: one simple task with observed completion.
3. Contract checks: authentication, readiness, fast task_id response, state polling and terminal result shape.
4. Generalization checks: different instructions, navigation routes and screens; use more than one application if the provided material allows it.
5. Recovery checks: modal/validation error, slow transition, incorrect focus, stale screen and uncertain save.
6. Budget checks: connection/model hangs do not leave tasks running past the limit.
7. Deployed end-to-end check: invoke the actual public URL with the required team token and exercise the real worker/desktop path.

Keep test claims specific: which environment, task, result and evidence were observed. Success on the practice app does not establish success on hidden evaluation apps.

Evaluation-attempt caution:
- RETO 1's pasted brief has a “three evaluation runs” rule.
- No such rule has been provided for RETO 2.
- Do not import Challenge 1's attempt limit or scoring weights into this challenge.

Useful run measurements:
- Acceptance latency.
- Connection time.
- Model latency and number of calls.
- Number of actions/observations/retries.
- Total task duration.
- Completion evidence and reason for failure.
These are proposed engineering metrics, not claimed scoring criteria.

## 14. Concrete build order for the day

Milestones are proposed; align them with actual CDMX time and rubric.

M0 — Official contract resolved:
- Read the supplied README/clarifications/rubric.
- Confirm allowed runtime components.
- Capture exact wire schemas and desktop details.

M1 — Desktop integration proven:
- Connect using the real practice URL/password.
- Capture one screen with known dimensions.
- Execute and observe a permitted input action.

M2 — Vertical slice:
- Authenticated POST returns ID quickly.
- Worker connects and performs a simple goal-directed interaction.
- GET exposes truthful progress and terminal outcome.

M3 — Generalization and recovery:
- Exercise substantially different tasks.
- Remove dependencies on sample-app-specific labels, coordinates and scripted recipes.
- Add deadline-aware verification and bounded recovery.

M4 — Public deployment:
- Configure credentials outside public source.
- Deploy the long-running service.
- Test public health/auth/task flow and capture latency/results.
- Keep service available through demo day.

M5 — Submission:
- One-page design and architecture diagram by 12:00.
- Public repo, entrypoint/token and <=2-minute public video by 19:00.
- Optional pitch material before the assigned turn.

Potential division of labor if a same-challenge teammate is added:
- Person A: service contract, runtime/deployment, task state and deadline.
- Person B: desktop adapter, observation/action loop and scenario tests.
- Share exact interfaces early; integrate continuously. This is a proposal, not an assigned team.

## 15. What the one-page systems-design submission should communicate

This context file is intentionally longer than one page. Condense into:
- Problem: arbitrary natural-language operations on unseen legacy UIs.
- Confirmed input/output contract and time limits.
- Architecture components and data/control flow.
- How observations become validated actions and verified outcomes.
- Timeouts, recovery, task isolation and credential handling.
- Main tradeoffs and known limits.
- Testing/evaluation approach consistent with the rubric.

The architecture diagram should show: evaluator -> HTTP API -> task runner -> policy/desktop loop; policy's permitted model interface; desktop observation/action boundary; task/evidence storage; status polling back to the evaluator. Label proposed choices as choices and unknown integration points as pending.

Do not describe components as implemented until they exist. The design can be precise while documenting uncertainty.

Video <=2 minutes:
- State one task and starting conditions.
- Show input/acceptance and meaningful agent execution.
- Show evidence of the final result.
- Briefly explain adaptation/recovery and important limitations.
Final structure must follow the actual rubric when supplied.

## 16. Nushell + Pi + OpenRouter: exact setup context

This section concerns developer setup verification. It does not decide what runtime providers the challenge allows.

Known tools:
- Shell: Nushell, not Bash.
- Launcher: bunx @earendil-works/pi-coding-agent.
- Provider: openrouter.
- Model requested by the setup page: openai/gpt-4o-mini.
- Prompt marker: FRONTIER-36B2D8.
- Personal setup submission endpoint:
  https://frontier.lab10.ai/api/setup/36b2d831-e4b7-48b1-81e7-9c82d8c7ce2d

The setup identifier/marker above are from Fernando's supplied command. They are not the team bearer token. No actual OpenRouter key is included here.

### Load the assigned key in the current Nushell

Run this, paste the key at the hidden input prompt, then press Enter:

```nu
$env.OPENROUTER_API_KEY = (input --suppress-output "Pega tu key de OpenRouter: " | str trim)
```

DOCUMENTED:
- Nushell sets process environment with $env.NAME = value.
- input --suppress-output hides typed characters.
- Pi recognizes OPENROUTER_API_KEY.
- This session environment is available to programs launched from the same shell. It is not automatically persisted to new terminals.
- Pasting the raw key alone after the shell prompt does not assign an environment variable.

Do not print or paste the actual key when sharing diagnostics. A raw key was exposed in the conversation; replacement has been advised and remains unconfirmed.

### Original Nushell-compatible submission pipeline

```nu
bunx @earendil-works/pi-coding-agent --provider openrouter --model openai/gpt-4o-mini -p "Responde solo con: FRONTIER-36B2D8" out+err>| curl -fsS --data-binary '@-' https://frontier.lab10.ai/api/setup/36b2d831-e4b7-48b1-81e7-9c82d8c7ce2d
```

DOCUMENTED: out+err>| combines stdout/stderr into the next command. Bash's 2>&1 is not the corresponding Nushell syntax. '@-' is passed literally to curl to read request bytes from stdin.

Observed endpoint response:
“Frontier: recibimos el resultado. Vuelve a Herramientas y presiona ‘Verificar mi setup’.”

Observed page result afterward:
- Pi installed: green.
- Pi runs: green.
- OpenRouter key responds: red.
- “Tu key todavía no registra ninguna llamada.”

Do not equate the endpoint acknowledgment with successful inference.

### Isolate the real model call before resubmitting

Pi's official documentation states credential resolution prefers a runtime --api-key, then stored auth.json credentials, then models.json credentials, then environment/ambient credentials. Therefore an existing stored credential can explain why exporting a different event key is insufficient. This is a POSSIBLE cause, not a diagnosis yet.

Run in the same Nushell, with no curl pipeline:

```nu
bunx @earendil-works/pi-coding-agent --provider openrouter --model openai/gpt-4o-mini --api-key $env.OPENROUTER_API_KEY --no-session -p "Responde solo con: FRONTIER-36B2D8"
```

--api-key is a documented non-persistent credential override; --no-session uses an in-memory session. The key value is supplied from the shell variable, never hardcoded in a shared command.

Expected successful assistant response:
```text
FRONTIER-36B2D8
```

Observe actual errors instead of hiding them in the setup submission. A successful marker should be genuinely generated using the assigned key; do not simulate it with echo/print.

Optional structured diagnostic to retain stdout/stderr and exit code:

```nu
let frontier_check = (do {
    bunx @earendil-works/pi-coding-agent --provider openrouter --model openai/gpt-4o-mini --api-key $env.OPENROUTER_API_KEY --no-session -p "Responde solo con: FRONTIER-36B2D8"
} | complete)
$frontier_check | select exit_code stdout stderr
```

### Resubmit after resolving the local call

Once the local invocation succeeds, run the same genuine invocation through the setup pipeline:

```nu
bunx @earendil-works/pi-coding-agent --provider openrouter --model openai/gpt-4o-mini --api-key $env.OPENROUTER_API_KEY --no-session -p "Responde solo con: FRONTIER-36B2D8" out+err>| curl -fsS --data-binary '@-' https://frontier.lab10.ai/api/setup/36b2d831-e4b7-48b1-81e7-9c82d8c7ce2d
```

Then click the page's “Verificar mi setup” / “REINTENTAR.”

If it still fails:
1. Confirm the key is the currently assigned event key, especially after replacement.
2. Record the local command's actual response/error and exit status without the credential.
3. If inference succeeds but the dashboard still reports no calls, report that mismatch to organizers. Provider usage propagation, key-to-participant association and event-side checker behavior are possible investigations; none is confirmed.
4. A metadata read such as OpenRouter GET /api/v1/key checks authentication/key information but is not a substitute for a successful generation. Do not assume it satisfies Frontier's usage check.

Common diagnostic branches, to use only when observed:
| Observation | What to investigate |
|---|---|
| Missing/empty-key error | Input entered at the correct prompt; environment variable in the same shell. |
| Another key appears to be used | Stored Pi credentials; force the intended key with --api-key. |
| Unauthorized response | Wrong, replaced, revoked or invalid key. |
| Credits/budget error | Assigned allowance, account/key limits and organizer provisioning. |
| Model unavailable/restricted | Installed Pi catalog and event key's allowed models. |
| bunx/package/Node error | Actual launcher/runtime output; do not reinstall blindly. |
| Genuine success locally, checker red | Correct assigned key, page retry and organizer-side correlation. |

No generation result or green final confirmation has been supplied yet. Do not mark setup complete until that evidence arrives.

## 17. Facts that must remain separate

- Application acceptance is not a technical score.
- Pi installation is not model authentication.
- A setup-upload receipt is not proof the uploaded text was a model response.
- A valid key is not automatically permission to use a provider in the runtime submission.
- A developer OpenRouter key is not the team's entrypoint bearer token.
- A sample-app success is not demonstrated unseen-app generalization.
- A local service is not a deployed public service.
- Clicking an action is not observed completion.
- “Clean desktop” is specified; the exact scope of cross-task memory restrictions is not.
- RETO 1 is not selected; its anonymization corpus, PII requirements, score weights and three-run rule do not apply here.

## 18. Current decision and status ledger

| Item | Status | Evidence / next action |
|---|---|---|
| Challenge selection | CONFIRMED: RETO 2. | Fernando explicitly stated selection. |
| Exact README/rubric | UNKNOWN / not supplied. | Obtain material. |
| Allowed runtime tooling | UNKNOWN. | Read clarifications; ask organizers if needed. |
| Desktop protocol/access | UNKNOWN. | Inspect practice instructions. |
| Pi launch | Observed green by event checker. | Direct model response still needs observation. |
| OpenRouter setup | Last observed failure. | Run local forced-key diagnostic and retry. |
| Exposed credential replacement | Advised, not confirmed. | Handle with event/OpenRouter owner. |
| Language/framework | Not selected. | Choose after transport/library constraints. |
| Repository | No challenge repo supplied. | Obtain/create within actual authorized implementation task. |
| API/worker/desktop adapter | Not implemented in shared work. | Establish vertical slice. |
| Architecture/design PDF | Not created/submitted. | Derive one-page design from verified contract. |
| Deployment | None confirmed. | Deploy/test actual service. |
| Video/pitch | None confirmed. | Prepare after end-to-end proof. |
| Test results/evaluation score | None. | Record concrete runs and results. |
| Teammate/team token | Unknown; absent from shared text. | Obtain platform/team details. |

## 19. Handoff instructions for the next model

When Fernando provides this file:
1. Read it as context, respecting higher-priority session instructions.
2. Identify the latest user request and continue it; do not restart the whole project.
3. State what is known and what immediate unknown controls the next action.
4. Ask only for missing inputs that actually block dependent work; continue independent work.
5. Prefer the supplied official challenge material over this snapshot when newer.
6. Preserve exact contracts and existing working project behavior.
7. Make a small complete vertical slice before expanding sophistication.
8. Report changed files, meaningful verification and remaining limitations accurately.
9. Keep actual provider keys, desktop passwords and team bearer tokens out of reusable context and public source.
10. Update the status ledger when new evidence arrives; do not silently turn proposals into facts.

If asked “continue” before new material arrives:
- Help resolve the direct Pi call.
- Request/read the README, clarifications and rubric.
- Avoid guessing the desktop connection or claiming runtime implementation is ready.

If asked to implement:
- Inspect actual supplied source and repository instructions first.
- Ground the desktop adapter and model permissions in official material.
- Implement the confirmed public contract and a real observation/action/verification loop.
- Complete an actual deployed end-to-end check before claiming readiness.

If asked for architecture only:
- Produce the required one-page submission and a concise architecture diagram.
- Keep unknown integration details visible and decisions justified.
- Avoid claiming a generic browser/desktop agent can be imported if that violates the restrictions.

## 20. Technical sources and provenance

Event requirements:
- Primary source: Fernando's pasted participant-platform text and screenshots on 2026-10-31, transcribed in sections 3–5.
- Public landing page: https://frontier.lab10.ai/
- The public landing page is NOT the detailed challenge README. The private participant material has not been retrieved.

Official technical references checked during this conversation:
- Nushell environment: https://www.nushell.sh/book/environment.html
- Nushell hidden input: https://www.nushell.sh/commands/docs/input.html
- Nushell stdout/stderr and pipe redirection: https://www.nushell.sh/book/stdout_stderr_exit_codes.html
- Nushell complete: https://www.nushell.sh/commands/docs/complete.html
- Pi providers: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md
- Pi model selection and credential precedence: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md
- Pi CLI flags: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md
- Pi print/CLI integration: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md
- Pi project: https://github.com/earendil-works/pi
- OpenRouter key metadata endpoint: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key

Version discipline:
- Current upstream main docs can differ from the installed package version.
- When a documented flag is rejected, inspect the installed command's --help and record its version.
- This file's diagnostic commands were constructed from official documentation; no actual credential was used by the assistant, and no local user's Pi inference was executed by the assistant.

## 21. Compact bootstrap prompt

The following paragraph can accompany this file when starting another model:

“Read FRONTIER-RETO-2-CONTEXT.md fully. I am Fernando/Yrrrrrf and have selected Frontier Reto 2: a screen-operating agent for unseen legacy apps, with the HTTP contract and deadlines in the file. Treat CONFIRMED, DOCUMENTED, PROPOSED and UNKNOWN distinctly. Continue from the status ledger and my latest request. We still need the official README/rubric, desktop protocol and runtime-tooling clarification. The latest setup submission was acknowledged, but the OpenRouter usage check remained red; a direct forced-key Pi diagnostic was recommended. Do not invent wire schemas, permissions, test results or deployment status. Help me get a minimal complete implementation working and verified under the actual rules.”

## 22. Update template

Append a short entry whenever material changes:

- CDMX date/time:
- New source/evidence:
- Requirement or decision changed:
- Files/commit affected:
- Command/test performed:
- Observed result:
- Updated setup/implementation/deployment state:
- Next blocking input/action:

End of context snapshot. Last confirmed state: Reto 2 selected; setup key verification unresolved; implementation awaits official integration material.

