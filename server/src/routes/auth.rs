use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::json;

use crate::auth;
use crate::state::{AppState, AuthSession};

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
    ) {
        Ok(res) => {
            // Every role, including admins, is bound to the enrolled machine.
            // The session stores only the salted fingerprint, never the SMBIOS UUID.
            let login_hardware_uuid = body
                .hardware_uuid
                .as_deref()
                .and_then(auth::normalize_hardware_uuid)
                .map(|u| auth::hash_hardware(&state.hw_salt, &u));
            // Keyed by token hash — the sessions file never holds raw credentials.
            let now = chrono::Utc::now().timestamp();
            let mut sessions = state.auth_sessions.lock().await;
            sessions.insert(
                auth::token_key(&res.token),
                AuthSession {
                    user_id: res.user.id.clone(),
                    login_hardware_uuid: login_hardware_uuid.clone(),
                    created_at: now,
                    expires_at: now + 30 * 24 * 60 * 60,
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
                    "device": login_hardware_uuid.as_deref().map(|h| &h[..12.min(h.len())]),
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

type ApiError = (StatusCode, Json<serde_json::Value>);

#[derive(Clone)]
struct SessionContext {
    user_id: String,
    session_id: String,
    device_hash: Option<String>,
}

fn is_current_device(current: &SessionContext, hw_hash: &str) -> bool {
    current.device_hash.as_deref() == Some(hw_hash)
}

fn is_current_session(current: &SessionContext, session_id: &str) -> bool {
    current.session_id == session_id
}

async fn require_session(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<SessionContext, ApiError> {
    let token = auth::bearer_token(headers).ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Missing Authorization" })),
    ))?;
    let session_id = auth::token_key(&token);
    let sessions = state.auth_sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .filter(|s| auth::session_device_is_valid(&state.data_dir, &state.hw_salt, s))
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid session" })),
        ))?;
    Ok(SessionContext {
        user_id: session.user_id.clone(),
        session_id,
        device_hash: session.login_hardware_uuid.clone(),
    })
}

/// Account security inventory. Session IDs are one-way token hashes, never credentials.
pub async fn get_security(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let current = require_session(&headers, &state).await?;
    let list = auth::hardware_enrollments_for_user(
        &state.data_dir,
        &state.hw_salt,
        &current.user_id,
    );
    let hostnames = list
        .iter()
        .map(|device| (device.hw_hash.clone(), device.hostname.clone()))
        .collect::<std::collections::HashMap<_, _>>();
    let devices = list
        .into_iter()
        .map(|device| {
            let is_current = current.device_hash.as_deref() == Some(device.hw_hash.as_str());
            json!({
                "hwHash": device.hw_hash,
                "hostname": device.hostname,
                "enrolledAt": device.enrolled_at,
                "lastSeenAt": device.last_seen_at,
                "lastDownloadAt": device.last_download_at,
                "current": is_current,
            })
        })
        .collect::<Vec<_>>();

    let mut active = {
        let sessions = state.auth_sessions.lock().await;
        sessions
            .iter()
            .filter(|(_, session)| {
                session.user_id == current.user_id
                    && auth::session_device_is_valid(&state.data_dir, &state.hw_salt, session)
            })
            .map(|(session_id, session)| {
                let device_hash = session.login_hardware_uuid.clone();
                let hostname = device_hash
                    .as_ref()
                    .and_then(|hash| hostnames.get(hash))
                    .cloned()
                    .unwrap_or_else(|| "Unknown device".to_string());
                json!({
                    "sessionId": session_id,
                    "deviceHash": device_hash,
                    "hostname": hostname,
                    "createdAt": session.created_at,
                    "expiresAt": session.expires_at,
                    "current": session_id == &current.session_id,
                })
            })
            .collect::<Vec<_>>()
    };
    active.sort_by(|a, b| {
        b.get("current")
            .and_then(|v| v.as_bool())
            .cmp(&a.get("current").and_then(|v| v.as_bool()))
            .then_with(|| {
                b.get("createdAt")
                    .and_then(|v| v.as_i64())
                    .cmp(&a.get("createdAt").and_then(|v| v.as_i64()))
            })
    });
    Ok(Json(json!({ "devices": devices, "sessions": active })))
}

/// Removes an old enrolled machine and every session bound to it.
/// The current machine is deliberately immutable from the account screen.
pub async fn delete_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hw_hash): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let current = require_session(&headers, &state).await?;
    if is_current_device(&current, &hw_hash) {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "error": "CURRENT_DEVICE" })),
        ));
    }

    let _guard = state.auth_mutex.lock().await;
    let removed = auth::revoke_device(
        &state.data_dir,
        &state.hw_salt,
        &current.user_id,
        &hw_hash,
    )
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Could not remove device" })),
        )
    })?;
    if !removed {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Device not found" })),
        ));
    }

    let sessions_revoked = {
        let mut sessions = state.auth_sessions.lock().await;
        let before = sessions.len();
        sessions.retain(|_, session| {
            !(session.user_id == current.user_id
                && session.login_hardware_uuid.as_deref() == Some(hw_hash.as_str()))
        });
        let removed = before - sessions.len();
        auth::save_active_sessions(&state.data_dir, &sessions);
        removed
    };
    crate::audit::log(
        &state.data_dir,
        "device_self_revoked",
        json!({
            "user": auth::username_for_id(&state.data_dir, &current.user_id)
                .unwrap_or_else(|| current.user_id.clone()),
            "device": hw_hash,
            "sessionsRevoked": sessions_revoked,
            "ip": crate::audit::client_ip(&headers),
        }),
    );
    Ok(Json(json!({ "ok": true, "sessionsRevoked": sessions_revoked })))
}

/// Signs out one other session. The current session cannot delete itself here.
pub async fn delete_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let current = require_session(&headers, &state).await?;
    if is_current_session(&current, &session_id) {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({ "error": "CURRENT_SESSION" })),
        ));
    }
    let removed = {
        let mut sessions = state.auth_sessions.lock().await;
        let belongs_to_user = sessions
            .get(&session_id)
            .map(|session| session.user_id == current.user_id)
            .unwrap_or(false);
        if belongs_to_user {
            sessions.remove(&session_id);
            auth::save_active_sessions(&state.data_dir, &sessions);
        }
        belongs_to_user
    };
    if !removed {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Session not found" })),
        ));
    }
    crate::audit::log(
        &state.data_dir,
        "session_self_revoked",
        json!({
            "user": auth::username_for_id(&state.data_dir, &current.user_id)
                .unwrap_or_else(|| current.user_id.clone()),
            "session": &session_id[..12.min(session_id.len())],
            "ip": crate::audit::client_ip(&headers),
        }),
    );
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> SessionContext {
        SessionContext {
            user_id: "user-1".into(),
            session_id: "session-current".into(),
            device_hash: Some("device-current".into()),
        }
    }

    #[test]
    fn current_device_is_protected() {
        let current = context();
        assert!(is_current_device(&current, "device-current"));
        assert!(!is_current_device(&current, "device-old"));
    }

    #[test]
    fn current_session_is_protected() {
        let current = context();
        assert!(is_current_session(&current, "session-current"));
        assert!(!is_current_session(&current, "session-old"));
    }
}
