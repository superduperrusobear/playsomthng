use axum::{
    Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::json;
use std::io::SeekFrom;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::auth;
use crate::download_governor::{BusyKind, StreamWithPermits, retry_after_seconds};
use crate::state::AppState;

/// Gate a download: valid bearer session and the `X-Hardware-Uuid` header must
/// match the machine bound to this session at login. Admins are not exempt.
///
/// The hardware id travels in the header only — never in the query string —
/// so it does not leak into reverse-proxy / CDN access logs.
async fn require_download_access(
    headers: &HeaderMap,
    state: &AppState,
    game_id: &str,
) -> Result<(String, String), Response> {
    match check_download_access(headers, state).await {
        Ok(user_id) => Ok(user_id),
        Err((code, res)) => {
            // Refusals here are security-relevant: revoked, wrong machine, or bad signature.
            crate::audit::log(
                &state.data_dir,
                "access_denied",
                serde_json::json!({
                    "game": game_id,
                    "ip": crate::audit::client_ip(headers),
                    "reason": code,
                }),
            );
            Err(res)
        }
    }
}

async fn check_download_access(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<(String, String), (&'static str, Response)> {
    let token = auth::bearer_token(headers).ok_or_else(|| {
        (
            "no_token",
            json_err(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Missing or invalid Authorization header",
            ),
        )
    })?;

    let entry = {
        let sessions = state.auth_sessions.lock().await;
        sessions.get(&auth::token_key(&token))
            .filter(|s| auth::session_device_is_valid(&state.data_dir, &state.hw_salt, s))
            .cloned().ok_or_else(|| {
            (
                "bad_session",
                json_err(
                    StatusCode::UNAUTHORIZED,
                    "UNAUTHORIZED",
                    "Invalid or expired session",
                ),
            )
        })?
    };

    let user_id = entry.user_id.clone();

    // Revoked or deleted account: deny with a distinct code so the client shows
    // "contact your administrator" and keeps the user in the app (not kicked out).
    match auth::account_state(&state.data_dir, &user_id) {
        auth::AccountState::Active => {}
        _ => {
            return Err((
                "account_revoked",
                json_err(
                    StatusCode::FORBIDDEN,
                    "ACCOUNT_REVOKED",
                    "Your access has been revoked — contact your administrator.",
                ),
            ));
        }
    }

    let hw_raw = headers
        .get("x-hardware-uuid")
        .and_then(|x| x.to_str().ok())
        .ok_or_else(|| {
            (
                "no_hardware_header",
                json_err(
                    StatusCode::FORBIDDEN,
                    "MISSING_HARDWARE_HEADER",
                    "X-Hardware-Uuid header is required for downloads",
                ),
            )
        })?;

    let hw_header = auth::normalize_hardware_uuid(hw_raw).ok_or_else(|| {
        (
            "bad_hardware_uuid",
            json_err(
                StatusCode::FORBIDDEN,
                "INVALID_HARDWARE_UUID",
                "Could not normalize hardware UUID",
            ),
        )
    })?;
    // Sessions store the salted hash — hash the incoming header before comparing.
    let hw_hash = auth::hash_hardware(&state.hw_salt, &hw_header);

    let expected = entry.login_hardware_uuid.ok_or_else(|| {
        (
            "session_not_bound",
            json_err(
                StatusCode::FORBIDDEN,
                "SESSION_NO_HARDWARE",
                "Session is not bound to a machine; sign in again from this PC",
            ),
        )
    })?;

    if hw_hash != expected {
        return Err((
            "wrong_machine",
            json_err(
                StatusCode::FORBIDDEN,
                "HARDWARE_NOT_SESSION_MACHINE",
                "Hardware UUID must match the machine used at login",
            ),
        ));
    }

    // Streams start only with proof of the device's private key: a fresh,
    // unreplayed `ts.nonce.signature` header verified against the enrolled key.
    let pub_key = auth::device_pub_key(&state.data_dir, &state.hw_salt, &user_id, &hw_hash)
        .ok_or_else(|| {
            (
                "device_revoked",
                json_err(
                    StatusCode::FORBIDDEN,
                    "DEVICE_KEY_REQUIRED",
                    "This device has no registered key — sign in again",
                ),
            )
        })?;
    verify_download_auth(headers, state, &pub_key).await?;

    Ok((user_id, hw_hash))
}

const DOWNLOAD_AUTH_WINDOW_SECS: i64 = 120;
const AUDIT_DEDUPE_SECS: u64 = 600;

/// One audit line per user+game per window — an install is one entry, not thousands.
async fn audit_download(
    state: &AppState,
    headers: &HeaderMap,
    user_id: &str,
    hw_hash: &str,
    game_id: &str,
) {
    let key = format!("{user_id}:{game_id}");
    {
        let mut recent = state.audit_recent.lock().await;
        let now = std::time::Instant::now();
        recent.retain(|_, at| now.duration_since(*at).as_secs() < AUDIT_DEDUPE_SECS);
        if recent.contains_key(&key) {
            return;
        }
        recent.insert(key, now);
    }
    {
        let _guard = state.auth_mutex.lock().await;
        if let Err(err) = auth::mark_device_download(
            &state.data_dir,
            &state.hw_salt,
            user_id,
            hw_hash,
        ) {
            tracing::warn!(%err, "could not update device download activity");
        }
    }
    crate::audit::log(
        &state.data_dir,
        "download",
        serde_json::json!({
            "user": crate::auth::username_for_id(&state.data_dir, user_id).unwrap_or_else(|| user_id.to_string()),
            "game": game_id,
            "ip": crate::audit::client_ip(headers),
            "device": &hw_hash[..12.min(hw_hash.len())],
        }),
    );
}

async fn verify_download_auth(
    headers: &HeaderMap,
    state: &AppState,
    pub_key: &str,
) -> Result<(), (&'static str, Response)> {
    let raw = headers
        .get("x-download-auth")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                "no_signature",
                json_err(
                    StatusCode::FORBIDDEN,
                    "DOWNLOAD_AUTH_REQUIRED",
                    "X-Download-Auth header is required — update your launcher",
                ),
            )
        })?;

    let bad = || {
        (
            "bad_signature",
            json_err(
                StatusCode::FORBIDDEN,
                "DOWNLOAD_AUTH_INVALID",
                "Download signature rejected — check your system clock and sign in again",
            ),
        )
    };

    let mut parts = raw.splitn(3, '.');
    let (Some(ts), Some(nonce), Some(sig)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(bad());
    };
    let ts_num: i64 = ts.parse().map_err(|_| bad())?;
    let now = chrono::Utc::now().timestamp();
    if (now - ts_num).abs() > DOWNLOAD_AUTH_WINDOW_SECS {
        return Err(bad());
    }

    {
        let mut seen = state.download_nonces.lock().await;
        let now_i = std::time::Instant::now();
        seen.retain(|_, at| {
            now_i.duration_since(*at).as_secs() < (DOWNLOAD_AUTH_WINDOW_SECS as u64 * 2)
        });
        if seen.insert(nonce.to_string(), now_i).is_some() {
            return Err(bad());
        }
    }

    if !auth::verify_device_signature(pub_key, &format!("{ts}.{nonce}"), sig) {
        return Err(bad());
    }
    Ok(())
}

/// Parses `Range: bytes=start-end` into an inclusive (start, end).
/// `None` means unsatisfiable — caller replies 416. Multi-range is not supported.
fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let spec = header.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (raw_start, raw_end) = spec.split_once('-')?;
    let last = size - 1;

    let (start, end) = match (raw_start.trim(), raw_end.trim()) {
        ("", "") => return None,
        // bytes=-N → final N bytes
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            if n == 0 {
                return None;
            }
            (size.saturating_sub(n), last)
        }
        (s, "") => (s.parse().ok()?, last),
        (s, e) => {
            let start: u64 = s.parse().ok()?;
            let end: u64 = e.parse().ok()?;
            (start, end.min(last))
        }
    };

    if start > end || start > last {
        return None;
    }
    Some((start, end))
}

fn json_err(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (
        status,
        Json(json!({
            "error": code,
            "message": message,
        })),
    )
        .into_response()
}

/// Governor rejection: log who was turned away and why, then build the 503.
async fn busy_denied(state: &AppState, headers: &HeaderMap, user_id: &str, game_id: &str, kind: BusyKind) -> Response {
    crate::audit::log(
        &state.data_dir,
        "download_denied",
        serde_json::json!({
            "user": crate::auth::username_for_id(&state.data_dir, user_id).unwrap_or_else(|| user_id.to_string()),
            "game": game_id,
            "ip": crate::audit::client_ip(headers),
            "reason": match kind {
                BusyKind::Global => "server_full",
                BusyKind::User => "already_downloading",
            },
        }),
    );
    server_busy(kind)
}

fn server_busy(kind: BusyKind) -> Response {
    let retry_after = retry_after_seconds(kind);
    let (msg, reason) = match kind {
        BusyKind::Global => (
            "Server download slots are full (max 2 users). Your download is queued - retry shortly.",
            "global_busy",
        ),
        BusyKind::User => (
            "You already have an active download from this server. Finish it or wait - only one stream per account.",
            "user_busy",
        ),
    };
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": "SERVER_BUSY",
            "message": msg,
            "retryAfterSeconds": retry_after,
            "reason": reason,
        })),
    )
        .into_response()
}

#[cfg(test)]
mod range_tests {
    use super::parse_range;

    #[test]
    fn open_ended_resumes_from_offset() {
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
    }

    #[test]
    fn explicit_end_is_inclusive() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
    }

    #[test]
    fn end_past_eof_clamps() {
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
    }

    #[test]
    fn suffix_returns_last_n_bytes() {
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
    }

    #[test]
    fn suffix_larger_than_file_returns_whole_file() {
        assert_eq!(parse_range("bytes=-5000", 1000), Some((0, 999)));
    }

    #[test]
    fn last_byte_is_satisfiable() {
        assert_eq!(parse_range("bytes=999-", 1000), Some((999, 999)));
    }

    #[test]
    fn start_at_eof_is_unsatisfiable() {
        assert_eq!(parse_range("bytes=1000-", 1000), None);
    }

    #[test]
    fn backwards_range_rejected() {
        assert_eq!(parse_range("bytes=500-100", 1000), None);
    }

    #[test]
    fn multi_range_unsupported() {
        assert_eq!(parse_range("bytes=0-10,20-30", 1000), None);
    }

    #[test]
    fn garbage_rejected() {
        assert_eq!(parse_range("bytes=abc-def", 1000), None);
        assert_eq!(parse_range("items=0-10", 1000), None);
        assert_eq!(parse_range("bytes=-", 1000), None);
    }

    #[test]
    fn empty_file_is_unsatisfiable() {
        assert_eq!(parse_range("bytes=0-", 0), None);
    }
}

/// GET /manifests/{id} - reads `dataDir/manifests/{id}.json`.
pub async fn get_manifest_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, Response> {
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "BAD_REQUEST" })),
        )
            .into_response());
    }

    let (user_id, hw_hash) = require_download_access(&headers, &state, &id).await?;
    audit_download(&state, &headers, &user_id, &hw_hash, &id).await;
    let permits = match state.download_governor.try_acquire(&user_id).await {
        Ok(p) => p,
        Err(kind) => return Err(busy_denied(&state, &headers, &user_id, &id, kind).await),
    };

    let path = state.data_dir.join("manifests").join(format!("{id}.json"));
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => {
            drop(permits);
            return Err(StatusCode::NOT_FOUND.into_response());
        }
    };

    drop(permits);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Body::from(bytes))
        .unwrap())
}

/// GET /cdn/{id}/{*rest} - stream files from the scanned game folder.
/// Uses chunked streaming so files of any size (even >4 GB) work on Windows.
pub async fn get_local_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, rest)): Path<(String, String)>,
) -> Result<Response, Response> {
    if id.contains("..") || rest.contains("..") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "BAD_REQUEST" })),
        )
            .into_response());
    }

    let (user_id, hw_hash) = require_download_access(&headers, &state, &id).await?;
    audit_download(&state, &headers, &user_id, &hw_hash, &id).await;
    let permits = match state.download_governor.try_acquire(&user_id).await {
        Ok(p) => p,
        Err(kind) => return Err(busy_denied(&state, &headers, &user_id, &id, kind).await),
    };

    let mut root = {
        let map = state.local_paths.read().await;
        map.get(&id).cloned()
    };

    if root.is_none() {
        // If the server restarted, local_paths might be empty until the first catalog fetch.
        // Force a catalog rebuild to populate local_paths.
        crate::catalog::get_catalog(&state).await;
        let map = state.local_paths.read().await;
        root = map.get(&id).cloned();
    }

    let Some(game_root) = root else {
        tracing::warn!(id = %id, "cdn 404: game_root not found in local_paths");
        drop(permits);
        return Err(StatusCode::NOT_FOUND.into_response());
    };

    let mut segments: Vec<String> = rest
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            urlencoding::decode(s)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| s.to_string())
        })
        .collect();
    let mut full = game_root.clone();
    for part in &segments {
        if *part == ".." {
            drop(permits);
            return Err(StatusCode::FORBIDDEN.into_response());
        }
        full.push(part);
    }

    let try_alt = {
        let folder = game_root
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string());
        matches!(
            tokio::fs::metadata(&full).await,
            Err(_) if folder.is_some() && segments.first().map(|s| s == folder.as_ref().unwrap()).unwrap_or(false)
        )
    };
    if try_alt {
        segments.remove(0);
        full = game_root.clone();
        for part in &segments {
            full.push(part);
        }
    }

    // Canonicalize both the game root and the resolved file before the
    // starts_with containment check. A symlink placed under the game folder
    // could otherwise point outside `game_root` and bypass the containment guard.
    let canon_root = match tokio::fs::canonicalize(&game_root).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(root = %game_root.display(), err = %e, "cdn: could not canonicalize game_root");
            drop(permits);
            return Err(StatusCode::NOT_FOUND.into_response());
        }
    };
    let canon_full = match tokio::fs::canonicalize(&full).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(path = %full.display(), err = %e, "cdn 404 file not found");
            drop(permits);
            return Err(StatusCode::NOT_FOUND.into_response());
        }
    };
    if !canon_full.starts_with(&canon_root) {
        // Symlink or traversal escaped the game folder — refuse without leaking.
        drop(permits);
        return Err(StatusCode::FORBIDDEN.into_response());
    }

    tracing::debug!(id = %id, "cdn requested");

    let meta = match tokio::fs::metadata(&canon_full).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(err = %e, "cdn 404 file not found");
            drop(permits);
            return Err(StatusCode::NOT_FOUND.into_response());
        }
    };
    if meta.is_dir() {
        tracing::warn!("cdn 404 is a directory");
        drop(permits);
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    let mut file = match File::open(&canon_full).await {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(err = %e, "cdn 404 failed to open");
            drop(permits);
            return Err(StatusCode::NOT_FOUND.into_response());
        }
    };

    let size = meta.len();
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|raw| parse_range(raw, size));

    // Range present but unsatisfiable.
    if matches!(range, Some(None)) {
        drop(permits);
        return Err(Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Body::empty())
            .unwrap());
    }

    let (status, start, length) = match range {
        Some(Some((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
        _ => (StatusCode::OK, 0, size),
    };

    if start > 0 {
        if let Err(e) = file.seek(SeekFrom::Start(start)).await {
            tracing::warn!(err = %e, "cdn seek failed");
            drop(permits);
            return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    }

    let inner = ReaderStream::with_capacity(file.take(length), 64 * 1024);
    let stream = StreamWithPermits::new(inner, permits);

    let mut res = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, length);

    if status == StatusCode::PARTIAL_CONTENT {
        let end = start + length - 1;
        res = res.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }

    Ok(res.body(Body::from_stream(stream)).unwrap())
}
