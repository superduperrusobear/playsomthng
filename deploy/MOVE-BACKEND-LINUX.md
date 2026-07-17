# Move the backend to your Linux (Proxmox) machine

Follow in order. You need **SSH access** to the Linux box.

---

## 1. Install Rust on Linux (one time)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version
```

---

## 2. Get the `server` code onto Linux

**Option A — `scp` from your Windows PC** (PowerShell, paths adjusted):

```powershell
scp -r C:\Users\almig\Downloads\playsomthng\server youruser@YOUR_LINUX_IP:/home/youruser/somthng-server
```

**Option B — Git** on Linux:

```bash
cd ~
git clone <YOUR_REPO_URL> playsomthng
# then you only need the server folder:
cd playsomthng/server
```

**Option B2 — USB / shared folder** — copy the whole `server` folder however you like. The folder must contain `Cargo.toml` and `src/`.

---

## 3. Build the Linux binary

On Linux:

```bash
cd ~/somthng-server    # or ~/playsomthng/server — wherever you put it
cargo build --release
```

Binary path:

```bash
./target/release/playsomthng-server
```

That file **is** your backend. There is no separate installer.

---

## 4. Pick an install directory (example)

```bash
sudo mkdir -p /opt/somthng-server
sudo cp target/release/playsomthng-server /opt/somthng-server/
sudo chown root:root /opt/somthng-server/playsomthng-server
sudo chmod +x /opt/somthng-server/playsomthng-server
```

Create `data` and add config:

```bash
sudo mkdir -p /opt/somthng-server/data
```

Copy your **`config.json`** (edit paths for Linux — see `server/config.proxmox.example.json` in the repo). Minimal checks:

- `"bind": "127.0.0.1:3000"`
- `"publicBaseUrl": "https://test.somthng.xyz"` (your real domain)
- `"downloadBaseUrl": "https://test.somthng.xyz"` (or whatever matches your file hosting)
- `"dataDir": "/opt/somthng-server/data"` (absolute path is safest)

```bash
sudo nano /opt/somthng-server/config.json
```

If you use auth, copy `data/auth/` from your dev PC or bootstrap from `server/seed/auth-users.json` into `/opt/somthng-server/data/auth/`.

---

## 5. Run it manually (quick test)

```bash
cd /opt/somthng-server
export CONFIG_PATH=/opt/somthng-server/config.json
./playsomthng-server
```

From another terminal on the same machine:

```bash
curl -sS http://127.0.0.1:3000/health
```

You should see a healthy response. `Ctrl+C` stops the server.

---

## 6. Run it forever with systemd

```bash
sudo cp /path/to/repo/deploy/somthng-server.service /etc/systemd/system/
# Edit the file: fix User=, paths if you didn’t use /opt/somthng-server
sudo nano /etc/systemd/system/somthng-server.service
```

Set `Environment=CONFIG_PATH=/opt/somthng-server/config.json` and `WorkingDirectory=/opt/somthng-server`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now somthng-server
sudo systemctl status somthng-server
journalctl -u somthng-server -f
```

---

## 7. Caddy in front (HTTPS + domain)

- Install Caddy on **this same machine**.
- Put your site block from **`deploy/Caddyfile`** in `/etc/caddy/Caddyfile` so `/api/*` goes to `127.0.0.1:3000`.
- DNS: `test.somthng.xyz` → your public IP; ports **80** and **443** forwarded to this VM.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Test from your laptop:

```bash
curl https://test.somthng.xyz/api/health
```

---

## 8. Windows app (launcher)

In **Settings → library source**, set **base URL** to:

`https://test.somthng.xyz`

(same HTTPS URL Caddy serves.)

You **do not** run `cargo run` on Windows for day-to-day use anymore — only the **.exe** client, talking to Linux.

---

## If something breaks

| Issue | What to check |
|--------|----------------|
| `command not found: cargo` | Run `source ~/.cargo/env` or log in again after rustup |
| Permission denied on binary | `chmod +x` and correct ownership |
| Connection refused on 3000 | Is the service running? `systemctl status somthng-server` |
| 502 from browser | Caddy up? Rust listening? `ss -tlnp \| grep 3000` |
| Wrong URLs in app | `publicBaseUrl` in `config.json` must be `https://…` not `127.0.0.1` |

---

## What stays where

| On Linux | On Windows |
|----------|------------|
| `playsomthng-server`, `config.json`, `data/`, Caddy, games disk if local mode | Built **.exe** / Electron app only |
