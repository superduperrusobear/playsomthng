use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use crate::catalog_types::CatalogSnapshot;
use crate::config::AppConfig;
use crate::download_governor::DownloadGovernor;
use crate::igdb::IgdbClient;
use crate::rate_limit::RateLimiter;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// Login session. `login_hardware_uuid` holds the salted hash of the machine
/// bound at login for every role; the raw SMBIOS UUID is never persisted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub user_id: String,
    pub login_hardware_uuid: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub expires_at: i64,
}

/// Shared server state (handlers pull what they need via `State`).
#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub data_dir: PathBuf,
    pub http: reqwest::Client,
    pub catalog_cache: Arc<tokio::sync::Mutex<Option<CatalogSnapshot>>>,
    /// Local mode: catalog slug → absolute folder on disk (for `/cdn/{id}/...`).
    pub local_paths: Arc<tokio::sync::RwLock<HashMap<String, PathBuf>>>,
    /// IGDB client - `None` when IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are not set.
    pub igdb: Option<IgdbClient>,
    /// Bumps when catalog metadata changes; clients use for conditional `/api/games` fetches.
    pub catalog_revision: Arc<AtomicU64>,
    pub catalog_revision_tx: tokio::sync::broadcast::Sender<u64>,
    /// Per-server salt for hardware fingerprints (auth/hw-salt).
    pub hw_salt: String,
    /// Serialize auth file read/write (login + hardware enrollment).
    pub auth_mutex: Arc<Mutex<()>>,
    /// Login session token → session (user id + machine bound at login for non-admin).
    pub auth_sessions: Arc<Mutex<HashMap<String, AuthSession>>>,
    /// One-time login challenges: nonce → (username, issued-at). Expire in ~2 min.
    pub auth_challenges: Arc<Mutex<HashMap<String, (String, std::time::Instant)>>>,
    /// Download-auth replay guard: seen nonce → first-seen. Entries expire with the timestamp window.
    pub download_nonces: Arc<Mutex<HashMap<String, std::time::Instant>>>,
    /// Audit dedupe: "user:game" → last logged, so an install is one line, not thousands.
    pub audit_recent: Arc<Mutex<HashMap<String, std::time::Instant>>>,
    /// Limits concurrent manifest/CDN streams (2 global, 1 per user).
    pub download_governor: Arc<DownloadGovernor>,
    /// Per-IP token bucket for auth + admin routes (brute-force / enumeration defense).
    pub auth_rate_limiter: RateLimiter,
    /// Live SSE catalog-stream connections — capped to prevent resource exhaustion.
    pub sse_connections: Arc<std::sync::atomic::AtomicU64>,
    /// Server process start time (for uptime reporting in /health).
    pub started_at: std::time::Instant,
}
