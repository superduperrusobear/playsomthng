use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde_json::{Value, json};

use crate::auth;
use crate::catalog;
use crate::catalog_meta::{self, PublishState};
use crate::catalog_types::CatalogGame;
use crate::config::CatalogMode;
use crate::state::AppState;

/// Resolves the session token to a user id, or an error response. Blocked
/// accounts get ACCOUNT_REVOKED so the client can show the revoked state.
async fn require_session(headers: &HeaderMap, state: &AppState) -> Result<String, (StatusCode, Json<Value>)> {
    let token = auth::bearer_token(headers)
        .ok_or((StatusCode::UNAUTHORIZED, Json(json!({ "error": "UNAUTHORIZED" }))))?;
    let user_id = {
        let sessions = state.auth_sessions.lock().await;
        sessions
            .get(&auth::token_key(&token))
            .map(|s| s.user_id.clone())
            .ok_or((StatusCode::UNAUTHORIZED, Json(json!({ "error": "UNAUTHORIZED" }))))?
    };
    match auth::account_state(&state.data_dir, &user_id) {
        auth::AccountState::Active => Ok(user_id),
        _ => Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "ACCOUNT_REVOKED" })),
        )),
    }
}

/// GET /games - catalog for signed-in users; only games with `publishState: "published"`.
pub async fn list_games(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_session(&headers, &state).await?;
    let snap = catalog::get_catalog(&state).await;

    let published: Vec<&CatalogGame> = snap
        .games
        .iter()
        .filter(|g| {
            catalog_meta::load_meta_by_catalog_slug(&state.data_dir, &g.id)
                .ok()
                .flatten()
                .is_some_and(|m| matches!(m.publish_state, PublishState::Published))
        })
        .collect();

    let total = published.len();
    let source = match state.config.catalog_mode {
        CatalogMode::Local => "local-scan",
        CatalogMode::Remote => "download-server",
    };
    let mut body = json!({
        "source": source,
        "totalGames": total,
        "games": published,
        "page": 1,
        "pageSize": 50,
        "totalPages": if total == 0 { 1 } else { (total + 49) / 50 },
    });

    if let Some(e) = snap.error {
        body["catalogError"] = json!(e);
    }

    Ok(Json(body))
}

/// GET /api/admin/games - all scanned games regardless of publish state (admin only).
pub async fn list_all_games(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, StatusCode> {
    let token = auth::bearer_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = {
        let sessions = state.auth_sessions.lock().await;
        sessions.get(&auth::token_key(&token)).map(|s| s.user_id.clone()).ok_or(StatusCode::UNAUTHORIZED)?
    };
    let role = auth::user_role_for_id(&state.data_dir, &user_id).unwrap_or_default();
    if role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let snap = catalog::get_catalog(&state).await;

    let total = snap.games.len();
    let source = match state.config.catalog_mode {
        CatalogMode::Local => "local-scan",
        CatalogMode::Remote => "download-server",
    };
    let mut body = json!({
        "source": source,
        "totalGames": total,
        "games": snap.games,
        "page": 1,
        "pageSize": 50,
        "totalPages": if total == 0 { 1 } else { (total + 49) / 50 },
    });

    if let Some(e) = snap.error {
        body["catalogError"] = json!(e);
    }

    Ok(Json(body))
}

/// GET /games/:id - one catalog entry by slug **or** stable UUID (matches Electron `catalogSlugToStableUuid`).
pub async fn get_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> (StatusCode, Json<Value>) {
    if let Err((code, body)) = require_session(&headers, &state).await {
        return (code, body);
    }
    let snap = catalog::get_catalog(&state).await;

    if let Some(g) = snap
        .games
        .iter()
        .find(|g| catalog::catalog_entry_matches_param(g, &id))
    {
        return (StatusCode::OK, Json(catalog_game_to_json(g)));
    }

    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "NOT_FOUND",
            "message": "game not found"
        })),
    )
}

fn catalog_game_to_json(g: &CatalogGame) -> Value {
    serde_json::to_value(g).unwrap_or(json!({}))
}
