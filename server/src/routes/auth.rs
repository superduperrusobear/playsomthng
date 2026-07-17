use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;

use crate::auth;
use crate::state::{AppState, AuthSession};

const MAX_AVATAR_BYTES: usize = 2_500_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBody {
    pub username: String,
    pub setup_key: String,
    #[serde(default)]
    pub hardware_uuid: Option<String>,
    /// Machine's hostname — the human-readable device name shown to admins.
    #[serde(default)]
    pub hostname: Option<String>,
    /// Device public key (base64 raw ed25519) — registered at enrollment.
    #[serde(default)]
    pub public_key: Option<String>,
    /// Challenge nonce from POST /api/auth/challenge, signed by the device key.
    #[serde(default)]
    pub nonce: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChallengeBody {
    pub username: String,
}

const CHALLENGE_TTL_SECS: u64 = 120;

/// POST /api/auth/challenge — hands out a one-time nonce for the device to sign.
pub async fn post_challenge(
    State(state): State<AppState>,
    Json(body): Json<ChallengeBody>,
) -> Json<serde_json::Value> {
    let nonce = uuid::Uuid::new_v4().to_string();
    let mut challenges = state.auth_challenges.lock().await;
    let now = std::time::Instant::now();
    challenges.retain(|_, (_, at)| now.duration_since(*at).as_secs() < CHALLENGE_TTL_SECS);
    challenges.insert(nonce.clone(), (body.username.trim().to_lowercase(), now));
    Json(json!({ "nonce": nonce }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarUploadBody {
    pub image_base64: String,
    pub content_type: String,
}

fn ext_for_mime(ct: &str) -> &'static str {
    let c = ct.to_ascii_lowercase();
    if c.contains("png") {
        return "png";
    }
    if c.contains("webp") {
        return "webp";
    }
    if c.contains("gif") {
        return "gif";
    }
    "jpg"
}

fn mime_for_ext(path: &std::path::Path) -> &'static str {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

fn remove_old_avatars(dir: &std::path::Path, user_id: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with(user_id) && name.as_bytes().get(user_id.len()) == Some(&b'.') {
            let _ = std::fs::remove_file(&path);
        }
    }
}

pub async fn post_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Result<Json<auth::LoginResponse>, (StatusCode, Json<serde_json::Value>)> {
    let _guard = state.auth_mutex.lock().await;
    let ip = crate::audit::client_ip(&headers);

    // Consume the nonce (one-time): it must exist, be fresh, and belong to this username.
    let verified_nonce: Option<String> = if let Some(n) = body.nonce.as_deref() {
        let mut challenges = state.auth_challenges.lock().await;
        match challenges.remove(n) {
            Some((user, at))
                if user == body.username.trim().to_lowercase()
                    && at.elapsed().as_secs() < CHALLENGE_TTL_SECS =>
            {
                Some(n.to_string())
            }
            _ => None,
        }
    } else {
        None
    };

    let hw = body.hardware_uuid.as_deref();
    let origin = state.config.public_api_origin();
    match auth::login(
        &state.data_dir,
        &state.hw_salt,
        &body.username,
        &body.setup_key,
        hw,
        body.hostname.as_deref(),
        body.public_key.as_deref(),
        verified_nonce.as_deref(),
        body.signature.as_deref(),
        &origin,
    ) {
        Ok(res) => {
            // Session stores the salted hash, never the raw SMBIOS UUID.
            let login_hardware_uuid = if res.user.role == "admin" {
                None
            } else {
                body.hardware_uuid
                    .as_deref()
                    .and_then(auth::normalize_hardware_uuid)
                    .map(|u| auth::hash_hardware(&state.hw_salt, &u))
            };
            // Keyed by token hash — the sessions file never holds raw credentials.
            let mut sessions = state.auth_sessions.lock().await;
            sessions.insert(
                auth::token_key(&res.token),
                AuthSession {
                    user_id: res.user.id.clone(),
                    login_hardware_uuid,
                },
            );
            auth::save_active_sessions(&state.data_dir, &sessions);
            crate::audit::log(
                &state.data_dir,
                "login",
                json!({
                    "user": res.user.username,
                    "role": res.user.role,
                    "ip": ip,
                    "hostname": body.hostname.as_deref().unwrap_or(""),
                    "enrolled": !body.setup_key.trim().is_empty(),
                }),
            );
            Ok(Json(res))
        }
        Err(msg) => {
            // SETUP_KEY_REQUIRED is the normal "new machine" probe, not a denial.
            if msg != "SETUP_KEY_REQUIRED" {
                crate::audit::log(
                    &state.data_dir,
                    "login_denied",
                    json!({ "user": body.username, "ip": ip, "reason": msg }),
                );
            }
            let code = if msg == "ACCOUNT_REVOKED" {
                StatusCode::FORBIDDEN
            } else if msg.contains("Invalid username")
                || msg == "SETUP_KEY_REQUIRED"
                || msg == "UNKNOWN_USERNAME"
            {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::BAD_REQUEST
            };
            Err((code, Json(json!({ "error": msg }))))
        }
    }
}

pub async fn post_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AvatarUploadBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let token = auth::bearer_token(&headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Missing Authorization" })),
    ))?;
    let user_id = {
        let sessions = state.auth_sessions.lock().await;
        sessions.get(&auth::token_key(&token)).map(|s| s.user_id.clone()).ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid session" })),
        ))?
    };

    let bytes = B64.decode(body.image_base64.trim()).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid base64 image" })),
        )
    })?;

    if bytes.is_empty() || bytes.len() > MAX_AVATAR_BYTES {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Image too large or empty" })),
        ));
    }

    let dir = state.data_dir.join("auth").join("avatars");
    std::fs::create_dir_all(&dir).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Could not create avatar directory" })),
        )
    })?;

    remove_old_avatars(&dir, &user_id);
    let ext = ext_for_mime(&body.content_type);
    let path: PathBuf = dir.join(format!("{user_id}.{ext}"));
    std::fs::write(&path, &bytes).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Could not save avatar" })),
        )
    })?;

    let origin = state.config.public_api_origin();
    let avatar_url = format!(
        "{}/api/auth/avatars/{}",
        origin.trim_end_matches('/'),
        user_id
    );
    Ok(Json(json!({ "avatarUrl": avatar_url })))
}

pub async fn get_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let token = auth::bearer_token(&headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Missing Authorization" })),
    ))?;
    let user_id = {
        let sessions = state.auth_sessions.lock().await;
        sessions.get(&auth::token_key(&token)).map(|s| s.user_id.clone()).ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid session" })),
        ))?
    };
    let list = auth::hardware_enrollments_for_user(&state.data_dir, &state.hw_salt, &user_id);
    let devices = list
        .into_iter()
        .map(|d| json!({ "hwHash": d.hw_hash, "hostname": d.hostname, "enrolledAt": d.enrolled_at }))
        .collect::<Vec<_>>();
    Ok(Json(json!({ "devices": devices })))
}

pub async fn get_avatar(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Response<Body>, StatusCode> {
    uuid::Uuid::parse_str(&user_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let path = auth::find_avatar_path(&state.data_dir, &user_id).ok_or(StatusCode::NOT_FOUND)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let ct = mime_for_ext(&path);
    let mut res = Response::new(Body::from(bytes));
    res.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(ct));
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    Ok(res)
}
