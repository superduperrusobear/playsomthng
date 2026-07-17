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
mod routes;
mod state;

use axum::{
    Router,
    routing::{delete, get, post},
};
use clap::{Parser, Subcommand};
use tower_http::{cors::CorsLayer, normalize_path::NormalizePathLayer, trace::TraceLayer};
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
                .unwrap_or_else(|_| "playsomthng_server=debug,tower_http=debug".into()),
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

    let active_sessions = crate::auth::load_active_sessions(&data_dir);
    tracing::info!("loaded {} active sessions from disk", active_sessions.len());

    let hw_salt = crate::auth::load_or_create_salt(&data_dir)?;

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
        .route("/api/auth/challenge", post(routes::auth::post_challenge))
        .route("/api/auth/login", post(routes::auth::post_login))
        .route("/api/auth/avatar", post(routes::auth::post_avatar))
        .route("/api/auth/devices", get(routes::auth::get_devices))
        .route("/api/auth/avatars/{user_id}", get(routes::auth::get_avatar))
        // Admin endpoints
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
        .route("/api/admin/audit", get(routes::admin::get_audit))
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
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .layer(NormalizePathLayer::trim_trailing_slash())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on http://{addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
