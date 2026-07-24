//! Auth user table + hardware enrollments live **only on the server** under `dataDir/auth/`.
//! The Electron client sends `hardwareUuid` from SMBIOS; it does not store auth JSON locally.
//!
//! Setup keys are one-time for every role. Only an Argon2id verifier is stored
//! in `auth-users.json`; the readable code is returned only when it is issued.
//! After enrollment, every device (including an admin device) authenticates by
//! signing a short-lived server challenge with its local Ed25519 key.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::Context;
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::http::{HeaderMap, header};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthUserRow {
    pub id: String,
    pub username: String,
    #[serde(rename = "setupKeyHash")]
    pub setup_key: String,
    pub role: String,
    #[serde(default)]
    pub created_at: String,
    /// Revoked accounts stay in the file but are denied downloads (not deleted).
    #[serde(default)]
    pub blocked: bool,
}

/// Whether an account may pull downloads right now.
#[derive(Debug, PartialEq, Eq)]
pub enum AccountState {
    Active,
    Blocked,
    Missing,
}

pub fn account_state(data_dir: &Path, user_id: &str) -> AccountState {
    let Ok(file) = load_users(data_dir) else {
        return AccountState::Missing;
    };
    match file.users.iter().find(|u| u.id == user_id) {
        None => AccountState::Missing,
        Some(u) if u.blocked => AccountState::Blocked,
        Some(_) => AccountState::Active,
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AuthUsersFile {
    pub users: Vec<AuthUserRow>,
}

/// One enrolled machine. The raw SMBIOS UUID is never stored — only a salted SHA-256.
/// `pub_key` (base64 raw ed25519) is the device identity; empty = legacy pre-key enrollment.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    pub hw_hash: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub enrolled_at: String,
    #[serde(default)]
    pub last_seen_at: String,
    #[serde(default)]
    pub last_download_at: Option<String>,
    #[serde(default)]
    pub pub_key: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct HardwareBindingsFile {
    #[serde(default, rename = "byUserId")]
    pub by_user_id: HashMap<String, Vec<DeviceEntry>>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct ActiveSessionsFile {
    #[serde(default)]
    pub sessions: HashMap<String, crate::state::AuthSession>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub token: String,
    pub user: UserDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: String,
}

/// Default auth table (seed). Copy `server/seed/auth-users.json` to `<dataDir>/auth/auth-users.json` to override.
const DEFAULT_AUTH_USERS: &str = include_str!("../seed/auth-users.json");

pub fn auth_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("auth")
}

pub fn auth_users_path(data_dir: &Path) -> PathBuf {
    auth_dir(data_dir).join("auth-users.json")
}

pub fn hardware_bindings_path(data_dir: &Path) -> PathBuf {
    auth_dir(data_dir).join("hardware-bindings.json")
}

pub fn active_sessions_path(data_dir: &Path) -> PathBuf {
    auth_dir(data_dir).join("active-sessions.json")
}

/// Bearer token from `Authorization: Bearer ...` (shared with download routes and `/api/auth/*`).
pub fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    v.strip_prefix("Bearer ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Session-map key: sha256 of the token, so the sessions file never holds raw
/// credentials. The token itself is high-entropy, so no salt is needed.
pub fn token_key(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex_lower(&h.finalize())
}

pub fn username_for_id(data_dir: &Path, user_id: &str) -> Option<String> {
    let users = load_users(data_dir).ok()?;
    users
        .users
        .iter()
        .find(|u| u.id == user_id)
        .map(|u| u.username.clone())
}

pub fn user_role_for_id(data_dir: &Path, user_id: &str) -> Option<String> {
    let users = load_users(data_dir).ok()?;
    users
        .users
        .iter()
        .find(|u| u.id == user_id)
        .map(|u| u.role.clone())
}

pub fn normalize_hardware_uuid(raw: &str) -> Option<String> {
    let t = raw.trim().trim_matches(|c| c == '{' || c == '}');
    if t.is_empty() {
        return None;
    }
    let lower = t.to_lowercase();
    if lower.contains("o.e.m.") || lower.contains("to be filled") {
        return None;
    }
    if lower == "not available" || lower == "default string" || lower == "-" {
        return None;
    }
    Some(lower)
}

fn load_users(data_dir: &Path) -> anyhow::Result<AuthUsersFile> {
    let path = auth_users_path(data_dir);
    if !path.is_file() {
        std::fs::create_dir_all(auth_dir(data_dir)).context("create auth dir")?;
        std::fs::write(&path, DEFAULT_AUTH_USERS)
            .with_context(|| format!("write {}", path.display()))?;
    }
    let raw = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let file: AuthUsersFile =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    Ok(file)
}

fn save_users(data_dir: &Path, file: &AuthUsersFile) -> anyhow::Result<()> {
    let path = auth_users_path(data_dir);
    std::fs::create_dir_all(auth_dir(data_dir)).context("create auth dir")?;
    let json = serde_json::to_string_pretty(file).context("serialize auth-users")?;
    std::fs::write(&path, json).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

/// Clears a setup-key verifier after it enrolls one device.
fn clear_setup_key_after_enrollment(data_dir: &Path, user_id: &str) -> anyhow::Result<()> {
    let mut file = load_users(data_dir)?;
    if let Some(row) = file.users.iter_mut().find(|u| u.id == user_id) {
        row.setup_key.clear();
    }
    save_users(data_dir, &file)
}

/// One row per user for the admin panel. Never exposes the key itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserRow {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: String,
    /// A key is issued and not yet used to enroll a machine.
    pub has_pending_key: bool,
    pub blocked: bool,
    pub devices: Vec<AdminDeviceRow>,
}

/// Safe device projection for the admin API. The device public key remains
/// server-only; the fingerprint is enough to address a revoke operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDeviceRow {
    pub hw_hash: String,
    pub hostname: String,
    pub enrolled_at: String,
    pub last_seen_at: String,
    pub last_download_at: Option<String>,
}

pub fn list_users_for_admin(data_dir: &Path, salt: &str) -> anyhow::Result<Vec<AdminUserRow>> {
    let users = load_users(data_dir)?;
    let bindings = load_bindings(data_dir, salt).unwrap_or_default();
    Ok(users
        .users
        .into_iter()
        .map(|u| {
            let devices = bindings
                .by_user_id
                .get(&u.id)
                .into_iter()
                .flatten()
                .map(|d| AdminDeviceRow {
                    hw_hash: d.hw_hash.clone(),
                    hostname: d.hostname.clone(),
                    enrolled_at: d.enrolled_at.clone(),
                    last_seen_at: d.last_seen_at.clone(),
                    last_download_at: d.last_download_at.clone(),
                })
                .collect();
            AdminUserRow {
                has_pending_key: !u.setup_key.trim().is_empty(),
                blocked: u.blocked,
                id: u.id,
                username: u.username,
                role: u.role,
                created_at: u.created_at,
                devices,
            }
        })
        .collect())
}

/// Drops a user's hardware enrollments and clears their key. Caller must also
/// remove their sessions — this only touches disk.
/// Blocks an account and drops its devices/key. The row stays so the user's app
/// keeps its session and shows an "access revoked" state instead of being kicked.
pub fn revoke_user(data_dir: &Path, salt: &str, user_id: &str) -> anyhow::Result<()> {
    let mut bindings = load_bindings(data_dir, salt).unwrap_or_default();
    bindings.by_user_id.remove(user_id);
    save_bindings(data_dir, &bindings)?;

    let mut users = load_users(data_dir)?;
    if let Some(row) = users.users.iter_mut().find(|u| u.id == user_id) {
        row.setup_key.clear();
        row.blocked = true;
    }
    save_users(data_dir, &users)
}

/// Removes a user entirely — row, devices, and any pending key.
pub fn delete_user(data_dir: &Path, salt: &str, user_id: &str) -> anyhow::Result<bool> {
    let mut users = load_users(data_dir)?;
    let before = users.users.len();
    users.users.retain(|u| u.id != user_id);
    if users.users.len() == before {
        return Ok(false);
    }
    save_users(data_dir, &users)?;

    let mut bindings = load_bindings(data_dir, salt).unwrap_or_default();
    if bindings.by_user_id.remove(user_id).is_some() {
        save_bindings(data_dir, &bindings)?;
    }
    Ok(true)
}

/// Creates a user with a fresh one-time invite code, returned once.
pub fn create_user(data_dir: &Path, username: &str, role: &str) -> anyhow::Result<(String, String)> {
    let username = username.trim();
    anyhow::ensure!(!username.is_empty(), "username is required");
    let role = match role.trim() {
        "admin" => "admin",
        _ => "user",
    };

    let mut users = load_users(data_dir)?;
    anyhow::ensure!(
        !users
            .users
            .iter()
            .any(|u| u.username.eq_ignore_ascii_case(username)),
        "a user with that name already exists",
    );

    let id = uuid::Uuid::new_v4().to_string();
    let key = uuid::Uuid::new_v4().simple().to_string()[..20].to_string();
    users.users.push(AuthUserRow {
        id: id.clone(),
        username: username.to_string(),
        setup_key: hash_setup_key(&key)?,
        role: role.to_string(),
        created_at: iso_now(),
        blocked: false,
    });
    save_users(data_dir, &users)?;
    Ok((id, key))
}

/// Removes one enrolled machine. Returns false when no such device exists.
pub fn revoke_device(
    data_dir: &Path,
    salt: &str,
    user_id: &str,
    hw_hash: &str,
) -> anyhow::Result<bool> {
    let mut bindings = load_bindings(data_dir, salt).unwrap_or_default();
    let Some(list) = bindings.by_user_id.get_mut(user_id) else {
        return Ok(false);
    };
    let before = list.len();
    list.retain(|d| d.hw_hash != hw_hash);
    let removed = list.len() < before;
    if list.is_empty() {
        bindings.by_user_id.remove(user_id);
    }
    if removed {
        save_bindings(data_dir, &bindings)?;
    }
    Ok(removed)
}

/// Cancels a pending (unused) setup key. Returns false when none was pending.
pub fn revoke_setup_key(data_dir: &Path, user_id: &str) -> anyhow::Result<bool> {
    let mut users = load_users(data_dir)?;
    let Some(row) = users.users.iter_mut().find(|u| u.id == user_id) else {
        return Ok(false);
    };
    if row.setup_key.trim().is_empty() {
        return Ok(false);
    }
    row.setup_key.clear();
    save_users(data_dir, &users)?;
    Ok(true)
}

/// Issues a fresh one-time key and returns it. Shown to the admin once.
pub fn issue_setup_key(data_dir: &Path, user_id: &str) -> anyhow::Result<String> {
    let key = uuid::Uuid::new_v4().simple().to_string()[..20].to_string();
    let mut users = load_users(data_dir)?;
    let row = users
        .users
        .iter_mut()
        .find(|u| u.id == user_id)
        .context("user not found")?;
    row.setup_key = hash_setup_key(&key)?;
    row.blocked = false; // re-inviting lets a revoked user back in
    save_users(data_dir, &users)?;
    Ok(key)
}

pub fn user_exists(data_dir: &Path, user_id: &str) -> bool {
    load_users(data_dir)
        .map(|f| f.users.iter().any(|u| u.id == user_id))
        .unwrap_or(false)
}

const SALT_FILENAME: &str = "hw-salt";

/// Per-server salt. Generated once; losing it invalidates all enrollments.
pub fn load_or_create_salt(data_dir: &Path) -> anyhow::Result<String> {
    let path = auth_dir(data_dir).join(SALT_FILENAME);
    if let Ok(s) = std::fs::read_to_string(&path) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            return Ok(s);
        }
    }
    let salt = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    std::fs::create_dir_all(auth_dir(data_dir)).context("create auth dir")?;
    std::fs::write(&path, &salt).with_context(|| format!("write {}", path.display()))?;
    Ok(salt)
}

/// Verifies an ed25519 signature (both base64) over `message`.
pub fn verify_device_signature(pub_key_b64: &str, message: &str, signature_b64: &str) -> bool {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD as B64;
    use ed25519_dalek::{Signature, VerifyingKey};

    let Ok(pk) = B64.decode(pub_key_b64) else {
        return false;
    };
    let Ok(pk32) = <[u8; 32]>::try_from(pk.as_slice()) else {
        return false;
    };
    let Ok(vk) = VerifyingKey::from_bytes(&pk32) else {
        return false;
    };
    let Ok(sig) = B64.decode(signature_b64) else {
        return false;
    };
    let Ok(sig64) = <[u8; 64]>::try_from(sig.as_slice()) else {
        return false;
    };
    vk.verify_strict(message.as_bytes(), &Signature::from_bytes(&sig64))
        .is_ok()
}

/// Salted fingerprint of a machine — what the server stores and compares.
pub fn hash_hardware(salt: &str, hardware_uuid: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(hardware_uuid.as_bytes());
    hex_lower(&h.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load_bindings(data_dir: &Path, _salt: &str) -> anyhow::Result<HardwareBindingsFile> {
    let path = hardware_bindings_path(data_dir);
    if !path.is_file() {
        return Ok(HardwareBindingsFile::default());
    }
    let raw = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    // Pre-key entries (plain strings) are skipped — those machines re-enroll with a new code.
    let v: serde_json::Value =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    let by = v
        .get("byUserId")
        .and_then(|x| x.as_object())
        .cloned()
        .unwrap_or_default();

    let mut by_user_id: HashMap<String, Vec<DeviceEntry>> = HashMap::new();
    for (uid, val) in by {
        let serde_json::Value::Array(arr) = val else {
            continue;
        };
        let mut list: Vec<DeviceEntry> = vec![];
        for x in arr {
            if let Ok(e) = serde_json::from_value::<DeviceEntry>(x) {
                if !list.iter().any(|d| d.hw_hash == e.hw_hash) {
                    list.push(e);
                }
            }
        }
        if !list.is_empty() {
            by_user_id.insert(uid, list);
        }
    }
    Ok(HardwareBindingsFile { by_user_id })
}

fn save_bindings(data_dir: &Path, file: &HardwareBindingsFile) -> anyhow::Result<()> {
    let path = hardware_bindings_path(data_dir);
    std::fs::create_dir_all(auth_dir(data_dir)).context("create auth dir")?;
    let json = serde_json::to_string_pretty(file).context("serialize hardware-bindings")?;
    std::fs::write(&path, json).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

pub fn load_active_sessions(data_dir: &Path) -> HashMap<String, crate::state::AuthSession> {
    let path = active_sessions_path(data_dir);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(file) = serde_json::from_str::<ActiveSessionsFile>(&raw) {
            return file.sessions;
        }
    }
    HashMap::new()
}

pub fn save_active_sessions(data_dir: &Path, sessions: &HashMap<String, crate::state::AuthSession>) {
    let path = active_sessions_path(data_dir);
    let _ = std::fs::create_dir_all(auth_dir(data_dir));
    let file = ActiveSessionsFile {
        sessions: sessions.clone(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&file) {
        let _ = std::fs::write(&path, json);
    }
}

fn find_user_by_username<'a>(users: &'a [AuthUserRow], username: &str) -> Option<&'a AuthUserRow> {
    let u = username.trim().to_lowercase();
    users.iter().find(|row| row.username.to_lowercase() == u)
}

fn hash_setup_key(setup_key: &str) -> anyhow::Result<String> {
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
        .map_err(|e| anyhow::anyhow!("generate setup-key salt: {e}"))?;
    Argon2::default()
        .hash_password(setup_key.trim().to_lowercase().as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash setup key: {e}"))
}

fn setup_key_matches(user: &AuthUserRow, setup_key: &str) -> bool {
    let Ok(hash) = PasswordHash::new(&user.setup_key) else {
        return false;
    };
    Argon2::default()
        .verify_password(setup_key.trim().to_lowercase().as_bytes(), &hash)
        .is_ok()
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Public key of one enrolled device, when it has one (legacy = empty).
pub fn device_pub_key(data_dir: &Path, salt: &str, user_id: &str, hw_hash: &str) -> Option<String> {
    let file = load_bindings(data_dir, salt).ok()?;
    file.by_user_id
        .get(user_id)?
        .iter()
        .find(|d| d.hw_hash == hw_hash)
        .map(|d| d.pub_key.clone())
        .filter(|k| !k.is_empty())
}

/// Machines enrolled for this account (login-capable devices).
pub fn hardware_enrollments_for_user(data_dir: &Path, salt: &str, user_id: &str) -> Vec<DeviceEntry> {
    let Ok(file) = load_bindings(data_dir, salt) else {
        return vec![];
    };
    file.by_user_id.get(user_id).cloned().unwrap_or_default()
}

/// A persisted session is usable only while unexpired and still attached to
/// an enrolled public key. This drops legacy unbound admin sessions too.
pub fn session_device_is_valid(
    data_dir: &Path,
    salt: &str,
    session: &crate::state::AuthSession,
) -> bool {
    if session.expires_at <= Utc::now().timestamp() {
        return false;
    }
    session
        .login_hardware_uuid
        .as_deref()
        .and_then(|hw| device_pub_key(data_dir, salt, &session.user_id, hw))
        .is_some()
}

/// Records a successful, authenticated download request for one device.
pub fn mark_device_download(
    data_dir: &Path,
    salt: &str,
    user_id: &str,
    hw_hash: &str,
) -> anyhow::Result<bool> {
    let mut bindings = load_bindings(data_dir, salt)?;
    let Some(device) = bindings
        .by_user_id
        .get_mut(user_id)
        .and_then(|list| list.iter_mut().find(|d| d.hw_hash == hw_hash))
    else {
        return Ok(false);
    };
    device.last_download_at = Some(iso_now());
    save_bindings(data_dir, &bindings)?;
    Ok(true)
}

fn user_dto(user: &AuthUserRow) -> UserDto {
    UserDto {
        id: user.id.clone(),
        username: user.username.clone(),
        role: user.role.clone(),
        created_at: if user.created_at.is_empty() { iso_now() } else { user.created_at.clone() },
    }
}

/// Login + optional enrollment (call while holding `auth_mutex`).
///
/// New machine: one-time invite code authorizes registering the device's public
/// key + `sha256(salt + smbios)` + hostname; the code is then cleared. Known
/// machine: must sign the server-issued `nonce` with its private key. Legacy
/// devices without a key are upgraded on first sight of one (TOFU).
#[allow(clippy::too_many_arguments)]
pub fn login(
    data_dir: &Path,
    salt: &str,
    username: &str,
    setup_key: &str,
    hardware_uuid: Option<&str>,
    hostname: Option<&str>,
    pub_key: Option<&str>,
    nonce: Option<&str>,
    signature: Option<&str>,
) -> Result<LoginResponse, &'static str> {
    let AuthUsersFile { users } = load_users(data_dir).map_err(|_| "Server auth config error")?;
    let user = find_user_by_username(&users, username).ok_or("UNKNOWN_USERNAME")?;
    if user.blocked {
        return Err("ACCOUNT_REVOKED");
    }

    let mint = |user: &AuthUserRow| LoginResponse {
        token: format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple()),
        user: user_dto(user),
    };

    let hw = hardware_uuid
        .and_then(|s| normalize_hardware_uuid(s))
        .ok_or(
            "This PC did not report a hardware UUID (SMBIOS). Cannot verify or bind this account.",
        )?;
    let hw_hash = hash_hardware(salt, &hw);

    let mut bindings = load_bindings(data_dir, salt).map_err(|_| "Server auth storage error")?;
    let list = bindings
        .by_user_id
        .entry(user.id.clone())
        .or_insert_with(Vec::new);

    // A device is only "known" with a registered key — keyless entries don't count.
    if let Some(device) = list
        .iter()
        .find(|d| d.hw_hash == hw_hash && !d.pub_key.is_empty())
    {
        let (Some(n), Some(sig)) = (nonce, signature) else {
            return Err("SIGNATURE_REQUIRED");
        };
        if !verify_device_signature(&device.pub_key, n, sig) {
            return Err("BAD_SIGNATURE");
        }
        let now = iso_now();
        if let Some(device) = list.iter_mut().find(|d| d.hw_hash == hw_hash) {
            device.last_seen_at = now;
            if let Some(name) = hostname.map(str::trim).filter(|s| !s.is_empty()) {
                device.hostname = name.to_string();
            }
        }
        save_bindings(data_dir, &bindings).map_err(|_| "Failed to update device activity")?;
        return Ok(mint(user));
    }

    if setup_key.trim().is_empty() {
        return Err("SETUP_KEY_REQUIRED");
    }
    if !setup_key_matches(user, setup_key) {
        return Err("Invalid username or setup key");
    }
    let pk = pub_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("PUBLIC_KEY_REQUIRED")?;

    // Re-enrollment replaces any keyless remnant of the same machine.
    list.retain(|d| !(d.hw_hash == hw_hash && d.pub_key.is_empty()));
    let now = iso_now();
    list.push(DeviceEntry {
        hw_hash,
        hostname: hostname.unwrap_or("unknown device").trim().to_string(),
        enrolled_at: now.clone(),
        last_seen_at: now,
        last_download_at: None,
        pub_key: pk.to_string(),
    });
    save_bindings(data_dir, &bindings).map_err(|_| "Failed to save hardware enrollment")?;
    clear_setup_key_after_enrollment(data_dir, &user.id)
        .map_err(|_| "Failed to save auth config")?;

    Ok(mint(user))
}

#[cfg(test)]
mod account_tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
    use ed25519_dalek::{Signer, SigningKey};

    fn seed(dir: &Path) {
        std::fs::create_dir_all(auth_dir(dir)).unwrap();
        std::fs::write(auth_users_path(dir), r#"{"users":[]}"#).unwrap();
    }

    #[test]
    fn create_then_state_active() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        let (id, key) = create_user(d.path(), "mike", "user").unwrap();
        assert_eq!(key.len(), 20);
        assert_eq!(account_state(d.path(), &id), AccountState::Active);
    }

    #[test]
    fn setup_code_is_hashed_at_rest() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        let (_id, key) = create_user(d.path(), "mike", "user").unwrap();
        let raw = std::fs::read_to_string(auth_users_path(d.path())).unwrap();
        assert!(!raw.contains(&key));
        let users = load_users(d.path()).unwrap();
        assert!(users.users[0].setup_key.starts_with("$argon2id$"));
        assert!(setup_key_matches(&users.users[0], &key));
    }

    #[test]
    fn admin_enrolls_once_then_uses_device_signature() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        let (id, key) = create_user(d.path(), "root", "admin").unwrap();
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let public_key = B64.encode(signing_key.verifying_key().as_bytes());

        login(
            d.path(), "salt", "root", &key, Some("machine-1"), Some("desk"),
            Some(&public_key), None, None,
        ).unwrap();
        assert!(!list_users_for_admin(d.path(), "salt").unwrap()[0].has_pending_key);

        let nonce = "one-time-nonce";
        let signature = B64.encode(signing_key.sign(nonce.as_bytes()).to_bytes());
        login(
            d.path(), "salt", "root", "", Some("machine-1"), Some("desk"),
            Some(&public_key), Some(nonce), Some(&signature),
        ).unwrap();

        let hw_hash = hash_hardware("salt", "machine-1");
        assert!(mark_device_download(d.path(), "salt", &id, &hw_hash).unwrap());
        let device = &hardware_enrollments_for_user(d.path(), "salt", &id)[0];
        assert!(!device.last_seen_at.is_empty());
        assert!(device.last_download_at.is_some());
    }

    #[test]
    fn duplicate_username_rejected() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        create_user(d.path(), "mike", "user").unwrap();
        assert!(create_user(d.path(), "MIKE", "user").is_err());
    }

    #[test]
    fn revoke_blocks_but_keeps_row() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        let (id, _) = create_user(d.path(), "mike", "user").unwrap();
        revoke_user(d.path(), "salt", &id).unwrap();
        assert_eq!(account_state(d.path(), &id), AccountState::Blocked);
    }

    #[test]
    fn reissue_key_unblocks() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        let (id, _) = create_user(d.path(), "mike", "user").unwrap();
        revoke_user(d.path(), "salt", &id).unwrap();
        issue_setup_key(d.path(), &id).unwrap();
        assert_eq!(account_state(d.path(), &id), AccountState::Active);
    }

    #[test]
    fn delete_removes_row() {
        let d = tempfile::tempdir().unwrap();
        seed(d.path());
        let (id, _) = create_user(d.path(), "mike", "user").unwrap();
        assert!(delete_user(d.path(), "salt", &id).unwrap());
        assert_eq!(account_state(d.path(), &id), AccountState::Missing);
        assert!(!delete_user(d.path(), "salt", &id).unwrap());
    }
}
