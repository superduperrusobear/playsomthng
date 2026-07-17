# playsomthng-server

Rust HTTP API for the **PlaySomthng** Electron launcher. It is **not** the desktop app itself—that lives in the repo root (`npm run dev`). This crate is the small backend the client calls for catalog + manifests (and, in local mode, file URLs).

### What it does today

- Exposes **`/games`**, **`/manifests/{id}`**, **`/cdn/{id}/…`**, health/config routes.
- **Remote catalog**: reads your download host’s HTML index and lists game folders.
- **Local catalog**: scans `localGamesRoot`, generates per-game **manifests** (full file lists) under `dataDir/manifests/`, and can serve those files via `/cdn/…`.
- Optional **CLI** to generate a manifest JSON for one folder without running the HTTP server.

More behavior will land here over time; treat this README as a living map.

### How to start the server

From the **repository root** (uses `server/Cargo.toml`):

```bash
npm run server
```

Or from **`server/`**:

```bash
cargo run
```

1. Copy or edit config: `config.local.example.json` → `config.json` (in `server/` or cwd—see [Config](#config)). For local games + launcher URLs, use `catalogMode: "local"`, set `localGamesRoot`, `dataDir`, and **`publicBaseUrl`** (e.g. `http://127.0.0.1:3000`) so the catalog points at this process.
2. Optional: `server/.env` for things like `CONFIG_PATH` if you use it.
3. Default bind is in config (often `0.0.0.0:3000`). Hit **`/health`** or **`/games`** to confirm it’s up.

Then start the **Electron app** separately (`npm run dev` from repo root) and point it at the same API base you put in `publicBaseUrl`.

## Layout (`src/`)

| Module | Role |
|--------|------|
| `main.rs` | Axum app, routes, tracing. Optional CLI: `generate-manifest` (see below). |
| `config.rs` | `AppConfig` from JSON (`config.json` or `CONFIG_PATH`). `dataDir`, `downloadBaseUrl`, `catalogMode`, `localGamesRoot`, `publicBaseUrl`, `manifestsPath`, TTL. |
| `manifest.rs` | **Package manifest generator**: walk a package root, emit JSON with relative paths (`/`), sizes, `packageType`, optional `launchTarget`. Same logic for local catalog and CLI. |
| `catalog.rs` | **Remote**: parse HTML directory index from `downloadBaseUrl`. **Local**: list subfolders of `localGamesRoot` (one game per folder), scan each with `manifest`, write `{slug}.json`, cache folder paths for CDN. |
| `catalog_types.rs` | `CatalogGame` / `CatalogSnapshot` shapes for `/games`. |
| `state.rs` | Shared `AppState` (config, `data_dir`, HTTP client, catalog cache, `local_paths` map). |
| `routes/` | `health`, `games`, `cdn` (manifest + local file reads). |

## Config

- **Load order**: `CONFIG_PATH` env → `./config.json` → `./server/config.json` (when cwd is repo root). See `config.example.json` / `config.local.example.json`.
- **`dataDir`**: Where `manifests/` lives on disk (`{dataDir}/manifests/{id}.json`).
- **`catalogMode`**: `remote` (HTTP index) vs `local` (scan `localGamesRoot`).
- **`local` + launcher URLs**: Set **`publicBaseUrl`** to your API base (e.g. `http://127.0.0.1:3000`) so `manifestUrl` and `downloadBaseUrl` in the catalog point at this server.

## Manifests (HTTP vs files)

- **URL**: `GET /manifests/{id}` and `GET /api/manifests/{id}` — **no** `.json` in the path segment (Axum routing).
- **File**: `{dataDir}/manifests/{id}.json`).
- **Content**: Full file list from `manifest.rs` (paths relative to the game folder, forward slashes, `totalBytes`, `packageType`, etc.).

## Local CDN

- `GET /cdn/{id}/{*rest}` serves files under the scanned game directory for that catalog `id` (uses in-memory `local_paths` after a local catalog build).

## CLI: generate a manifest without the server

From the `server` directory:

```bash
cargo run -- generate-manifest --package-id my-game-slug --root "D:\games\My Game" --package-type pc-game --out "D:\path\to\manifests\my-game-slug.json"
```

Optional: `--launch-target "game.exe"` (relative path inside the package). Package types: `pc-game`, `rom`, `rom-bundle`, `iso`, `emulator` (scan behavior is the same today).

## Assets

- `assets/sample_manifest.pc-game.json` — example manifest shape for documentation / clients.

## Client (repo root)

- `src/shared/catalog-mapper.ts` — maps catalog JSON to UI types; **namespace UUID** for slug → stable id matches `catalog.rs` (`CATALOG_NAMESPACE`).

---

## Production (Caddy + HTTPS)

For a public VPS: **Caddy** reverse-proxies to the API on `127.0.0.1:3000`, and **`publicBaseUrl`** in `config.json` must be your real `https://…` origin (see `config.production.example.json`). Step-by-step: **`../deploy/README.md`**.

This file is a **map of the backend**—update it as we add routes, auth, hosting notes, or deployment steps.
