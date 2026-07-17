//! Server config loaded from JSON - same file shape on Windows and Linux.
//! Paths are relative to the process current directory unless absolute.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::{Deserialize, Serialize};

/// How the catalog is built: HTTP index vs scanning a local folder (e.g. `G:\` on Windows).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum CatalogMode {
    #[default]
    Remote,
    Local,
}

/// On-disk shape (matches what you edit in `config.json`).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AppConfig {
    /// Listen address, e.g. `"127.0.0.1:3000"` (local only) or `"0.0.0.0:3000"` (all interfaces).
    /// **Set this in `config.json`** - `Default` in code applies only when no config file is loaded.
    pub bind: String,
    /// Data directory (relative paths are resolved against [`std::env::current_dir`].
    #[serde(rename = "dataDir")]
    pub data_dir: String,
    /// Base URL for the download / CDN host (no trailing slash required).
    /// Example: `https://test.somthng.xyz` - must expose an index (Caddy `file_server browse` or similar).
    #[serde(rename = "downloadBaseUrl")]
    pub download_base_url: String,
    /// Path segment for per-game manifests under the download host, e.g. `manifests` → `.../manifests/{id}.json`.
    #[serde(default = "default_manifests_path", rename = "manifestsPath")]
    pub manifests_path: String,
    /// How long to reuse a successful remote directory listing (seconds).
    #[serde(default = "default_catalog_ttl", rename = "catalogCacheTtlSeconds")]
    pub catalog_cache_ttl_seconds: u64,

    /// `remote` = fetch HTML from `downloadBaseUrl`. `local` = scan `localGamesRoot` on disk.
    #[serde(default, rename = "catalogMode")]
    pub catalog_mode: CatalogMode,

    /// When `catalogMode` is `local`, directory to list (each subfolder = one game). E.g. `G:\\` or `G:\\games`.
    #[serde(default, rename = "localGamesRoot")]
    pub local_games_root: Option<String>,

    /// Base URL for `manifestUrl` / `downloadBaseUrl` in local mode (your API host). E.g. `http://127.0.0.1:3000`.
    #[serde(default, rename = "publicBaseUrl")]
    pub public_base_url: Option<String>,
}

fn default_manifests_path() -> String {
    "manifests".into()
}

fn default_catalog_ttl() -> u64 {
    120
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            // Only used when no config.json is found; otherwise bind comes from JSON.
            bind: "127.0.0.1:3000".into(),
            data_dir: "./data".into(),
            download_base_url: "https://test.somthng.xyz".into(),
            manifests_path: default_manifests_path(),
            catalog_cache_ttl_seconds: default_catalog_ttl(),
            catalog_mode: CatalogMode::Remote,
            local_games_root: None,
            public_base_url: None,
        }
    }
}

impl AppConfig {
    /// Load from `CONFIG_PATH`, else `config.json` in cwd, else `server/config.json` (when cwd is repo root).
    /// If none exist, uses defaults. Env vars override JSON values:
    ///   `PLAYSOMTHNG_PUBLIC_URL`  — overrides `publicBaseUrl`
    ///   `PLAYSOMTHNG_BIND`        — overrides `bind`
    ///   `PLAYSOMTHNG_GAMES_ROOT`  — overrides `localGamesRoot`
    pub fn load() -> anyhow::Result<Self> {
        let candidates: Vec<PathBuf> = if let Ok(p) = std::env::var("CONFIG_PATH") {
            vec![PathBuf::from(p)]
        } else {
            vec![
                PathBuf::from("config.json"),
                PathBuf::from("server/config.json"),
            ]
        };

        let mut cfg = 'load: {
            for path in &candidates {
                if path.is_file() {
                    let raw = std::fs::read_to_string(path)
                        .with_context(|| format!("read {}", path.display()))?;
                    let c: Self = serde_json::from_str(&raw)
                        .with_context(|| format!("parse {}", path.display()))?;
                    tracing::info!("loaded config from {}", path.display());
                    break 'load c;
                }
            }
            tracing::warn!(
                "no config file (tried {}) - using defaults; copy server/config.example.json to server/config.json",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            Self::default()
        };

        // Env var overrides — set these in `server/.env` or via systemd/docker env.
        if let Ok(v) = std::env::var("PLAYSOMTHNG_PUBLIC_URL") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                tracing::info!("PLAYSOMTHNG_PUBLIC_URL override: {v}");
                cfg.public_base_url = Some(v);
            }
        }
        if let Ok(v) = std::env::var("PLAYSOMTHNG_BIND") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                tracing::info!("PLAYSOMTHNG_BIND override: {v}");
                cfg.bind = v;
            }
        }
        if let Ok(v) = std::env::var("PLAYSOMTHNG_GAMES_ROOT") {
            let v = v.trim().to_string();
            if !v.is_empty() {
                tracing::info!("PLAYSOMTHNG_GAMES_ROOT override: {v}");
                cfg.local_games_root = Some(v);
            }
        }

        Ok(cfg.normalize_urls())
    }

    /// Strip trailing slashes for consistent joining; warn if publicBaseUrl still has placeholder.
    fn normalize_urls(mut self) -> Self {
        while self.download_base_url.ends_with('/') {
            self.download_base_url.pop();
        }
        if let Some(ref mut pub_url) = self.public_base_url {
            while pub_url.ends_with('/') {
                pub_url.pop();
            }
            if pub_url.contains("YOUR_PROXMOX_IP") {
                tracing::warn!(
                    "publicBaseUrl still contains the placeholder ({pub_url}). \
                     Set PLAYSOMTHNG_PUBLIC_URL env var or update config.json with \
                     your actual hostname, e.g. https://test.somthng.xyz"
                );
            }
        }
        self
    }

    pub fn socket_addr(&self) -> anyhow::Result<SocketAddr> {
        self.bind
            .parse()
            .with_context(|| format!("invalid bind address: {:?}", self.bind))
    }

    /// Resolve `dataDir` to an absolute path and ensure it exists.
    pub fn ensure_data_directory(&self) -> anyhow::Result<PathBuf> {
        let p = Path::new(&self.data_dir);
        let absolute = if p.is_absolute() {
            p.to_path_buf()
        } else {
            std::env::current_dir().context("current_dir")?.join(p)
        };
        std::fs::create_dir_all(&absolute)
            .with_context(|| format!("create data dir {}", absolute.display()))?;
        Ok(absolute)
    }

    /// Join a path segment onto the download base (leading slash on `suffix` is ok).
    pub fn download_url(&self, suffix: &str) -> String {
        let suffix = suffix.trim_start_matches('/');
        format!("{}/{}", self.download_base_url, suffix)
    }

    /// `https://{host}/manifests/{id}.json` (uses `manifestsPath` from config).
    pub fn manifest_url_for_game_id(&self, id_slug: &str) -> String {
        if self.catalog_mode == CatalogMode::Local {
            let base = self
                .public_base_url
                .as_deref()
                .unwrap_or("http://127.0.0.1:3000")
                .trim_end_matches('/');
            // Path is `/manifests/{id}` - file on disk is still `{id}.json`
            return format!("{}/manifests/{}", base, id_slug);
        }
        let base = self.download_base_url.trim_end_matches('/');
        let m = self.manifests_path.trim_matches('/');
        format!("{}/{}/{}.json", base, m, id_slug)
    }

    /// Local mode: per-game files under `/cdn/{id}/...` on this API.
    pub fn local_cdn_base(&self, id_slug: &str) -> String {
        let base = self
            .public_base_url
            .as_deref()
            .unwrap_or("http://127.0.0.1:3000")
            .trim_end_matches('/');
        format!("{}/cdn/{}/", base, id_slug)
    }

    /// Base URL of this API host (avatars, auth callbacks). Matches `publicBaseUrl` or dev default.
    pub fn public_api_origin(&self) -> String {
        self.public_base_url
            .as_deref()
            .unwrap_or("http://127.0.0.1:3000")
            .trim_end_matches('/')
            .to_string()
    }
}
