use axum::{Json, extract::State, http::StatusCode};
use serde_json::{Value, json};

use crate::state::AppState;


/// Minimal public identity — no paths, no filesystem, no config leaked.
pub async fn get_root(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({ "service": "playsomthng-server" }))
}

/// Public discovery kept intentionally bare — internals are not exposed.
pub async fn get_config(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({ "service": "playsomthng-server" }))
}

pub async fn get_health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let uptime_seconds = state.started_at.elapsed().as_secs();
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "uptimeSeconds": uptime_seconds,
        })),
    )
}
