# FRONTIER AGENT — TRACE THE JOINTS

**Status: implemented as a local development observability slice.** The system records sanitized per-task traces and displays them in the r2 dashboard. This is not a monitoring service, proof of real desktop execution, or a replacement for task validation.

Purpose: make failures answer **“which boundary broke, on which task/iteration, after how long, and what was the last confirmed effect?”**

## 1. Current implementation

| Component | Current responsibility |
| --- | --- |
| `client/apps/r2/server/src/trace.ts` | `TraceSink`, bounded memory, sanitization, JSONL persistence, and task summaries |
| `client/apps/r2/server/src/http.ts` | HTTP/admission events and authenticated `GET /tasks/{task_id}/trace` |
| `client/apps/r2/server/src/service.ts` | Registration, runner, terminal, late-result, and task-timing events |
| `client/apps/r2/server/src/runner.ts` | Desktop, capture, inference, action/guard, input/effect, closure, and cleanup events |
| `client/sdk/core/src/schemas/frontier.ts` | Read-only trace DTO types, separate from official task result DTOs |
| `client/apps/r2/src/lib/observability.ts` | Authenticated trace loading, URL/payload checks, and display helpers |
| `client/apps/r2/src/routes/+page.svelte` | Live dashboard, polling, timeline, metadata, timings, counters, and errors |

The official `GET /health`, `POST /tasks`, and `GET /tasks/{task_id}` contracts are unchanged. The trace route is an additional authenticated development endpoint.

## 2. Event and metadata model

Each task has one structured event stream. Events use the server's monotonic clock, shared with deadline calculations:

```ts
type TraceEvent = {
  taskId: string;
  iteration: number;
  event: string;
  atMs: number;
  durationMs?: number;
  frameId?: string;
  actionId?: string;
  status: "started" | "ok" | "rejected" | "failed";
  details?: Record<string, unknown>;
};
```

Run metadata includes `taskId`, `runId`, creation time, reception/deadline/acceptance/terminal times, final state, server version, requested model and settings, viewport, event counts, and the local trace-file reference. Wall-clock time is used only for report metadata such as `createdAt` and the dashboard's last-refresh display.

Defaults in `MemoryTraceSink`:

- Up to **500 retained events per task** and **100 in-memory task traces**.
- `eventCount` counts all observed events; `droppedEvents` counts entries evicted from the per-task memory buffer.
- `get()` returns defensive copies so UI consumers cannot mutate the stored trace.
- Persistence is observational and does not block task execution.

## 3. Instrumented boundaries

### A. HTTP request → registered task

Core events:

- `http.received`
- `auth.checked`
- `request.body.parsed`
- `request.validated`
- `task.registered`
- `task.accepted`

The trace records authentication/body/validation/registration timings and total POST acceptance latency. The deadline starts at HTTP reception; desktop and Ollama work remain in background execution.

### B. Registered task → desktop session

Core events:

- `runner.started`
- `runner.failed`
- `desktop.connect.started`
- `desktop.login.ok`
- `desktop.session.ready`
- `desktop.closed`

Connection attempts, driver type, elapsed time, and sanitized failures are recorded without desktop credentials.

### C. Desktop session → trustworthy frame

Core events:

- `capture.started`
- `capture.ok`
- `capture.rejected`

Successful captures include `frameId`, actual dimensions, latency, a short image hash, attempt number, and whether the previous hash repeated. A repeated frame is a signal for investigation, not proof that input failed.

### D. Frame + goal → Ollama response

Core events:

- `inference.queued`
- `inference.started`
- `inference.response`
- `inference.failed`

The runner records attempts, remaining timeout, image hash, requested/reported model, elapsed/load/prompt/generation durations, and token counts when Ollama supplies them. Current traces do not continuously sample GPU/VRAM or independently certify cold/warm/contended conditions.

### E. Raw response → proposed action

Core events:

- `response.parsed`
- `action.proposed`
- `action.rejected`

Failures distinguish invalid envelopes from invalid actions. Diagnostics are bounded and sanitized. **Valid JSON is not visual correctness.**

### F. Proposed action → authorized side effect

Core events:

- `guard.started`
- `guard.ok`
- `guard.rejected`
- `side_effect.before`

The runner correlates `actionId` and source `frameId`, checks task activity/budget, reobserves the desktop, compares frame hash and geometry, and records the final checkpoint before input. An uncertain or stale proposal is not executed blindly.

### G. Controller input → visible effect

Core events:

- `input.executed`
- `repaint.waited`
- `effect.observed`
- `effect.unknown`

These claims remain distinct:

1. Input was sent, rejected, or its application became uncertain.
2. The post-frame hash changed.
3. A separate visual proposal verified the requested postcondition.

A trace event alone never proves the third claim; the next real acceptance run must retain actual before/after evidence.

### H. Completion, failure, and cleanup

Core events:

- `closure.proposed`
- `closure.verified`
- `iteration.completed`
- `task.terminal`
- `late_result.discarded`
- `cleanup.ok`
- `cleanup.failed`

Terminal metadata includes final state, total monotonic task duration, summary length, and redaction status. A terminal result cannot be reopened by late work or cleanup.

## 4. Dashboard and authenticated reads

Open the r2 app, then enter:

- Agent URL, default `http://127.0.0.1:3000`.
- Team Bearer token.
- Existing task ID returned by `POST /tasks`.

The dashboard requests `GET /tasks/{task_id}/trace` with the same Bearer credential and polls every 1.2 seconds while the task is open. Polling stops at a terminal state; manual refresh remains available. Credentials are held only in component memory and are not written to URLs, `localStorage`, or `sessionStorage`.

The dashboard exposes:

- Current/terminal state and observed task duration.
- Last confirmed stage and first failed/rejected boundary.
- Newest-first event timeline with iteration, offset, duration, frame/action IDs, and expandable sanitized details.
- Inference calls, retries, invalid proposals, repeated frames, late responses, and input/output tokens.
- Run/model/viewport/server metadata, per-event durations, and evidence paths.
- Explicit loading, refresh, unauthorized, not-found, malformed-payload, and network/CORS errors.

The displayed duration is reception-to-terminal for closed tasks and reception-to-latest-event for open tasks. The UI does not invent a completion percentage.

## 5. Persistence and redaction

With the production `main.ts` composition, each task writes sanitized JSONL under:

```text
client/apps/r2/server/artifacts/traces/
```

Filenames contain a truncated SHA-256 hash of the task ID, not desktop information. The artifact directory is ignored by Git. Traces are in-memory for API reads; server restart does not reload JSONL into the task service, and there is no trace-list/search service.

Protection currently includes:

- Per-task registration of desktop password and desktop URL without storing those values in metadata.
- Replacement of registered secrets before event persistence.
- Bearer-token and URL redaction, sensitive-key removal, bounded strings/collections, and bounded diagnostic details.
- No screenshot bytes or base64 image fields in trace events.

Evidence paths are references only. Current runner captures are used in memory; real before/after screenshot evidence remains part of the next acceptance gate.

## 6. Browser CORS

The dashboard uses direct authenticated browser requests. The Node server responds to CORS only for explicitly configured origins. Defaults cover localhost and 127.0.0.1 on ports 5173 and 4173. Another deployment must set:

```sh
FRONTIER_UI_ORIGINS=https://r2.example.com
```

Multiple origins are comma-separated. Preflight requests from unlisted origins receive 403, and actual task/trace routes still require Bearer authentication.

## 7. Expected sequence for the next real click

A healthy Comercial smoke run should contain the relevant subsequence:

```text
task.registered
desktop.session.ready
capture.ok                        frame=A
inference.response
action.proposed                   click(x,y), frame=A
guard.ok
side_effect.before                action=N
input.executed                    action=N
repaint.waited
capture.ok                        frame=B
effect.observed                   A → B; screen changed
closure.verified                 separate visual postcondition check
task.terminal
cleanup.ok
```

The first missing/failed boundary localizes investigation. This sequence is currently a **validation target**, not a claim that a real click has already run.

## 8. Current validation and limits

Current local evidence:

- Server TypeScript and **30/30 Node tests PASS**, including trace redaction, bounds, JSONL, authenticated reads, CORS, lifecycle, runner, and Ollama transport behavior.
- Client `just cycle` PASS, including r2 helper tests, type checks, lint, and production build.
- Real desktop click, full task execution, E1, deployment, and unseen-app generalization remain **NOT_RUN**.

Do not add dashboards, distributed tracing, percentile performance claims, or monitoring infrastructure as a substitute for that real acceptance evidence. After a real run works, compare identical frames/tasks one variable at a time and report sample counts alongside latency and successful-task/false-completion rates.
