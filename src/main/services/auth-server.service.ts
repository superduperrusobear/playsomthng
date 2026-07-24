import os from "node:os";
import { AuthResponseSchema, type AuthResponse, type LoginPayload } from "../../shared/schemas";
import { debugFetch } from "../utils/network-debug";
import { getDeviceKey, signChallenge } from "./device-key.service";
import { logger } from "../utils/logger";
import { assertSecureServerUrl } from "./library-base-url";

/** One-time nonce to sign. Older servers have no challenge route — returns null. */
async function fetchChallenge(base: string, username: string): Promise<string | null> {
  try {
    const res = await debugFetch(new URL("/api/auth/challenge", `${base}/`).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username }),
      timeoutMs: 10000,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { nonce?: string };
    return typeof j.nonce === "string" ? j.nonce : null;
  } catch (err) {
    logger.warn(`[AUTH] Challenge fetch failed (older server?): ${String(err)}`);
    return null;
  }
}

/**
 * Login against the Rust server — users + hardware enrollments live in `server dataDir/auth/`, not on the client disk.
 */
export async function loginViaLibraryServer(
  baseUrl: string,
  payload: LoginPayload,
  hardwareUuid: string | null
): Promise<AuthResponse> {
  const base = assertSecureServerUrl(baseUrl);
  const url = new URL("/api/auth/login", `${base}/`).toString();

  const { publicKeyB64 } = getDeviceKey();
  const nonce = await fetchChallenge(base, payload.username.trim().toLowerCase());
  const signature = nonce ? signChallenge(nonce) : null;

  const res = await debugFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    // Wire contract: the Rust server expects `setupKey`. Hostname is the device
    // name the admin sees; the server stores a salted UUID hash + our public key,
    // and known devices authenticate by signing the challenge nonce.
    body: JSON.stringify({
      username: payload.username,
      setupKey: payload.scikde,
      hostname: os.hostname(),
      publicKey: publicKeyB64,
      ...(nonce != null ? { nonce, signature } : {}),
      ...(hardwareUuid != null ? { hardwareUuid } : {}),
    }),
    timeoutMs: 15000,
  });
  const text = await res.text();

  // Detect HTML responses — means a firewall, captive portal, or Authentik is
  // intercepting the request before it reaches the API server.
  const looksLikeHtml = text.trimStart().startsWith("<");
  if (looksLikeHtml) {
    throw new Error(
      res.ok
        ? "Your network is intercepting this connection (got an HTML page instead of a login response). " +
          "Try a different network or disable any VPN/proxy."
        : `Login blocked by network (HTTP ${res.status}). A firewall or proxy is intercepting requests — try a different network.`,
    );
  }

  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `Login failed (HTTP ${res.status})`);
  }
  const json: unknown = JSON.parse(text);
  return AuthResponseSchema.parse(json);
}
