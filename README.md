# Frontier

Frontier Reto 2 prototype: a Node/TypeScript desktop agent with noVNC transport, local Ollama vision, guarded multi-step click execution and modal recovery, sanitized task tracing, and a live Svelte observability dashboard.

## Current layout

- `client/apps/r2/` — main r2 dashboard and standalone agent server.
- `client/apps/r2/server/` — official HTTP contract, task lifecycle, runner, noVNC, Ollama, and traces.
- `client/sdk/` — shared official DTOs, typed API client, and read-only observability types.
- `reto-2/README.md` — official challenge contract; it takes precedence over project notes.

## Documentation

- `CURRENT-CONTEXT.md` — exact implementation handoff and remaining acceptance gate.
- `VALIDATION.md` — local checks, real desktop/vision probes, and dashboard startup.
- `OBSERVABILITY.md` — trace model, event boundaries, dashboard, CORS, persistence, and redaction.
- `FRONTIER-FALLBACKS-IMPLEMENTATION.md` — implemented readiness/deadline/Ollama/runner fallbacks and pending real acceptance.

## Validation

```sh
cd client/apps/r2/server
npm install
npm run validate

cd ../../..
just cycle
```

Current local results: **34/34 server tests PASS** and the complete client cycle PASS. Real desktop click, full task execution, and E1 remain **NOT_RUN**; see the handoff documents before treating the prototype as a complete agent.
