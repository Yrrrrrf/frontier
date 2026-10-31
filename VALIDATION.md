# CURRENT VALIDATION GUIDE

Run from the real repository. Use environment variables for credentials; do not paste secrets into source or committed reports.

## Fast checks

```sh
cd client/apps/r2/server
npm install
npm run validate
```

This runs TypeScript checks and six Node tests covering the HTTP contract, task lifecycle, ActionGuard, and Ollama envelope handling. Injected fetch/runner tests are mock control-flow tests only.

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

## Current real results

- Desktop login/capture: PASS.
- Latest vision probe: PASS, 3/3 Comercial hits at `(192,120)`, about 1.1 seconds per warm proposal.
- Ollama placement observed after inference: 100% GPU.
- Real click and full task execution: NOT_RUN.

## Next acceptance check

The next real validation must show a fresh capture, a valid model proposal, a guarded click on Comercial, and a fresh capture displaying its visible effect. Mock success must not be substituted for this result. After that, run E1 through the public API and verify it with the official practice-only `/__check` endpoint.
