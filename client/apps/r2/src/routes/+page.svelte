<script lang="ts">
import { onDestroy } from "svelte";
import type { TaskState, TaskTrace, TraceEvent } from "@sdk/core";
import faviconUrl from "#lib/assets/img/svelte.svg";
import {
  detailJson,
  eventOffset,
  fetchTaskTrace,
  formatDuration,
  formatNumber,
  observedDuration,
  shortId,
  stageLabel,
  TraceRequestError,
} from "#lib/observability";

let agentUrl = $state("http://127.0.0.1:3000");
let token = $state("");
let taskId = $state("");
let autoPoll = $state(true);
let trace = $state<TaskTrace | undefined>();
let loading = $state(false);
let refreshing = $state(false);
let error = $state("");
let lastUpdated = $state<Date | undefined>();
let viewingTaskId = $state("");

let pollTimer: ReturnType<typeof setTimeout> | undefined;
let activeController: AbortController | undefined;
let requestSerial = 0;

let state = $derived<TaskState>(trace?.summary.finalState ?? "en_curso");
let eventsNewestFirst = $derived([...(trace?.events ?? [])].reverse());
let stageDurations = $derived(
  Object.entries(trace?.summary.stageDurationsMs ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10),
);
let maxStageDuration = $derived(Math.max(1, ...stageDurations.map(([, duration]) => duration)));
let latestEvent = $derived(trace?.events.at(-1));
let isTerminal = $derived(state !== "en_curso");

function clearPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
}

function schedulePoll() {
  clearPoll();
  if (!autoPoll || !trace || isTerminal) return;
  pollTimer = setTimeout(() => void refresh(true), 1_200);
}

async function refresh(background = false) {
  clearPoll();
  const serial = ++requestSerial;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  if (trace) refreshing = true;
  else loading = true;
  if (!background) error = "";

  try {
    const next = await fetchTaskTrace({
      agentUrl,
      token,
      taskId,
      signal: controller.signal,
    });
    if (serial !== requestSerial) return;
    trace = next;
    viewingTaskId = next.metadata.taskId;
    lastUpdated = new Date();
    error = "";
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") return;
    if (serial !== requestSerial) return;
    error = caught instanceof TraceRequestError
      ? caught.message
      : "The trace could not be loaded.";
  } finally {
    if (serial === requestSerial) {
      loading = false;
      refreshing = false;
      schedulePoll();
    }
  }
}

function connect() {
  activeController?.abort();
  clearPoll();
  requestSerial++;
  trace = undefined;
  lastUpdated = undefined;
  viewingTaskId = "";
  loading = false;
  refreshing = false;
  void refresh();
}

function togglePolling() {
  clearPoll();
  if (autoPoll && trace && !isTerminal) void refresh(true);
}

function statusText(value: TaskState): string {
  if (value === "terminada") return "Completed";
  if (value === "fallida") return "Failed";
  return "In progress";
}

function eventSymbol(event: TraceEvent): string {
  if (event.status === "ok") return "✓";
  if (event.status === "failed") return "×";
  if (event.status === "rejected") return "!";
  return "·";
}

onDestroy(() => {
  clearPoll();
  activeController?.abort();
  requestSerial++;
});
</script>

<svelte:head>
  <title>Frontier · Agent observability</title>
  <link rel="icon" href={faviconUrl} />
  <meta name="description" content="Live, sanitized visibility into Frontier agent task boundaries." />
</svelte:head>

<div class="observer-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Frontier observability home">
      <span class="brand-mark" aria-hidden="true">F</span>
      <span>
        <strong>FRONTIER</strong>
        <small>AGENT OBSERVER</small>
      </span>
    </a>
    <div class="environment-badge"><span></span> Development · local traces</div>
  </header>

  <main>
    <section class="intro">
      <div>
        <p class="eyebrow">RETO 2 / R2</p>
        <h1>Trace every boundary.<br /><span>Trust only observed effects.</span></h1>
        <p class="intro-copy">
          Follow a task from HTTP admission to desktop input and cleanup. Model proposals,
          screen changes, and verified outcomes remain deliberately distinct.
        </p>
      </div>
      <div class="principle-card">
        <span class="principle-index">01</span>
        <p>Input sent</p>
        <span class="principle-arrow">≠</span>
        <p>Screen changed</p>
        <span class="principle-arrow">≠</span>
        <p>Goal verified</p>
      </div>
    </section>

    <section class="connection-panel" aria-labelledby="connection-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">CONNECTION</p>
          <h2 id="connection-title">Inspect a task</h2>
        </div>
        <span class="session-note">Session-only credentials</span>
      </div>
      <form onsubmit={(event) => { event.preventDefault(); connect(); }}>
        <label class="field agent-field">
          <span>Agent URL</span>
          <input bind:value={agentUrl} type="url" required placeholder="http://127.0.0.1:3000" autocomplete="url" />
        </label>
        <label class="field token-field">
          <span>Team Bearer token</span>
          <input bind:value={token} type="password" required placeholder="Not stored" autocomplete="off" />
        </label>
        <label class="field task-field">
          <span>Task ID</span>
          <input bind:value={taskId} required placeholder="Paste the POST /tasks response ID" autocomplete="off" />
        </label>
        <button class="primary-button" type="submit" disabled={loading}>
          {loading ? "Connecting…" : "Inspect trace"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
      <div class="connection-footer">
        <p>Create work through the official API, then paste its returned task ID here.</p>
        <label class="poll-toggle">
          <input type="checkbox" bind:checked={autoPoll} onchange={togglePolling} />
          <span>Live polling</span>
        </label>
      </div>
    </section>

    {#if error}
      <div class="error-banner" role="alert">
        <span class="error-icon">!</span>
        <div>
          <strong>{trace ? "Refresh failed · showing the last snapshot" : "Trace unavailable"}</strong>
          <p>{error}</p>
        </div>
        {#if trace}<button type="button" onclick={() => void refresh()}>Retry</button>{/if}
      </div>
    {/if}

    {#if loading && !trace}
      <section class="loading-state" aria-live="polite">
        <span class="loader"></span>
        <h2>Opening the task trace</h2>
        <p>Authenticating and reading the latest sanitized snapshot…</p>
      </section>
    {:else if trace}
      <section class="task-overview" aria-live="polite">
        <div class="overview-main">
          <div class="task-kicker">
            <span class={`status-pill ${state}`}><i></i>{statusText(state)}</span>
            <span class="task-id">TASK <code title={viewingTaskId}>{shortId(viewingTaskId, 16)}</code></span>
          </div>
          <h2>{stageLabel(trace.summary.lastConfirmedStage)}</h2>
          <p class="latest-event">
            Latest event: <strong>{latestEvent?.event ?? "none"}</strong>
            {#if refreshing}<span class="refreshing">refreshing…</span>{/if}
          </p>
        </div>
        <div class="overview-actions">
          <button type="button" class="secondary-button" onclick={() => void refresh()} disabled={refreshing}>Refresh snapshot</button>
          <small>
            {#if lastUpdated}Updated {lastUpdated.toLocaleTimeString()} · {/if}
            {isTerminal ? "terminal · polling stopped" : autoPoll ? "polling every 1.2 s" : "manual refresh"}
          </small>
        </div>
      </section>

      {#if trace.summary.firstFailure}
        <section class="failure-card">
          <div>
            <p class="eyebrow">FIRST FAILED / REJECTED BOUNDARY</p>
            <h3>{stageLabel(trace.summary.firstFailure.event)}</h3>
            <p>{trace.summary.firstFailure.error ?? trace.summary.firstFailure.status}</p>
          </div>
          <span>iteration {trace.summary.firstFailure.iteration} · +{formatDuration(trace.summary.firstFailure.atMs - trace.metadata.receivedAtMs)}</span>
        </section>
      {/if}

      <section class="metric-grid" aria-label="Task metrics">
        <article><span>Observed task time</span><strong>{formatDuration(observedDuration(trace))}</strong><small>{isTerminal ? "reception → terminal" : "reception → latest event"}</small></article>
        <article><span>Events</span><strong>{formatNumber(trace.metadata.eventCount)}</strong><small>{trace.metadata.droppedEvents ? `${trace.metadata.droppedEvents} dropped from memory` : "bounded event stream"}</small></article>
        <article><span>Iterations</span><strong>{formatNumber(trace.summary.counters.iterations)}</strong><small>{trace.summary.counters.retries} retries</small></article>
        <article><span>Inference calls</span><strong>{formatNumber(trace.summary.counters.inferenceCalls)}</strong><small>{trace.summary.counters.invalidProposals} invalid proposals</small></article>
        <article><span>Model tokens</span><strong>{formatNumber(trace.summary.counters.inputTokens + trace.summary.counters.outputTokens)}</strong><small>{formatNumber(trace.summary.counters.inputTokens)} in · {formatNumber(trace.summary.counters.outputTokens)} out</small></article>
      </section>

      <div class="workspace-grid">
        <section class="timeline-panel">
          <div class="section-heading">
            <div><p class="eyebrow">EVENT STREAM</p><h2>Boundary timeline</h2></div>
            <span>Newest first</span>
          </div>
          {#if eventsNewestFirst.length}
            <ol class="timeline">
              {#each eventsNewestFirst as event, index (`${event.atMs}-${event.event}-${index}`)}
                <li class={`event-row ${event.status}`}>
                  <div class="event-rail"><span>{eventSymbol(event)}</span></div>
                  <div class="event-body">
                    <div class="event-title">
                      <div><strong>{stageLabel(event.event)}</strong><code>{event.event}</code></div>
                      <span>+{formatDuration(eventOffset(trace, event))}</span>
                    </div>
                    <div class="event-meta">
                      <span class={`event-status ${event.status}`}>{event.status}</span>
                      <span>iteration {event.iteration}</span>
                      {#if event.durationMs !== undefined}<span>{formatDuration(event.durationMs)}</span>{/if}
                      {#if event.frameId}<span title={event.frameId}>frame {shortId(event.frameId, 6)}</span>{/if}
                      {#if event.actionId}<span title={event.actionId}>action {shortId(event.actionId, 6)}</span>{/if}
                    </div>
                    {#if event.details && Object.keys(event.details).length}
                      <details>
                        <summary>Sanitized metadata</summary>
                        <pre>{detailJson(event)}</pre>
                      </details>
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
          {:else}
            <div class="inline-empty">No events have been recorded yet.</div>
          {/if}
        </section>

        <aside class="metadata-column">
          <section class="metadata-panel">
            <div class="section-heading"><div><p class="eyebrow">RUN METADATA</p><h2>Execution context</h2></div></div>
            <dl class="metadata-list">
              <div><dt>Run ID</dt><dd><code title={trace.metadata.runId}>{shortId(trace.metadata.runId, 12)}</code></dd></div>
              <div><dt>Model</dt><dd>{trace.metadata.model.requested}</dd></div>
              <div><dt>Settings</dt><dd>temp {trace.metadata.model.temperature} · ctx {formatNumber(trace.metadata.model.numCtx)} · max {trace.metadata.model.numPredict}</dd></div>
              <div><dt>Viewport</dt><dd>{trace.metadata.viewport.width}×{trace.metadata.viewport.height} @ {trace.metadata.viewport.deviceScaleFactor}x</dd></div>
              <div><dt>Task budget</dt><dd>{formatDuration(trace.metadata.deadlineAtMs - trace.metadata.receivedAtMs)}</dd></div>
              <div><dt>Server</dt><dd>v{trace.metadata.serverVersion}</dd></div>
              <div><dt>Created</dt><dd>{new Date(trace.metadata.createdAt).toLocaleString()}</dd></div>
            </dl>
          </section>

          <section class="metadata-panel">
            <div class="section-heading"><div><p class="eyebrow">TIMINGS</p><h2>Stage durations</h2></div></div>
            {#if stageDurations.length}
              <div class="duration-list">
                {#each stageDurations as [stage, duration] (stage)}
                  <div class="duration-row">
                    <div><span title={stage}>{stage}</span><strong>{formatDuration(duration)}</strong></div>
                    <div class="duration-track"><span style={`width: ${Math.max(2, duration / maxStageDuration * 100)}%`}></span></div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="muted">Durations appear as boundaries complete.</p>
            {/if}
          </section>

          <section class="metadata-panel">
            <div class="section-heading"><div><p class="eyebrow">EVIDENCE</p><h2>References</h2></div></div>
            {#if trace.summary.evidence.length}
              <ul class="evidence-list">
                {#each trace.summary.evidence as evidence (evidence)}<li><code>{evidence}</code></li>{/each}
              </ul>
              <p class="muted">Local, ignored artifacts. Paths are not proof of task success.</p>
            {:else}
              <p class="muted">No evidence files have been referenced.</p>
            {/if}
            <div class="correlation-grid">
              <div><span>Last frame</span><code title={trace.summary.lastFrameId}>{shortId(trace.summary.lastFrameId, 10)}</code></div>
              <div><span>Last action</span><code title={trace.summary.lastActionId}>{shortId(trace.summary.lastActionId, 10)}</code></div>
              <div><span>Late responses</span><strong>{trace.summary.counters.lateResponses}</strong></div>
              <div><span>Repeated frames</span><strong>{trace.summary.counters.repeatedFrames}</strong></div>
            </div>
          </section>
        </aside>
      </div>
    {:else if !error}
      <section class="empty-state">
        <div class="empty-diagram" aria-hidden="true"><span>HTTP</span><i></i><span>FRAME</span><i></i><span>ACTION</span><i></i><span>EFFECT</span></div>
        <h2>No task selected</h2>
        <p>Connect to an agent and inspect a task ID to open its live event stream.</p>
        <div class="empty-notes"><span>Authenticated reads</span><span>Sanitized metadata</span><span>No stored tokens</span></div>
      </section>
    {/if}
  </main>

  <footer><span>FRONTIER / OBSERVABILITY</span><p>Traces explain boundaries. They do not replace real desktop validation.</p></footer>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #090d12;
    color: #e8edf2;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  :global(*) { box-sizing: border-box; }
  :global(button), :global(input) { font: inherit; }
  :global(button) { cursor: pointer; }
  :global(code), .eyebrow, .task-id, .event-meta, .environment-badge, footer span {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }
  .observer-shell { min-height: 100vh; background: radial-gradient(circle at 88% 4%, rgba(48, 118, 113, .13), transparent 29rem), #090d12; }
  .topbar { height: 76px; padding: 0 clamp(20px, 4vw, 64px); border-bottom: 1px solid #202831; display: flex; align-items: center; justify-content: space-between; }
  .brand { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 12px; }
  .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #62d4bd; color: #62d4bd; font-weight: 800; font-size: 18px; }
  .brand strong { display: block; letter-spacing: .18em; font-size: 13px; }
  .brand small { display: block; color: #7e8b97; letter-spacing: .16em; font-size: 8px; margin-top: 3px; }
  .environment-badge { color: #98a5af; font-size: 10px; letter-spacing: .04em; display: flex; align-items: center; gap: 8px; }
  .environment-badge span { width: 6px; height: 6px; border-radius: 50%; background: #62d4bd; box-shadow: 0 0 12px #62d4bd; }
  main { width: min(1500px, calc(100% - 40px)); margin: 0 auto; padding: 58px 0 72px; }
  .intro { display: grid; grid-template-columns: 1.35fr .65fr; align-items: end; gap: 48px; margin-bottom: 42px; }
  .eyebrow { color: #62d4bd; font-size: 10px; letter-spacing: .16em; margin: 0 0 12px; font-weight: 700; }
  h1 { font-size: clamp(34px, 4.5vw, 64px); letter-spacing: -.045em; line-height: 1.03; font-weight: 650; margin: 0; }
  h1 span { color: #75828d; }
  .intro-copy { color: #8e9aa5; max-width: 680px; line-height: 1.65; font-size: 14px; margin: 22px 0 0; }
  .principle-card { border: 1px solid #25303a; padding: 22px; display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; background: rgba(15, 22, 28, .7); }
  .principle-card p { margin: 0; color: #c7d0d7; font-size: 12px; }
  .principle-index { grid-row: span 5; color: #42505b; font: 11px "SFMono-Regular", monospace; }
  .principle-arrow { color: #4c5b65; font-size: 11px; }
  .connection-panel, .timeline-panel, .metadata-panel { border: 1px solid #232c35; background: #0e141a; }
  .connection-panel { padding: 24px; margin-bottom: 24px; }
  .section-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 22px; }
  .section-heading.compact { margin-bottom: 20px; }
  .section-heading h2 { margin: 0; font-size: 19px; letter-spacing: -.02em; }
  .section-heading .eyebrow { margin-bottom: 7px; }
  .section-heading > span, .session-note { color: #63717d; font-size: 11px; }
  form { display: grid; grid-template-columns: 1.15fr 1fr 1.25fr auto; gap: 12px; align-items: end; }
  .field { display: grid; gap: 8px; }
  .field > span { color: #84919c; font-size: 10px; text-transform: uppercase; letter-spacing: .09em; }
  .field input { min-width: 0; width: 100%; height: 44px; border: 1px solid #2a3540; background: #090e13; color: #e8edf2; padding: 0 13px; outline: none; border-radius: 2px; font-size: 12px; }
  .field input:focus { border-color: #62d4bd; box-shadow: 0 0 0 2px rgba(98, 212, 189, .08); }
  .field input::placeholder { color: #47545f; }
  .primary-button, .secondary-button { border: 0; height: 44px; padding: 0 18px; font-weight: 700; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 18px; }
  .primary-button { background: #62d4bd; color: #07110f; }
  .primary-button:hover { background: #7be4cf; }
  .primary-button:disabled, .secondary-button:disabled { opacity: .5; cursor: wait; }
  .secondary-button { background: #1a242c; border: 1px solid #2d3943; color: #d5dde3; }
  .connection-footer { border-top: 1px solid #1e272f; padding-top: 15px; margin-top: 18px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .connection-footer p { margin: 0; color: #5f6c77; font-size: 11px; }
  .poll-toggle { display: flex; gap: 8px; align-items: center; color: #94a1ab; font-size: 11px; white-space: nowrap; }
  .poll-toggle input { accent-color: #62d4bd; }
  .error-banner { border: 1px solid #6b3d43; background: #211418; padding: 16px 18px; display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
  .error-icon { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid #e77b86; color: #e77b86; }
  .error-banner strong { color: #f1a0a9; font-size: 12px; }
  .error-banner p { color: #c0878e; margin: 4px 0 0; font-size: 12px; }
  .error-banner button { margin-left: auto; border: 1px solid #7d4850; background: transparent; color: #e5a0a8; padding: 7px 12px; }
  .task-overview { border: 1px solid #28343d; background: linear-gradient(110deg, #101920, #0e141a); padding: 26px; display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-bottom: 16px; }
  .task-kicker { display: flex; align-items: center; gap: 14px; margin-bottom: 15px; }
  .status-pill { display: inline-flex; align-items: center; gap: 7px; padding: 6px 9px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
  .status-pill i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .status-pill.en_curso { color: #62d4bd; background: rgba(98, 212, 189, .08); }
  .status-pill.en_curso i { box-shadow: 0 0 9px currentColor; animation: pulse 1.8s infinite; }
  .status-pill.terminada { color: #8fd48e; background: rgba(143, 212, 142, .08); }
  .status-pill.fallida { color: #ef8a94; background: rgba(239, 138, 148, .08); }
  .task-id { color: #596873; font-size: 10px; }
  .task-id code { color: #8e9ca6; margin-left: 6px; }
  .overview-main h2 { font-size: 25px; letter-spacing: -.03em; margin: 0 0 8px; }
  .latest-event { margin: 0; color: #697883; font-size: 11px; }
  .latest-event strong { color: #9ca9b3; font-family: "SFMono-Regular", monospace; font-weight: 400; }
  .refreshing { color: #62d4bd; margin-left: 10px; }
  .overview-actions { display: grid; justify-items: end; gap: 9px; }
  .overview-actions small { color: #5d6c77; font-size: 10px; }
  .failure-card { padding: 18px 22px; border-left: 2px solid #e77b86; background: #171216; display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 16px; }
  .failure-card h3 { margin: 0 0 6px; font-size: 15px; color: #e8c2c6; }
  .failure-card p:not(.eyebrow) { margin: 0; color: #a77980; font-size: 12px; }
  .failure-card > span { color: #815f65; font: 10px "SFMono-Regular", monospace; white-space: nowrap; }
  .metric-grid { display: grid; grid-template-columns: repeat(5, 1fr); border: 1px solid #232c35; margin-bottom: 24px; }
  .metric-grid article { padding: 20px; background: #0e141a; border-right: 1px solid #232c35; min-width: 0; }
  .metric-grid article:last-child { border-right: 0; }
  .metric-grid span { color: #74838e; display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
  .metric-grid strong { display: block; margin: 11px 0 6px; font-size: 25px; font-weight: 550; letter-spacing: -.03em; }
  .metric-grid small { color: #53616c; font-size: 10px; }
  .workspace-grid { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(310px, .75fr); gap: 24px; align-items: start; }
  .timeline-panel { padding: 24px; }
  .timeline { list-style: none; padding: 0; margin: 0; }
  .event-row { display: grid; grid-template-columns: 28px minmax(0, 1fr); }
  .event-rail { position: relative; display: flex; justify-content: center; }
  .event-rail::after { content: ""; position: absolute; top: 29px; bottom: -1px; width: 1px; background: #25303a; }
  .event-row:last-child .event-rail::after { display: none; }
  .event-rail span { position: relative; z-index: 1; width: 21px; height: 21px; display: grid; place-items: center; border: 1px solid #34414b; background: #111920; color: #7d8c97; font-size: 11px; }
  .event-row.ok .event-rail span { border-color: #397b6d; color: #62d4bd; }
  .event-row.failed .event-rail span, .event-row.rejected .event-rail span { border-color: #8c4e57; color: #ef8a94; }
  .event-body { padding: 0 0 25px 10px; min-width: 0; }
  .event-title { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .event-title strong { display: block; font-size: 13px; font-weight: 600; }
  .event-title code { display: block; color: #566570; font-size: 9px; margin-top: 4px; }
  .event-title > span { color: #657580; font: 10px "SFMono-Regular", monospace; white-space: nowrap; }
  .event-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; color: #5c6b76; font-size: 9px; margin-top: 9px; }
  .event-status { text-transform: uppercase; }
  .event-status.ok { color: #62d4bd; }
  .event-status.failed, .event-status.rejected { color: #ef8a94; }
  details { margin-top: 11px; }
  summary { color: #6f7f8a; cursor: pointer; font-size: 10px; }
  pre { max-height: 280px; overflow: auto; background: #090e13; border: 1px solid #202a33; color: #94a7b1; padding: 12px; font-size: 10px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .metadata-column { display: grid; gap: 20px; }
  .metadata-panel { padding: 22px; }
  .metadata-list { margin: 0; }
  .metadata-list > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid #1d262e; font-size: 11px; }
  .metadata-list > div:last-child { border-bottom: 0; padding-bottom: 0; }
  .metadata-list dt { color: #64737e; }
  .metadata-list dd { margin: 0; color: #adb8c0; text-align: right; overflow-wrap: anywhere; }
  .metadata-list code { color: #9eacb6; }
  .duration-list { display: grid; gap: 13px; }
  .duration-row > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; }
  .duration-row span { color: #71808b; overflow: hidden; text-overflow: ellipsis; }
  .duration-row strong { color: #adb8c0; font-weight: 500; white-space: nowrap; }
  .duration-track { height: 2px; background: #202b33; margin-top: 7px; }
  .duration-track span { display: block; height: 100%; background: #4ba18f; }
  .muted { color: #5e6c77; font-size: 11px; line-height: 1.55; }
  .evidence-list { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 7px; }
  .evidence-list code { color: #93a3ad; font-size: 10px; overflow-wrap: anywhere; }
  .correlation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; border-top: 1px solid #202932; padding-top: 17px; margin-top: 18px; }
  .correlation-grid div { display: grid; gap: 5px; }
  .correlation-grid span { color: #5d6c77; font-size: 9px; text-transform: uppercase; }
  .correlation-grid code, .correlation-grid strong { color: #a8b5be; font-size: 11px; font-weight: 500; }
  .empty-state, .loading-state { border: 1px dashed #2b3740; min-height: 340px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px; }
  .empty-state h2, .loading-state h2 { margin: 28px 0 8px; font-size: 20px; }
  .empty-state > p, .loading-state p { color: #63727d; font-size: 12px; }
  .empty-diagram { display: flex; align-items: center; gap: 12px; color: #6e7e89; font: 9px "SFMono-Regular", monospace; }
  .empty-diagram span { border: 1px solid #2b3740; padding: 9px; }
  .empty-diagram i { width: 18px; height: 1px; background: #34434d; }
  .empty-notes { display: flex; gap: 18px; margin-top: 25px; color: #4e5d68; font-size: 10px; }
  .loader { width: 26px; height: 26px; border: 2px solid #26353d; border-top-color: #62d4bd; border-radius: 50%; animation: spin .8s linear infinite; }
  .inline-empty { color: #5e6c77; padding: 30px; text-align: center; }
  footer { border-top: 1px solid #1c252d; padding: 24px clamp(20px, 4vw, 64px); display: flex; justify-content: space-between; gap: 20px; color: #4f5e69; font-size: 10px; }
  .observer-shell footer p { margin: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { opacity: .35; } }
  @media (max-width: 1100px) {
    form { grid-template-columns: 1fr 1fr; }
    .primary-button { min-height: 44px; }
    .metric-grid { grid-template-columns: repeat(3, 1fr); }
    .metric-grid article:nth-child(3) { border-right: 0; }
    .metric-grid article:nth-child(n+4) { border-top: 1px solid #232c35; }
    .workspace-grid { grid-template-columns: 1fr; }
    .metadata-column { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 760px) {
    main { width: min(100% - 28px, 1500px); padding-top: 36px; }
    .environment-badge { display: none; }
    .intro { grid-template-columns: 1fr; gap: 28px; }
    .principle-card { max-width: 360px; }
    form { grid-template-columns: 1fr; }
    .connection-footer, .task-overview, .failure-card, footer { align-items: flex-start; flex-direction: column; }
    .overview-actions { justify-items: start; }
    .metric-grid { grid-template-columns: 1fr 1fr; }
    .metric-grid article, .metric-grid article:nth-child(3) { border-right: 1px solid #232c35; border-top: 1px solid #232c35; }
    .metric-grid article:nth-child(even) { border-right: 0; }
    .metric-grid article:nth-child(-n+2) { border-top: 0; }
    .metric-grid article:last-child { grid-column: span 2; border-right: 0; }
    .metadata-column { grid-template-columns: 1fr; }
    .empty-diagram { gap: 5px; }
    .empty-diagram i { width: 8px; }
    .empty-notes { flex-direction: column; gap: 6px; }
  }
</style>
