# Somthng — auth operations & troubleshooting

This app uses **file-based auth** on the library server. There is no web admin panel; you edit JSON on disk (or deploy scripts that do the same).

## What lives where (under the server `dataDir`)

| File | Purpose |
|------|---------|
| `auth/auth-users.json` | Accounts: `id` (UUID), `username`, `setupKey`, `role` (`user` or `admin`) |
| `auth/hardware-bindings.json` | Which PCs (`hardwareUuid`) are allowed per `user id` |
| *(in memory)* | Active **session tokens** after login — not persisted |

Paths are relative to whatever directory the server uses as **`dataDir`** (see server config / env).

---

## Setup keys (non-admin users)

### One-time enrollment keys

For **`role: "user"`**:

1. You put a **20-character hex** key in `setupKey` (e.g. `openssl rand -hex 10`).
2. The user signs in **once** on a **new** machine with username + that key. The server **binds** that PC and then **clears** `setupKey` in `auth-users.json` for that user.
3. **That PC** can sign in later **without** a key (hardware is already bound).
4. A **second PC** cannot use the old key — it was cleared. You must set a **new** `setupKey` in their row, they enroll again, and the key clears again.

**Admins** (`role: "admin"`): they **always** use username + setup key on every login. Keys are **not** auto-cleared for admins.

### Add a new user

1. Generate a key: `openssl rand -hex 10` → 20 hex chars.
2. Add a new object to the `users` array in `auth/auth-users.json`:
   - `id`: new random UUID (stable forever).
   - `username`: login name (matching is case-insensitive).
   - `setupKey`: the 20 hex chars.
   - `role`: `"user"` or `"admin"`.
3. Save the file. No server restart required for the next login attempt to see it.

### Let someone use another computer

1. Open `auth/auth-users.json`, find their user row.
2. Set `setupKey` to a **new** value (`openssl rand -hex 10`).
3. They sign in **once** on the new machine with that key; the key is then cleared and the new PC is bound.

### Remove a user (revoke access)

1. **Delete** their entire object from the `users` array in `auth/auth-users.json`, **or** remove the `username` row and rely on ID cleanup in step 2.
2. In `auth/hardware-bindings.json`, under `byUserId`, **remove** the entry whose key equals their **`id`** (UUID), or delete their hardware UUIDs from the array.
3. Optional: delete their avatar files under `auth/avatars/` if you care about disk (`<userId>.*`).

**Important:** Anyone who already has a **valid session token** may keep using downloads until that token is gone. **Restart the server** to wipe in-memory sessions if you need an immediate cut-off.

---

## Limitations (know these before you ship)

- **No per-request “user still exists” check** against `auth-users.json` for every download — validation is mainly **bearer token → session map**. Removing a user blocks **new** logins; old tokens die on **restart** (or when the client loses its session).
- **Hardware ID** comes from SMBIOS on the client. Bad OEM placeholders (“To be filled by O.E.M.”) may prevent binding; see troubleshooting.
- **Ops are manual** — adding users, rotating keys, and editing bindings is **your** process (SSH, config management, or a small internal tool). The repo does not ship a hosted admin API for accounts.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|--------|----------------|------------|
| `UNKNOWN_USERNAME` on login | Typo or user not in `auth-users.json` | Fix username or add the row |
| `SETUP_KEY_REQUIRED` | Non-admin, new PC, and `setupKey` is empty or probe step | Set a fresh `setupKey` in JSON for that user |
| `Invalid username or setup key` | Wrong key, or admin without correct key | Verify key; admins need the key every time |
| “This PC did not report a hardware UUID…” | SMBIOS unusable / spoofed / VM | Fix SMBIOS or test on physical hardware; see `scripts/dump-sysinfo.cjs` |
| User removed but still downloads | Old bearer token still in server memory | **Restart** the server |
| Second PC can’t enroll | Expected after first enrollment — key was cleared | Issue a **new** `setupKey` in JSON |
| JSON error on server start | Invalid JSON in `auth-users.json` | Validate JSON; restore from backup |

---

## Quick glossary

- **`dataDir`**: Server root for catalog + `auth/` files.
- **Enrollment / binding**: First successful login on a new machine (non-admin) with a valid setup key; stores `hardwareUuid` under that user’s id.
- **One-time key**: Non-admin `setupKey` cleared from disk after it successfully enrolls **one** new machine (not consumed on repeat logins on the **same** enrolled machine).

For development defaults, see `server/seed/auth-users.json` and `setup-keys.txt` in the repo (rotate keys before any production use).
