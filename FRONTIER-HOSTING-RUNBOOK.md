# Frontier — NixOS Hosting Changes, Tunnels & Validation Summary

Date: 31 October 2026 · Host: `g14` (`x86_64-linux`)

---

## 1. NixOS Configuration Changes (`/etc/nixos`)

### A. Added `frontier-hosting` Module (`/etc/nixos/src/system/frontier-hosting.nix`)

Created `/etc/nixos/src/system/frontier-hosting.nix` (auto-discovered by `import-tree`):

```nix
{...}: {
  flake.nixosModules.frontier-hosting = {pkgs, ...}: {
    environment.systemPackages = with pkgs; [
      chromium
      cloudflared
    ];
  };
}
```

- Provides `/run/current-system/sw/bin/chromium` (`Chromium 156.0.8078.79`) for Playwright/noVNC desktop automation.
- Provides `/run/current-system/sw/bin/cloudflared` (`cloudflared 2026.10.3`) for outbound HTTPS Cloudflare Tunnels.

### B. Activated Module on Host `g14` (`/etc/nixos/src/host/g14/g14.nix`)

Added `"frontier-hosting"` to `config.flake.lib.hosts.g14.modules` alongside `"llms"`:

```nix
      "nvidia"
      "llms"
      "frontier-hosting"
      "g14-disk"
```

- Verified with `just check` (`alejandra`, `nix flake check`, `flake-checker`) and activated with `just switch` (`nh os switch -H g14`).
- Preserved the existing firewall configuration in `/etc/nixos/src/system/networking.nix` without opening any inbound ports (`cloudflared` uses outbound QUIC connections).

---

## 2. Runtime Services, Tunnels & Hardware Fixes on `g14`

### A. Active Cloudflare Tunnels (`systemd --user`)

Three supervised `systemd --user` tunnels were started so external machines and the Frontier evaluator can reach your `g14` without depending on open terminal windows:

| Service | Local Target | Public HTTPS URL | `systemd --user` Unit |
| --- | --- | --- | --- |
| **Frontier Agent API** | `http://127.0.0.1:3000` | `https://custom-funny-joseph-stuffed.trycloudflare.com` | `frontier-tunnel.service` |
| **Ollama GPU (`qwen3-vl:2b`)** | `http://127.0.0.1:11434` | `https://badge-sauce-vincent-distribution.trycloudflare.com` | `frontier-ollama-tunnel.service` |
| **Laya CPU (`multilingual`)** | `http://127.0.0.1:8001` | `https://sizes-enforcement-population-filing.trycloudflare.com` | `frontier-laya-tunnel.service` |

### B. Independent Sleep & Lid-Switch Inhibition (`frontier-sleep-inhibit.service`)

Because `hypridle.conf` runs `systemctl suspend` after 1,800 seconds, a dedicated user service holds a continuous `systemd-inhibit` lock even if the Node agent process restarts:

- **Unit:** `frontier-sleep-inhibit.service`
- **Command:** `systemd-inhibit --what=sleep:idle:handle-lid-switch --mode=block --who=Frontier --why="Serving Frontier evaluation requests" sleep infinity`
- **Check status:** `systemd-inhibit --list | rg 'WHO|Frontier'`

### C. Laya Port Conflict Resolution (`8001` vs `8000`)

- Port `8000` on `g14` is occupied by a rootless Podman **SurrealDB** container (`server: SurrealDB`), which also returns `200 OK` (with an empty body) on `GET /health`.
- The actual **Laya** service (`python -m laya.serve`) runs on **`http://127.0.0.1:8001`** (`LAYA_PORT=8001`), where `GET /health` returns `{"status":"ok","loaded":["multilingual"],...}`.
- Configured `LAYA_BASE_URL="http://127.0.0.1:8001"` so the Frontier agent calls Laya instead of SurrealDB.

### D. Why ChatGPT's Sandbox Returned `403 Server: envoy` vs. Real External Clients

- Testing the `*.trycloudflare.com` URL from inside ChatGPT's cloud sandbox returned `HTTP 403 / Server: envoy / Your request was blocked` because OpenAI's internal egress proxy (`envoy`) blocks outbound connections to `*.trycloudflare.com`.
- Real external servers — including the Frontier `/evento` evaluation platform — do not sit behind OpenAI's sandbox proxy and connect to `https://custom-funny-joseph-stuffed.trycloudflare.com` directly.

### E. NVIDIA `nvidia_uvm` Recovery After Suspend

- Earlier system suspend (`17:29`) before `systemd-inhibit` was active wedged the `nvidia_uvm` kernel module (`ggml_cuda_init: failed to initialize CUDA: unknown error`), causing Ollama to fall back to CPU until `nvidia_uvm` is reloaded:
  ```nu
  sudo systemctl stop ollama
  sudo modprobe -r nvidia_uvm
  sudo modprobe nvidia_uvm
  sudo systemctl start ollama
  ollama run qwen3-vl:2b "ok"
  ollama ps
  ```

---

## 3. Platform Entrypoint Validation Evidence (`18:10`)

- **Entrypoint submitted on `/evento`:** `https://custom-funny-joseph-stuffed.trycloudflare.com`
- **Platform validation result:**
  - `✓ ENTRYPOINT VALIDADO · 18:10`
  - `✓ GET /health respondió 200 en 254 ms`
  - Triggered hidden evaluation set (`corrida 1 de 3`), delivering real `POST /tasks` requests over the Cloudflare Tunnel to `g14` port `3000` and writing execution traces under `~/Documents/frontier/client/apps/r2/server/artifacts/traces/`.

---

## 4. Useful Management Commands (Nushell)

```nu
# Check tunnel and sleep-inhibitor units
systemctl --user status frontier-tunnel frontier-ollama-tunnel frontier-laya-tunnel frontier-sleep-inhibit --no-pager

# Confirm sleep/lid-switch inhibitor is active
systemd-inhibit --list | rg 'WHO|Frontier'

# Check what is listening on port 3000 (Frontier Agent), 8001 (Laya), and 11434 (Ollama)
ss -tlnp | rg '3000|8001|11434'

# View latest evaluation trace files received from /evento
ls -lt ~/Documents/frontier/client/apps/r2/server/artifacts/traces/ | head -n 10
```
