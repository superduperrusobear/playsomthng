import { IpcMain } from "electron";
import { z } from "zod";

import {
  AccountSecuritySchema,
  IpcChannel,
  LoginPayloadSchema,
  UserPublicSchema,
  type AccountSecurity,
  type UserPublic,
} from "../../shared/schemas";

import { getCachedSystemInfo, ensureSystemInfoCollected, getHardwareUuidFromSysinfoSnapshot } from "../services/sysinfo.service";

import { loginViaLibraryServer } from "../services/auth-server.service";
import { debugFetch } from "../utils/network-debug";
import { getEnabledLibraryBaseUrl } from "../services/library-base-url";



let currentSession: { userId: string; token: string; user: UserPublic } | null = null;

/** Throws if there is no signed-in session (any role). */
export function assertSessionAuthenticated(): void {
  if (!currentSession) throw new Error("Not authenticated");
}

/** Throws if there is no session or the signed-in user is not an admin. */
export function assertSessionAdmin(): void {
  assertSessionAuthenticated();
  if (currentSession!.user.role !== "admin") throw new Error("Admin access required");
}

/** Bearer token for gated CDN/manifest requests (install pipeline). */
export function getAuthTokenForDownloads(): string | null {
  return currentSession?.token ?? null;
}

/** SMBIOS hardware id for `X-Hardware-Uuid` on library downloads. */
export function getHardwareUuidForDownloads(): string | null {
  return getHardwareUuidFromSysinfoSnapshot(getCachedSystemInfo());
}



export function registerAuthHandlers(ipcMain: IpcMain) {

  ipcMain.handle(IpcChannel.AUTH_LOGIN, async (_event, raw) => {

    const payload = LoginPayloadSchema.parse(raw);



    await ensureSystemInfoCollected();

    const hardwareUuid = getHardwareUuidFromSysinfoSnapshot(getCachedSystemInfo());



    const baseUrl = getEnabledLibraryBaseUrl();

    const data = await loginViaLibraryServer(baseUrl, payload, hardwareUuid);



    currentSession = {

      userId: data.user.id,

      token: data.token,

      user: data.user,

    };



    return data;

  });



  ipcMain.handle(IpcChannel.AUTH_RESTORE, async (_event, raw) => {
    const { user, token } = z.object({ user: UserPublicSchema, token: z.string().min(1) }).parse(raw);

    // The persisted session file is encrypted at rest, but its `role` field is
    // renderer-controlled and therefore untrusted. Before accepting the restore,
    // validate the bearer token against the server when it's reachable. If the
    // server confirms the session is invalid/revoked, refuse the restore so a
    // stale or tampered session can't unlock the UI. Offline, fall back to the
    // persisted token (server still enforces role on every real mutation).
    const baseUrl = getEnabledLibraryBaseUrl();
    if (baseUrl) {
      const valid = await isStoredSessionStillValid(baseUrl, token);
      if (valid === false) {
        currentSession = null;
        throw new Error("Your session is no longer valid on this server — please sign in again.");
      }
    }

    currentSession = { userId: user.id, token, user };
    return { ok: true as const };
  });

  ipcMain.handle(IpcChannel.AUTH_LOGOUT, async () => {

    currentSession = null;

    return { ok: true };

  });



  ipcMain.handle(IpcChannel.AUTH_ME, async () => {

    if (!currentSession) throw new Error("Not authenticated");

    return currentSession.user;

  });

  const accountRequest = async (path: string, method = "GET"): Promise<unknown> => {
    if (!currentSession) throw new Error("Not authenticated");
    const baseUrl = getEnabledLibraryBaseUrl();
    const url = new URL(path, `${baseUrl}/`).toString();
    const res = await debugFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${currentSession.token}`,
        Accept: "application/json",
      },
      timeoutMs: 10000,
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) message = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(message || `Account request failed (HTTP ${res.status})`);
    }
    return text ? JSON.parse(text) : {};
  };

  ipcMain.handle(IpcChannel.AUTH_SECURITY_GET, async (): Promise<AccountSecurity> => {
    return AccountSecuritySchema.parse(await accountRequest("/api/auth/security"));
  });

  ipcMain.handle(IpcChannel.AUTH_DEVICE_REVOKE, async (_event, raw) => {
    const { hwHash } = z.object({ hwHash: z.string().min(1) }).parse(raw);
    return accountRequest(`/api/auth/devices/${encodeURIComponent(hwHash)}`, "DELETE");
  });

  ipcMain.handle(IpcChannel.AUTH_SESSION_REVOKE, async (_event, raw) => {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(raw);
    return accountRequest(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, "DELETE");
  });

}

/**
 * Validate a persisted bearer token against the server by hitting the
 * session-gated `/api/auth/security` endpoint. Returns:
 *   - true  if the server accepted the token (200),
 *   - false if the server rejected it (401/403 — revoked or expired),
 *   - null  if the server could not be reached (offline → keep the session).
 */
async function isStoredSessionStillValid(baseUrl: string, token: string): Promise<boolean | null> {
  try {
    const url = new URL("/api/auth/security", `${baseUrl.replace(/\/$/, "")}/`).toString();
    const res = await debugFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      timeoutMs: 8000,
    });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    // 5xx / network hiccup → don't punish the user, treat as offline.
    return null;
  } catch {
    return null;
  }
}
