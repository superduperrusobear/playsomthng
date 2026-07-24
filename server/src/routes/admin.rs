//! Admin HTTP endpoints - user management, metadata, and IGDB proxy.
//!
//! All routes are under `/api/admin/` and require an admin bearer token
//! (see `require_admin`).
//!
//! Routes:
//!   GET  /api/admin/audit                  → searchable audit entries, newest first
//!   DELETE /api/admin/audit                → clear entries and retain a clear marker
//!   GET  /api/admin/users                  → list users, devices, pending keys
//!   POST /api/admin/users/:id/revoke       → drop sessions + enrollments, clear key
//!   POST /api/admin/users/:id/key          → issue a new one-time key
//!   POST /api/admin/users/:id/key/revoke   → cancel a pending unused key
//!   POST /api/admin/users/:id/devices/:hash/revoke → drop one machine
//!   GET  /api/admin/catalog-meta           → list all saved meta ids
//!   GET  /api/admin/catalog-meta/:id       → load meta (or create a draft stub)
//!   PUT  /api/admin/catalog-meta/:id       → save / replace meta (publishes to the Store)
//!   GET  /api/admin/manifests/:id          → load manifest
//!   GET  /api/admin/igdb/search?q=...      → search IGDB candidates
//!   GET  /api/admin/igdb/game/:igdb_id     → fetch full IGDB metadata
//!
//! Every mutating route writes an audit line (see `crate::audit`).

use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth;
use crate::catalog_meta::{CatalogMeta, list_meta_ids, load_meta_for_admin_path, save_meta};
use crate::state::AppState;

/// Returns the signed-in admin's user id when the session is valid.
/// Returns `Err(StatusCode)` to propagate as the handler error otherwise.
async fn require_admin(headers: &HeaderMap, state: &AppState) -> Result<String, StatusCode> {
    let token = auth::bearer_token(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = {
        let sessions = state.auth_sessions.lock().await;
        sessions
            .get(&auth::token_key(&token))
            .filter(|s| auth::session_device_is_valid(&state.data_dir, &state.hw_salt, s))
            .map(|s| s.user_id.clone())
            .ok_or(StatusCode::UNAUTHORIZED)?
    };
    let role = auth::user_role_for_id(&state.data_dir, &user_id).unwrap_or_default();
    if role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(user_id)
}

/// Username behind the admin token — the `by` field on audit entries.
async fn admin_name(state: &AppState, headers: &HeaderMap) -> String {
    let Some(token) = auth::bearer_token(headers) else {
        return "unknown".into();
    };
    let user_id = {
        let sessions = state.auth_sessions.lock().await;
        sessions.get(&auth::token_key(&token))
            .filter(|s| auth::session_device_is_valid(&state.data_dir, &state.hw_salt, s))
            .map(|s| s.user_id.clone())
    };
    user_id
        .and_then(|id| auth::username_for_id(&state.data_dir, &id))
        .unwrap_or_else(|| "unknown".into())
}

fn reject_self_target(admin_id: &str, target_user_id: &str) -> Result<(), StatusCode> {
    if admin_id == target_user_id {
        return Err(StatusCode::CONFLICT);
    }
    Ok(())
}

// ── Audit ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AuditQuery {
    /// Comma-separated event names, or "revocations" for every revoke type.
    pub events: Option<String>,
    pub limit: Option<usize>,
    pub user: Option<String>,
    pub search: Option<String>,
}

const REVOCATION_EVENTS: [&str; 3] = ["user_revoked", "device_revoked", "key_revoked"];

/// GET /api/admin/audit?events=revocations&limit=100
pub async fn get_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AuditQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_admin(&headers, &state).await?;
    let limit = q.limit.unwrap_or(200).min(1000);
    let filter = q.events.unwrap_or_default();
    let user = q.user.unwrap_or_default().trim().to_lowercase();
    let search = q.search.unwrap_or_default().trim().to_lowercase();
    let entries = match filter.trim() {
        "" => crate::audit::read(&state.data_dir, None, 1000),
        "revocations" => crate::audit::read(&state.data_dir, Some(&REVOCATION_EVENTS), 1000),
        list => {
            let names: Vec<&str> = list.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
            crate::audit::read(&state.data_dir, Some(&names), 1000)
        }
    };
    let entries = entries
        .into_iter()
        .filter(|entry| {
            if !user.is_empty() {
                let entry_user = entry
                    .get("user")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_lowercase();
                if !entry_user.contains(&user) {
                    return false;
                }
            }
            search.is_empty() || entry.to_string().to_lowercase().contains(&search)
        })
        .take(limit)
        .collect::<Vec<_>>();
    Ok(Json(json!({ "entries": entries })))
}

/// DELETE /api/admin/audit — clears the trail and records who cleared it.
pub async fn clear_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_admin(&headers, &state).await?;
    let removed = crate::audit::clear(&state.data_dir)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    crate::audit::log(
        &state.data_dir,
        "audit_cleared",
        json!({
            "removed": removed,
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );
    Ok(Json(json!({ "ok": true, "removed": removed })))
}

// ── Users ─────────────────────────────────────────────────────────────────────

/// GET /api/admin/users
pub async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_admin(&headers, &state).await?;
    let users = auth::list_users_for_admin(&state.data_dir, &state.hw_salt)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "users": users })))
}

/// POST /api/admin/users/{id}/revoke — kicks the user immediately.
pub async fn revoke_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let admin_id = require_admin(&headers, &state).await?;
    reject_self_target(&admin_id, &user_id)?;
    let _guard = state.auth_mutex.lock().await;

    if !auth::user_exists(&state.data_dir, &user_id) {
        return Err(StatusCode::NOT_FOUND);
    }

    // Block the account (don't drop the session): the user's app stays open and
    // shows "access revoked" while every download/catalog request is denied.
    auth::revoke_user(&state.data_dir, &state.hw_salt, &user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    crate::audit::log(
        &state.data_dir,
        "user_revoked",
        json!({
            "user": auth::username_for_id(&state.data_dir, &user_id).unwrap_or_else(|| user_id.clone()),
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );

    Ok(Json(json!({ "ok": true })))
}

/// POST /api/admin/users — creates a user and returns a one-time invite code.
#[derive(serde::Deserialize)]
pub struct CreateUserBody {
    pub username: String,
    #[serde(default)]
    pub role: Option<String>,
}

pub async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateUserBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&headers, &state)
        .await
        .map_err(|c| (c, Json(json!({ "error": "forbidden" }))))?;
    let _guard = state.auth_mutex.lock().await;

    let role = body.role.as_deref().unwrap_or("user");
    match auth::create_user(&state.data_dir, &body.username, role) {
        Ok((id, key)) => {
            crate::audit::log(
                &state.data_dir,
                "user_created",
                json!({
                    "user": body.username.trim(),
                    "role": role,
                    "by": admin_name(&state, &headers).await,
                    "ip": crate::audit::client_ip(&headers),
                }),
            );
            Ok(Json(json!({ "ok": true, "id": id, "username": body.username.trim(), "setupKey": key })))
        }
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(json!({ "error": e.to_string() })))),
    }
}

/// DELETE /api/admin/users/{id} — removes the user entirely.
pub async fn delete_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let admin_id = require_admin(&headers, &state).await?;
    reject_self_target(&admin_id, &user_id)?;
    let _guard = state.auth_mutex.lock().await;

    let name = auth::username_for_id(&state.data_dir, &user_id).unwrap_or_else(|| user_id.clone());
    let removed = auth::delete_user(&state.data_dir, &state.hw_salt, &user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !removed {
        return Err(StatusCode::NOT_FOUND);
    }

    // Drop live sessions — a deleted account has no app to keep open.
    {
        let mut sessions = state.auth_sessions.lock().await;
        sessions.retain(|_, s| s.user_id != user_id);
        auth::save_active_sessions(&state.data_dir, &sessions);
    }

    crate::audit::log(
        &state.data_dir,
        "user_deleted",
        json!({
            "user": name,
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );

    Ok(Json(json!({ "ok": true })))
}

/// POST /api/admin/users/{id}/devices/{hash}/revoke — kicks one machine.
pub async fn revoke_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((user_id, hw_hash)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let admin_id = require_admin(&headers, &state).await?;
    reject_self_target(&admin_id, &user_id)?;
    let _guard = state.auth_mutex.lock().await;

    let removed = auth::revoke_device(&state.data_dir, &state.hw_salt, &user_id, &hw_hash)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !removed {
        return Err(StatusCode::NOT_FOUND);
    }

    // Kill live sessions bound to that machine.
    let revoked = {
        let mut sessions = state.auth_sessions.lock().await;
        let before = sessions.len();
        sessions.retain(|_, s| {
            !(s.user_id == user_id && s.login_hardware_uuid.as_deref() == Some(hw_hash.as_str()))
        });
        let n = before - sessions.len();
        auth::save_active_sessions(&state.data_dir, &sessions);
        n
    };

    crate::audit::log(
        &state.data_dir,
        "device_revoked",
        json!({
            "user": auth::username_for_id(&state.data_dir, &user_id).unwrap_or_else(|| user_id.clone()),
            "device": hw_hash,
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );

    Ok(Json(json!({ "ok": true, "sessionsRevoked": revoked })))
}

/// POST /api/admin/users/{id}/key/revoke — cancels a pending unused code.
pub async fn revoke_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_admin(&headers, &state).await?;
    let _guard = state.auth_mutex.lock().await;

    let removed = auth::revoke_setup_key(&state.data_dir, &user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !removed {
        return Err(StatusCode::NOT_FOUND);
    }
    crate::audit::log(
        &state.data_dir,
        "key_revoked",
        json!({
            "user": auth::username_for_id(&state.data_dir, &user_id).unwrap_or_else(|| user_id.clone()),
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );
    Ok(Json(json!({ "ok": true })))
}

/// POST /api/admin/users/{id}/key — returns the new key once.
pub async fn issue_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    require_admin(&headers, &state).await?;
    let _guard = state.auth_mutex.lock().await;

    if !auth::user_exists(&state.data_dir, &user_id) {
        return Err(StatusCode::NOT_FOUND);
    }

    let key = auth::issue_setup_key(&state.data_dir, &user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    crate::audit::log(
        &state.data_dir,
        "key_issued",
        json!({
            "user": auth::username_for_id(&state.data_dir, &user_id).unwrap_or_else(|| user_id.clone()),
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );
    Ok(Json(json!({ "ok": true, "setupKey": key })))
}

// ── GET /api/admin/catalog-meta ───────────────────────────────────────────────

#[derive(Serialize)]
pub struct MetaListResponse {
    pub ids: Vec<String>,
}

pub async fn list_catalog_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MetaListResponse>, StatusCode> {
    require_admin(&headers, &state).await?;
    let ids = list_meta_ids(&state.data_dir).map_err(|e| {
        tracing::error!(err = %e, "list_meta_ids failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(Json(MetaListResponse { ids }))
}

// ── GET /api/admin/catalog-meta/:id ──────────────────────────────────────────

pub async fn get_catalog_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<CatalogMeta>, StatusCode> {
    require_admin(&headers, &state).await?;
    if id.contains("..") || id.contains('/') {
        return Err(StatusCode::BAD_REQUEST);
    }
    match load_meta_for_admin_path(&state.data_dir, &id) {
        Ok(Some(meta)) => Ok(Json(meta)),
        Ok(None) => {
            // Return a draft stub so the editor has something to work with
            // even for games that were never explicitly imported yet.
            let stub = CatalogMeta::new_draft(&id, &id);
            Ok(Json(stub))
        }
        Err(e) => {
            tracing::error!(id, err = %e, "load_meta failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// ── PUT /api/admin/catalog-meta/:id ──────────────────────────────────────────

pub async fn put_catalog_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut meta): Json<CatalogMeta>,
) -> Result<Json<CatalogMeta>, StatusCode> {
    require_admin(&headers, &state).await?;
    if id.contains("..") || id.contains('/') {
        return Err(StatusCode::BAD_REQUEST);
    }
    // Ensure id from path matches body; also re-derive emulator flag.
    meta.id = id.clone();
    meta.slug = id.clone();
    meta.recompute_emulator();
    meta.touch();

    let existed = matches!(load_meta_for_admin_path(&state.data_dir, &id), Ok(Some(_)));

    save_meta(&state.data_dir, &meta).map_err(|e| {
        tracing::error!(id, err = %e, "save_meta failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    crate::audit::log(
        &state.data_dir,
        if existed { "game_updated" } else { "game_added" },
        json!({
            "game": id,
            "title": meta.display_name,
            "by": admin_name(&state, &headers).await,
            "ip": crate::audit::client_ip(&headers),
        }),
    );

    crate::catalog_revision::bump_catalog_revision(&state);

    Ok(Json(meta))
}

// ── GET /api/admin/igdb/search ────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct IgdbSearchQuery {
    pub q: String,
    pub limit: Option<u8>,
}

#[derive(Serialize)]
pub struct IgdbSearchResponse {
    pub results: Vec<crate::igdb::IgdbSearchResult>,
}

pub async fn igdb_search(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<IgdbSearchQuery>,
) -> Result<Json<IgdbSearchResponse>, (StatusCode, String)> {
    require_admin(&headers, &state)
        .await
        .map_err(|s| (s, "Admin access required".into()))?;
    let client = state.igdb.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "IGDB credentials not configured (set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET)".into(),
        )
    })?;

    let limit = params.limit.unwrap_or(8);
    let results = client
        .search(&params.q, limit)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    Ok(Json(IgdbSearchResponse { results }))
}

// ── GET /api/admin/igdb/game/:igdb_id ─────────────────────────────────────────

pub async fn igdb_fetch_game(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(igdb_id): Path<u64>,
) -> Result<Json<crate::igdb::IgdbMeta>, (StatusCode, String)> {
    require_admin(&headers, &state)
        .await
        .map_err(|s| (s, "Admin access required".into()))?;
    let client = state.igdb.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "IGDB credentials not configured".into(),
        )
    })?;

    let meta = client
        .fetch_game(igdb_id)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    Ok(Json(meta))
}

// ── GET /api/admin/manifests/:id ─────────────────────────────────────────────

/// Admin manifest endpoint — requires a valid admin session token.
/// Used by the import editor to load file lists for launch target selection.
pub async fn get_admin_manifest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, Response> {
    require_admin(&headers, &state)
        .await
        .map_err(|s| (s, Json(json!({"error": "Admin access required"}))).into_response())?;
    // Basic path validation
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "BAD_REQUEST", "message": "Invalid manifest ID" })),
        )
            .into_response());
    }

    let path = state.data_dir.join("manifests").join(format!("{id}.json"));
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "NOT_FOUND", "message": "Manifest not found" })),
            )
                .into_response());
        }
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Body::from(bytes))
        .unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_admin_cannot_target_self() {
        assert_eq!(reject_self_target("admin-1", "admin-1"), Err(StatusCode::CONFLICT));
        assert_eq!(reject_self_target("admin-1", "user-2"), Ok(()));
    }
}
