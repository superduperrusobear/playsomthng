# Somthng — authentication operations

Somthng uses server-owned accounts plus per-machine Ed25519 keys. The Electron app keeps the private device key and session token in the operating system's encrypted credential storage. Production servers must be reached through HTTPS; plain HTTP is accepted only on loopback for local development.

## Server auth data

Runtime auth state lives under the configured server `dataDir` and must not be committed:

| File | Contents |
|---|---|
| `auth/auth-users.json` | Account IDs, usernames, roles, blocked state, account creation time, and Argon2id setup-code verifiers |
| `auth/hardware-bindings.json` | Salted machine fingerprints, hostnames, public device keys, recognition time, last-seen time, and last-download time |
| `auth/active-sessions.json` | SHA-256 hashes of session tokens and their account/device bindings |
| `auth/hw-salt` | Server-local salt used to pseudonymize SMBIOS identifiers |
| `audit.jsonl` | Security and administrative events; never setup codes, session tokens, private keys, or raw SMBIOS UUIDs |

Readable setup codes are never stored by the server. A newly issued code is returned once to the administrator, while only its Argon2id verifier is written as `setupKeyHash`.

## Bootstrap the first administrator

Run this on the server:

```bash
playsomthng-server create-user --username your-name --admin
```

The command prints a one-time 20-character enrollment code. Sign in once on the administrator's machine. That machine is then recognized, the code verifier is consumed, and later sign-ins use a short-lived server challenge signed by the machine's private key.

Admins no longer re-enter setup codes on recognized machines.

## Manage users and machines

Use **Settings → Admin → Users**:

- Create a user or administrator and copy the one-time invite shown once.
- Expand an account to see recognized machines, recognition time, last successful sign-in, and last download request.
- Revoke one machine without affecting the user's other machines.
- Revoke an account to block access and remove all recognized machines.
- Delete an account permanently.
- Issue or cancel a pending invite for another machine.
- The signed-in administrator cannot revoke/delete their own account or revoke their own machine records.

Issuing a new invite does not revoke existing machines. Use the machine-level revoke action for that.

## Audit log

Use **Settings → Admin → Logs** to filter by event category or search across user, game, machine, IP address, actor, and denial reason. Each row expands to show every recorded field.

**Clear logs** truncates the current audit file. The server immediately records an `audit_cleared` marker with the administrator, IP address, and number of removed entries.

## Security properties

- Setup codes are one-time and stored only as Argon2id verifiers.
- Session tokens are high-entropy opaque values; only their SHA-256 hashes are persisted server-side.
- The client stores sessions and private device keys only with Electron `safeStorage`; it does not create plaintext fallbacks.
- Raw SMBIOS UUIDs are never persisted or returned by the admin API.
- Device public keys stay server-side and are not included in admin responses.
- Every role, including administrators, is bound to a revocable machine key.
- Download starts require a fresh, replay-protected device signature.
- Remote server URLs must use HTTPS. Caddy should terminate TLS while the Rust server remains bound to `127.0.0.1`.
- Cross-origin browser access is disabled by default; the Electron main process owns authenticated API calls.

## Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| `UNKNOWN_USERNAME` | Account does not exist | Check the username or create the account in Admin |
| `SETUP_KEY_REQUIRED` | This machine is not recognized | Issue a new invite and enroll the machine once |
| `BAD_SIGNATURE` | The local private key no longer matches the enrollment | Revoke the old machine record, issue a new invite, and enroll again |
| `ACCOUNT_REVOKED` | The account is blocked or deleted | Restore access by issuing an invite, or create a replacement account |
| Missing hardware UUID | SMBIOS returned an unusable placeholder | Fix the VM/firmware UUID or test on supported hardware |
| Secure OS storage error | DPAPI, Keychain, or the Linux secret service is unavailable | Enable the OS credential store; Somthng will not save credentials in plaintext |
| Remote HTTP rejected | Credentials would travel without transport encryption | Put the API behind HTTPS and use its public HTTPS URL |

For deployment, keep the Rust listener private and use the TLS reverse proxy in `deploy/Caddyfile`.
