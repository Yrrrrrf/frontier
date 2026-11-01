# What Prevented It From Working Last Time (Root-Cause Summary)

Date: 31 October 2026 · Host: `g14`

Three separate things happened during the previous attempts:

---

## 1. Why ChatGPT Reported `HTTP 403 — Your request was blocked (Server: envoy)`

- **What happened:** You pasted `https://custom-funny-joseph-stuffed.trycloudflare.com` into ChatGPT so it could test `/health`.
- **Why it failed inside ChatGPT:** ChatGPT executes inside OpenAI's locked-down container behind an outbound **Envoy firewall (`Server: envoy`)** that blocks `*.trycloudflare.com`.
- **Why it was a false alarm for `/evento`:** OpenAI's firewall only restricts ChatGPT itself. When you validated the exact same URL on the official `/evento` platform at **18:10**, `/evento` connected with **zero issues** (`✓ ENTRYPOINT VALIDADO · 18:10`, `GET /health respondió 200 en 254 ms`).

---

## 2. Why the Tunnel Briefly Returned `502 Bad Gateway` Around `18:39`

- **What happened:** The Cloudflare tunnel (`frontier-tunnel.service`) stayed online, **but the Node process on `127.0.0.1:3000` exited** when the terminal/server was stopped around `18:39` while server files were being modified.
- **Why a second process couldn't bind earlier (`EADDRINUSE`):** Earlier at `18:09–18:15`, a manual `node --import tsx src/main.ts` process (`PID 2201628`) was already holding port `3000` without `systemd` supervision; when that manual process exited, nothing was listening on port `3000`, so Cloudflare returned `502 Bad Gateway`.
- **How it was fixed:** `frontier-agent.service` is now running as the single supervised `systemd --user` service on port `3000` (`Restart=on-failure`), and `GET /health` over the public tunnel is returning `HTTP/2 200` again.

---

## 3. Why `Corrida 1 de 3` (`18:10–18:15`) Tasks Failed on the Server

Inspecting the trace files recorded during `corrida 1 de 3` (`client/apps/r2/server/artifacts/traces/*.jsonl`) shows that `/evento` **did** reach your G14 through the Cloudflare tunnel and created tasks, which then failed with:

```json
{"event":"runner.failed","status":"failed","details":{"code":"runner_error","error":"La tarea no tiene un flujo determinista configurado."}}
```

- **Root cause in `client/apps/r2/server/src/main.ts`:**
  `main.ts` was switched from the vision-based runner (`createDesktopTaskRunner` + `createOllamaVision`) to `createDeterministicTaskRunner` (`src/deterministic.ts`).
- `src/deterministic.ts` only matches **5 hardcoded regexes** for the practice tasks (`E1`–`E5` on SIGECOM) and has **no fallback** to the vision model (`runner.ts` / `vision.ts`) — so any unseen instruction from `/evento`'s hidden evaluation set (`SET OCULTO`) hits line 354 of `src/deterministic.ts`:
  ```ts
  throw new Error("La tarea no tiene un flujo determinista configurado.");
  ```
- **In addition, Ollama was on `100% CPU` after the `17:29` laptop suspend:**
  Because the laptop suspended at `17:29` (before `frontier-sleep-inhibit.service` was active), the Linux `nvidia_uvm` module wedged (`ggml_cuda_init: failed to initialize CUDA: unknown error`). Running:
  ```nu
  sudo systemctl stop ollama; sudo modprobe -r nvidia_uvm; sudo modprobe nvidia_uvm; sudo systemctl start ollama
  ```
  restores RTX 4060 GPU acceleration (`100% GPU`).
