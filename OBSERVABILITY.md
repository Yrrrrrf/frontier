# FRONTIER AGENT — TRACE THE JOINTS

Purpose: make failures answer **“which boundary broke, on which task/iteration, after how long, and what was the last confirmed effect?”** This is an instrumentation plan, not another validation suite and not a claim that tracing is already implemented.

## 1. One trace per task

Use one small structured event stream per `task_id`. Correlate events with:

```ts
type TraceEvent = {
  taskId: string;
  iteration: number;
  event: string;
  atMs: number;             // performance.now(); same monotonic clock as the deadline
  durationMs?: number;
  frameId?: string;
  actionId?: string;
  status: "started" | "ok" | "rejected" | "failed";
  details?: Record<string, unknown>; // small, sanitized, predefined fields only
};
```

Keep `run_id`, model tag/settings, server version and viewport in run metadata. Use wall-clock timestamps only for report metadata; calculate budgets and durations with the monotonic clock.

Start with a bounded in-memory buffer plus one sanitized JSONL report per task. Do not add a monitoring service yet. Store screenshots as files and reference their path/hash; never place base64 images, passwords, Bearer tokens or full sensitive responses in events.

## 2. The important joints

### A. HTTP request → registered task

Events:

- `http.received`
- `auth.checked`
- `request.validated`
- `task.registered`
- `task.accepted`

Measure authentication/body parsing/registration separately and total **POST acceptance latency**. Record the deadline established at reception. A slow browser or Ollama call must appear in background execution, never in POST latency.

Failure questions answered: wrong DTO, bad token, task not registered, or acceptance over two seconds?

### B. Registered task → desktop session

Events:

- `runner.started`
- `desktop.connect.started`
- `desktop.login.ok`
- `desktop.session.ready`
- `desktop.closed`

Measure connection, authentication and first usable frame separately. Record viewer/driver type and session ID, never the password.

Failure questions answered: network, viewer login, browser runtime, VNC session, or initialization timeout?

### C. Desktop session → trustworthy frame

Events:

- `capture.started`
- `capture.ok`
- `capture.rejected`

Record `frameId`, actual width/height, capture latency and a short image hash. Optionally record a pixel-change ratio against the previous frame.

Failure questions answered: stale/blank image, wrong dimensions, noVNC overlays, capture failure, or unchanged screen after an action?

### D. Frame + goal → Ollama response

Events:

- `inference.queued`
- `inference.started`
- `inference.response`
- `inference.failed`

Record requested/reported model, timeout remaining, image hash, cold/warm/contended condition, elapsed time, `load_duration`, prompt evaluation, generation duration and token counts. Sample `ollama ps`/VRAM outside the inference critical path when needed.

Failure questions answered: daemon unavailable, model missing, request timeout, GPU contention, slow load, slow prompt processing, or slow generation?

### E. Raw model response → proposed action

Events:

- `response.parsed`
- `action.proposed`
- `action.rejected`

Record content length, parse/schema error code, action kind and coordinates; retain only a bounded sanitized diagnostic snippet on failure.

Failure questions answered: invalid envelope, malformed JSON, truncated output, unknown kind, extra fields, non-integer/out-of-bounds coordinates, or a valid but semantically wrong target?

Keep these categories separate: **valid JSON is not visual correctness**.

### F. Proposed action → authorized side effect

Events:

- `guard.started`
- `guard.ok`
- `guard.rejected`
- `side_effect.before`

Check and record current task state, remaining budget, expected/current `frameId`, coordinate transformation and destination bounds. `side_effect.before` is the final checkpoint before a click/write.

Failure questions answered: stale frame, late inference, expired task, terminal task reopened, bad geometry, or invalid target?

There must be no `input.executed` without a preceding successful guard and `side_effect.before` for the same `actionId`.

### G. Controller input → visible effect

Events:

- `input.executed`
- `repaint.waited`
- `effect.observed`
- `effect.unknown`

Record action/wait latency, the new frame ID/hash and pixel-change information. Keep three claims distinct:

1. Input was sent.
2. The screen changed.
3. The requested application effect was verified.

Failure questions answered: click ignored, coordinate missed, insufficient hold/wait, unexpected dialog, browser disconnect, or visible but wrong effect?

### H. Observations → completion or failure

Events:

- `closure.proposed`
- `closure.verified`
- `task.terminal`
- `late_result.discarded`
- `cleanup.ok`

Record the objective evidence used, final state, summary length, secret-redaction result, total duration, iteration count and cleanup outcome. Once terminal, any later proposal must produce `late_result.discarded` and no input event.

Failure questions answered: model falsely claimed success, verification failed, deadline expired, summary leaked sensitive data, session did not close, or late work touched the next task?

## 3. Minimal event sequence for the next real click

A healthy Comercial smoke run should look conceptually like:

```text
task.registered
desktop.session.ready             + session time
capture.ok                        frame=A
inference.response                + model stages
action.proposed                   click(x,y), frame=A
guard.ok                          remaining budget
side_effect.before                action=N
input.executed                    action=N
repaint.waited                    + 1 s
capture.ok                        frame=B
effect.observed                   A → B, visible menu evidence
task.terminal
cleanup.ok
```

The first missing or failed event localizes the investigation immediately. Do not restart the whole pipeline blindly when only one boundary is broken.

## 4. Per-iteration and per-task timings

Record these durations explicitly:

- `accept_ms`: HTTP reception → ID response.
- `session_ms`: runner start → first usable frame.
- `capture_ms`: capture start → validated frame.
- `inference_ms`: Ollama request start → parsed envelope.
- `guard_ms`: proposal → side-effect authorization.
- `input_ms`: mouse/key start → input completion.
- `effect_ms`: input completion → new observation.
- `iteration_ms`: capture start → next capture/terminal decision.
- `task_ms`: request reception → terminal state.
- `cleanup_ms`: terminal decision → resources released.

Also count iterations, inference calls, retries, invalid proposals, wrong clicks, repeated frames and late responses. Reserve remaining-budget snapshots at every blocking operation; retries must never reset the five-minute deadline.

## 5. Performance evidence without misleading numbers

After functional tracing works, run controlled comparisons on identical real frames/tasks:

- Separate initial model load from warm inference.
- Record sample size, model digest/settings, image dimensions and GPU contention.
- Report p50/p95 only with the sample count; small smoke runs remain descriptive.
- Compare successful-task rate and false completions alongside latency. A faster wrong click is not an improvement.
- Track end-to-end task time and deadline compliance, not only tokens/second.
- Measure sequential model candidates in an uncontended window where possible; do not kill another worker's model to manufacture a cold run.

Useful first comparisons: 2B versus a justified alternative, prompt/history size, image geometry, and wait/retry policy. Change one variable at a time.

## 6. Failure-indexed report

Each terminal report should expose a compact summary:

```text
task / run / final state
last confirmed stage
first failed or rejected stage
last successful frame/action
total and per-stage timings
retry/invalid-action/late-response counts
sanitized error code and smallest next investigation
evidence paths
```

This makes monitoring useful during development: transport teams inspect session/capture events, vision work inspects inference/parse/grounding events, and runner work inspects guard/effect/closure events. The boundaries remain observable without coupling the components together.

## 7. Smallest implementation step later

Add one `TraceSink` consumed by the existing HTTP service, desktop driver, vision adapter and future TaskRunner. Start with the event names above and JSONL output under ignored `client/apps/r2/server/artifacts/traces/`. Instrument the real Comercial click first; add dashboards, metrics servers or distributed tracing only if the local reports demonstrate a need.
