mod audit;
mod auth;
mod catalog;
mod catalog_meta;
mod catalog_revision;
mod catalog_types;
mod config;
mod download_governor;
mod igdb;
mod manifest;
mod rate_limit;
mod routes;
mod state;

use axum::{
    Router,
    middleware::from_fn_with_state,
    routing::{delete, get, post},
};
use clap::{Parser, Subcommand};
use tower_http::{limit::RequestBodyLimitLayer, normalize_path::NormalizePathLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use crate::config::AppConfig;
use crate::download_governor::DownloadGovernor;
use crate::manifest::PackageType;
use crate::state::AppState;

#[derive(Parser)]
#[command(name = "playsomthng-server", about = "PlaySomthng API server")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Scan a package folder and write a manifest JSON (relative paths, forward slashes).
    GenerateManifest {
        #[arg(long)]
        package_id: String,
        #[arg(long)]
        root: std::path::PathBuf,
        #[arg(long, default_value = "pc-game")]
        package_type: String,
        #[arg(long)]
        launch_target: Option<String>,
        #[arg(long)]
        out: std::path::PathBuf,
    },
    /// Create a user and print a one-time invite code. Use `--admin` to bootstrap the first admin.
    CreateUser {
        #[arg(long)]
        username: String,
        #[arg(long)]
        admin: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // `.env` in the current working directory (e.g. `cargo run` from `server/`)
    dotenvy::dotenv().ok();
    // When started via `npm run server`, cwd is the repo root - load `server/.env` too
    let _ = dotenvy::from_path("server/.env");

    let cli = Cli::parse();
    if let Some(Commands::GenerateManifest {
        package_id,
        root,
        package_type,
        launch_target,
        out,
    }) = cli.command
    {
        tracing_subscriber::registry()
            .with(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "playsomthng_server=info".into()),
            )
            .with(tracing_subscriber::fmt::layer())
            .init();
        let pt: PackageType = package_type
            .parse()
            .map_err(|e: String| anyhow::anyhow!(e))?;
        let manifest = crate::manifest::scan_package(&package_id, &root, pt, launch_target)?;
        crate::manifest::write_manifest_json(&manifest, &out)?;
        tracing::info!(bytes = manifest.total_bytes, path = %out.display(), "manifest written");
        return Ok(());
    }

    if let Some(Commands::CreateUser { username, admin }) = cli.command {
        let cfg = AppConfig::load()?;
        let data_dir = cfg.ensure_data_directory()?;
        let role = if admin { "admin" } else { "user" };
        let (id, key) = crate::auth::create_user(&data_dir, &username, role)?;
        println!("Created {role} '{username}'");
        println!("  id:          {id}");
        println!("  invite code: {key}");
        println!("\nGive this code to the user. It works once, on their first machine.");
        return Ok(());
    }

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "playsomthng_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cfg = AppConfig::load()?;
    let data_dir = cfg.ensure_data_directory()?;
    let addr = cfg.socket_addr()?;

    tracing::info!(
        bind = %cfg.bind,
        data_dir = %data_dir.display(),
        catalog_mode = ?cfg.catalog_mode,
        local_root = ?cfg.local_games_root,
        public_base = ?cfg.public_base_url,
        download_base = %cfg.download_base_url,
        "config loaded"
    );

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("playsomthng-server/0.1")
        .build()?;

    let igdb = crate::igdb::IgdbClient::from_env(http.clone());
    if igdb.is_some() {
        tracing::info!("IGDB integration enabled");
    } else {
        tracing::info!("IGDB integration disabled (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not set)");
    }

    let catalog_rev_init = crate::catalog_revision::load_revision_from_disk(&data_dir);
    let (catalog_revision_tx, _) = tokio::sync::broadcast::channel::<u64>(32);

    let hw_salt = crate::auth::load_or_create_salt(&data_dir)?;
    let mut active_sessions = crate::auth::load_active_sessions(&data_dir);
    let loaded_session_count = active_sessions.len();
    active_sessions.retain(|_, session| {
        crate::auth::session_device_is_valid(&data_dir, &hw_salt, session)
    });
    if active_sessions.len() != loaded_session_count {
        crate::auth::save_active_sessions(&data_dir, &active_sessions);
    }
    tracing::info!("loaded {} valid active sessions from disk", active_sessions.len());

    let state = AppState {
        config: cfg,
        data_dir,
        http,
        catalog_cache: Arc::new(tokio::sync::Mutex::new(None)),
        local_paths: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
        igdb,
        catalog_revision: Arc::new(AtomicU64::new(catalog_rev_init)),
        catalog_revision_tx,
        hw_salt,
        auth_mutex: Arc::new(tokio::sync::Mutex::new(())),
        auth_sessions: Arc::new(tokio::sync::Mutex::new(active_sessions)),
        auth_challenges: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        download_nonces: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        audit_recent: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        download_governor: Arc::new(DownloadGovernor::new()),
        auth_rate_limiter: crate::rate_limit::RateLimiter::new(20, 2.0),
        sse_connections: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        started_at: std::time::Instant::now(),
    };

    let app = Router::new()
        .route("/", get(routes::health::get_root))
        .route("/config", get(routes::health::get_config))
        .route("/api/config", get(routes::health::get_config))
        // Top-level - easy curl / browser
        .route("/health", get(routes::health::get_health))
        .route("/games", get(routes::games::list_games))
        .route("/games/{id}", get(routes::games::get_game))
        // Legacy / Electron client paths
        .route("/api/health", get(routes::health::get_health))
        .route("/api/games", get(routes::games::list_games))
        .route("/api/games/{id}", get(routes::games::get_game))
        .route("/manifests/{id}", get(routes::cdn::get_manifest_file))
        .route("/cdn/{id}/{*rest}", get(routes::cdn::get_local_file))
        .route("/api/manifests/{id}", get(routes::cdn::get_manifest_file))
        .route("/api/cdn/{id}/{*rest}", get(routes::cdn::get_local_file))
        .route(
            "/api/catalog-revision",
            get(routes::catalog_revision::get_catalog_revision),
        )
        .route(
            "/api/catalog/stream",
            get(routes::catalog_revision::catalog_revision_stream),
        )
        // Auth routes — rate-limited per client IP to blunt brute-force / enumeration.
        .route("/api/auth/challenge", post(routes::auth::post_challenge))
        .route("/api/auth/login", post(routes::auth::post_login))
        .route("/api/auth/security", get(routes::auth::get_security))
        .route("/api/auth/devices/{hw_hash}", delete(routes::auth::delete_device))
        .route("/api/auth/sessions/{session_id}", delete(routes::auth::delete_session))
        // Admin endpoints — rate-limited per client IP + a request body size cap.
        .route("/api/admin/games", get(routes::games::list_all_games))
        .route(
            "/api/admin/catalog-meta",
            get(routes::admin::list_catalog_meta),
        )
        .route(
            "/api/admin/catalog-meta/{id}",
            get(routes::admin::get_catalog_meta).put(routes::admin::put_catalog_meta),
        )
        .route(
            "/api/admin/manifests/{id}",
            get(routes::admin::get_admin_manifest),
        )
        .route("/api/admin/igdb/search", get(routes::admin::igdb_search))
        .route(
            "/api/admin/igdb/game/{igdb_id}",
            get(routes::admin::igdb_fetch_game),
        )
        .route(
            "/api/admin/audit",
            get(routes::admin::get_audit).delete(routes::admin::clear_audit),
        )
        .route(
            "/api/admin/users",
            get(routes::admin::list_users).post(routes::admin::create_user),
        )
        .route("/api/admin/users/{id}", delete(routes::admin::delete_user))
        .route(
            "/api/admin/users/{id}/revoke",
            post(routes::admin::revoke_user),
        )
        .route("/api/admin/users/{id}/key", post(routes::admin::issue_key))
        .route(
            "/api/admin/users/{id}/key/revoke",
            post(routes::admin::revoke_key),
        )
        .route(
            "/api/admin/users/{id}/devices/{hash}/revoke",
            post(routes::admin::revoke_device),
        )
        // Rate-limit auth + admin routes (per client IP).
        .layer(from_fn_with_state(
            state.clone(),
            crate::rate_limit::rate_limit_middleware,
        ))
        // Cap admin/catalog-meta PUT bodies (and any other request) at 2 MiB.
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .layer(NormalizePathLayer::trim_trailing_slash())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on http://{addr}");
    // Graceful shutdown: stop accepting new connections on Ctrl-C / SIGTERM and
    // let in-flight downloads / SSE streams finish (up to 30s) before exiting.
    let shutdown = async {
        let ctrl_c = async {
            tokio::signal::ctrl_c()
                .await
                .expect("failed to install Ctrl-C handler");
        };

        #[cfg(unix)]
        let terminate = async {
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install terminate handler")
                .recv()
                .await;
        };

        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }
        tracing::info!("shutdown signal received, draining in-flight requests…");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;

    Ok(())
}
