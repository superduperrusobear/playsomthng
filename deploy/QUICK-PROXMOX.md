# Proxmox / `test.somthng.xyz` — what to point where

## You usually do **not** put the raw IP in the app

1. **DNS** (Cloudflare, your registrar, etc.): `test.somthng.xyz` → **A record** = your home / Proxmox **public** IPv4 (and **AAAA** if you use IPv6).
2. **Router / firewall**: forward **80** and **443** to the VM or host that runs **Caddy** (and only that machine needs to reach `127.0.0.1:3000` for Rust).

The **Electron app** and your friends only ever use:

```text
https://test.somthng.xyz
```

as the library **base URL** (Settings → source `baseUrl`). No IP in the client unless you have no DNS and you’re hacking with `http://x.x.x.x` (bad for TLS).

## What runs where

| Piece | Where |
|--------|--------|
| Game files | `/tank_large/games` on the Proxmox box |
| **Caddy** | Listens **443/80** on the internet; routes `/api/*` (etc.) → Rust, rest → `file_server browse` (see `deploy/Caddyfile`) |
| **playsomthng-server** | `127.0.0.1:3000` on the **same** machine as Caddy |
| **config** | On that machine: `server/config.proxmox.example.json` → copy to `config.json`, fix `dataDir` paths if needed |

## Copy-paste server `config.json` (remote catalog + your browse URL)

Use this when the catalog is built from **Caddy’s directory listing** of `/tank_large/games`:

- `catalogMode`: `"remote"`
- `downloadBaseUrl`: `"https://test.somthng.xyz"` (same as the site Caddy serves)
- `publicBaseUrl`: `"https://test.somthng.xyz"` (avatars + absolute API links)

If you prefer **local** catalog (Rust scans `/tank_large/games` and serves `/cdn/…` itself), set `catalogMode` to `"local"`, `localGamesRoot` to `"/tank_large/games"`, and use the **simpler** Caddy block at the bottom of `deploy/Caddyfile` (reverse-proxy only; no `file_server` for games).

## Quick checks

```bash
curl -sS https://test.somthng.xyz/health
curl -sS https://test.somthng.xyz/api/health
```

Both should work after Caddy + Rust are up.

## If something fails

| Problem | Check |
|--------|--------|
| Certificate errors | DNS must point to **this** server; ports 80/443 reachable for Let’s Encrypt |
| 502 on `/api/*` | Is `playsomthng-server` running? `ss -tlnp \| grep 3000` |
| Empty catalog | `downloadBaseUrl` reachable from the **server**; for remote mode, opening `https://test.somthng.xyz/` in a browser should show your browse listing |
| Downloads fail | Paths in manifests vs where files really live under `/tank_large/games` |

See also `deploy/README.md` and `AUTH-OPERATIONS.md`.
