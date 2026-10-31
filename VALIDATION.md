# CURRENT VALIDATION GUIDE

Run from the real repository. Use environment variables for credentials; do not paste secrets into source or committed reports.

## Fast checks

```sh
cd client/apps/r2/server
npm install
npm run validate
```

This runs TypeScript checks and 30 Node tests covering the HTTP contract, readiness, task lifecycle/deadlines, runner guards, Ollama transport/envelope handling, and trace sanitization/bounds/persistence/CORS. Injected fetch/runner/desktop tests are mock control-flow evidence only.

```sh
cd client
just cycle
```

This prunes/reprepares the Deno workspace, then runs client tests, formatting/lint/types, and app builds. It does not validate the Node server or real desktop.

## Real noVNC login/capture

Required environment:

- `DESKTOP_URL`: HTTPS noVNC viewer URL.
- `DESKTOP_PASSWORD`: desktop password.
- `CHROMIUM_EXECUTABLE`: optional browser path; required on this NixOS host when using the Nix Chromium wrapper.

```sh
cd client/apps/r2/server
npm run validate:desktop
```

PASS means real authentication succeeded and the raw remote canvas is 1280×800. Evidence is written to ignored `client/apps/r2/server/artifacts/desktop-login.png`.

## Real Ollama vision probe

First ensure Ollama is reachable and `qwen3-vl:2b` is installed. With the same desktop environment plus optional `VISION_MODEL` and `VISION_RUNS` (default 3):

```sh
cd client/apps/r2/server
npm run validate:vision
ollama ps
```

The command performs a fresh real login/capture, asks the model to click Comercial three times, and checks each proposal against an independently marked target rectangle. It does not click. Evidence: `client/apps/r2/server/artifacts/vision-sigecom.png` and `client/apps/r2/server/artifacts/vision-report.json`.

On this NixOS host, run either real validator through the working browser wrapper:

```sh
nix shell nixpkgs#chromium -c bash -c 'export CHROMIUM_EXECUTABLE="$(command -v chromium)"; npm run validate:vision'
```

Set `DESKTOP_URL` and `DESKTOP_PASSWORD` in the calling environment. The command inherits them.

## Local r2 observability

With `TEAM_TOKEN`, local Ollama, and the required Chromium executable configured, start the agent:

```sh
cd client/apps/r2/server
npm start
```

In another terminal, start the r2 app:

```sh
cd client/apps/r2
deno run -A npm:vite --host 127.0.0.1
```

Open the dashboard, enter the agent URL (default `http://127.0.0.1:3000`), team token, and an existing task ID. The app polls authenticated `GET /tasks/{task_id}/trace` snapshots until the task becomes terminal.

The default allowed browser origins are localhost/127.0.0.1 on ports 5173 and 4173. Set comma-separated `FRONTIER_UI_ORIGINS` for another r2 origin. Trace JSONL is written to ignored `client/apps/r2/server/artifacts/traces/`. Tokens are neither persisted by the dashboard nor included in trace metadata.

This validates observability mechanics only. A trace showing a proposed or sent click is not proof of the requested application effect.

## Current results

Local checks during this implementation:

- Server TypeScript and 30/30 Node tests: PASS.
- Client `just cycle`, including r2 tests/type-check/build: PASS.
- Real click, real end-to-end task, and E1: NOT_RUN.

Historical real evidence, not rerun during this implementation:

- Desktop login/capture: PASS.
- Latest vision probe: PASS, 3/3 Comercial hits at `(192,120)`, about 1.1 seconds per warm proposal.
- Ollama placement observed after inference: 100% GPU.

## Next acceptance check

The next real validation must use the composed runner through the public API and show a fresh capture, a valid model proposal, a guarded click on Comercial, a fresh capture displaying its visible effect, and the corresponding authenticated r2 trace. Mock success and trace events alone must not be substituted for this result. After that, run E1 through the public API and verify it with the official practice-only `/__check` endpoint.
