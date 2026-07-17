# Deploy Somthng (Caddy + playsomthng-server)

This folder is the **production-style** layout: **Caddy** terminates TLS and reverse-proxies to the Rust API on **127.0.0.1:3000**. The Electron app talks to the **public HTTPS URL** (same host for catalog, auth, downloads).

## Swap the API onto your Proxmox / Linux box (from dev on your PC)

Do this once when you move from **local `cargo run`** to **the real server**.

1. **On the Linux machine** (SSH): install Rust **or** build the binary elsewhere and copy only the artifact.
   - **Build on the server** (simplest): clone or `rsync` the repo → `cd server && cargo build --release` → binary is `target/release/playsomthng-server`.
   - **Build off-box**: produce a **Linux** `playsomthng-server` (same CPU arch as Proxmox, usually `x86_64-unknown-linux-gnu`). Do not deploy a Windows `.exe`.
2. **Layout** (example `/opt/somthng-server/`):
   - `playsomthng-server` — executable
   - `config.json` — from `server/config.proxmox.example.json` or `config.production.example.json`; set **`dataDir`**, **`publicBaseUrl`**, **`downloadBaseUrl`**, **`catalogMode`**, **`localGamesRoot`** for your tank path if using local catalog.
3. **Data you might copy from dev** (optional): if you already have `data/auth/`, `data/manifests/`, etc. on your PC, you can `scp` that folder so you don’t start empty — or ship fresh and copy only `server/seed/auth-users.json` → `data/auth/auth-users.json` on first boot.
4. **Bind**: keep **`"bind": "127.0.0.1:3000`** so only Caddy touches the public internet.
5. **systemd**: install `deploy/somthng-server.service`, fix paths/users, `systemctl enable --now somthng-server`.
6. **Caddy**: install `deploy/Caddyfile` (split routing if you still use `file_server` for `/tank_large/games`) — see **`QUICK-PROXMOX.md`**.
7. **Clients**: set library **`baseUrl`** to `https://test.somthng.xyz` (your domain). You can **stop** the API on your Windows machine unless you still want local dev.

**Quick verify:** `curl https://your-domain/health` and `curl https://your-domain/api/health` from your laptop.

## What you must line up

| Piece | Must match |
|--------|------------|
| DNS | `A` / `AAAA` record for your API hostname → your VPS IP |
| `deploy/Caddyfile` | `test.somthng.xyz` → change to your domain if different |
| Server `config.json` | `publicBaseUrl` and `downloadBaseUrl` = `https://your-domain` (no trailing slash) |
| Electron **Settings → library source** | `baseUrl` = `https://your-domain` (same origin as the API) |

`publicBaseUrl` is what the server uses for avatar URLs and other absolute links — it must be the **HTTPS URL clients use**, not `http://127.0.0.1:3000`.

## 1. Build the server binary (on your machine or CI)

From the repo:

```bash
cd server
cargo build --release
```

Artifact: `server/target/release/playsomthng-server` (Linux) or `.exe` on Windows. For a Linux VPS, build **on Linux** or cross-compile; do not copy a Windows `.exe` to Linux.

## 2. Lay out files on the VPS

Example paths (adjust freely):

```text
/opt/somthng-server/
  playsomthng-server    # release binary
  config.json           # copy from server/config.production.example.json and edit
  data/                 # created at runtime; auth, manifests, etc.
```

- Copy `server/seed/auth-users.json` into `data/auth/auth-users.json` on first deploy if you are bootstrapping accounts (or let the server create from seed — see server code).
- Set `bind` to **`127.0.0.1:3000`** so the API is not exposed except through Caddy.

## 3. systemd (optional but recommended)

1. Create user `somthng` or change `User=` / `Group=` / paths in `somthng-server.service`.
2. Copy the unit:

   ```bash
   sudo cp deploy/somthng-server.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now somthng-server
   ```

3. Check logs: `journalctl -u somthng-server -f`

## 4. Caddy

1. Install Caddy: https://caddyserver.com/docs/install  
2. Copy **`deploy/Caddyfile`** into `/etc/caddy/Caddyfile` (or include this site block in your existing config).
3. Edit the **site name** if your domain is not `test.somthng.xyz`.
4. Validate and reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

Caddy will obtain Let’s Encrypt certificates for public hostnames automatically.

### Order of startup

Start **playsomthng-server** first (or let systemd restart it), then **Caddy**. If nothing listens on `:3000`, Caddy will return 502 until the API is up.

## 5. Smoke tests (from your laptop)

```bash
curl -sS https://test.somthng.xyz/health
curl -sS -X POST https://test.somthng.xyz/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","setupKey":"","hardwareUuid":"dummy"}'
```

Expect health OK; login may return JSON errors — that still proves TLS + routing work.

## 6. Electron client

1. Open **Settings** and set the enabled library source **`baseUrl`** to `https://test.somthng.xyz` (your real domain).
2. Or set env **`PLAYSOMTHNG_API_BASE`** / **`PLAYSMTHNG_API_BASE`** before launch for a default dev source (see `settings.service.ts`).

Packaged builds do not auto-fill the remote URL; users (or your installer) should point `baseUrl` at the same HTTPS origin as production.

## Troubleshooting

| Symptom | Check |
|--------|--------|
| 502 from Caddy | Is `playsomthng-server` running? `ss -tlnp \| grep 3000` |
| TLS fails | DNS must point to this server; ports 80/443 open for ACME |
| Avatars wrong host | `publicBaseUrl` in server `config.json` must be the public `https://…` URL |
| Catalog empty | `downloadBaseUrl` / remote index reachable from the VPS |
| SSE catalog stream stalls | Caddyfile uses `flush_interval -1` on `reverse_proxy` |

More auth operations: **`AUTH-OPERATIONS.md`** in the repo root.
