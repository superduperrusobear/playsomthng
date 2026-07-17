import { IpcMain } from "electron";
import { z } from "zod";

import { IpcChannel, LoginPayloadSchema, UserPublicSchema, type UserPublic } from "../../shared/schemas";

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

  const AvatarUploadPayloadSchema = z.object({
    imageBase64: z.string().min(1),
    contentType: z.string().min(1),
  });

  ipcMain.handle(IpcChannel.AUTH_AVATAR_UPLOAD, async (_event, raw) => {
    const body = AvatarUploadPayloadSchema.parse(raw);
    if (!currentSession) throw new Error("Not authenticated");
    const baseUrl = getEnabledLibraryBaseUrl();
    const url = new URL("/api/auth/avatar", `${baseUrl}/`).toString();
    const res = await debugFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentSession.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ imageBase64: body.imageBase64, contentType: body.contentType }),
      timeoutMs: 30000,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg || `Avatar upload failed (HTTP ${res.status})`);
    }
    const j = JSON.parse(text) as { avatarUrl?: string };
    if (!j.avatarUrl) throw new Error("Server did not return avatarUrl");
    currentSession = {
      ...currentSession,
      user: { ...currentSession.user, avatarUrl: j.avatarUrl },
    };
    return { avatarUrl: j.avatarUrl };
  });

  ipcMain.handle(IpcChannel.AUTH_DEVICES_GET, async () => {
    if (!currentSession) throw new Error("Not authenticated");
    const baseUrl = getEnabledLibraryBaseUrl();
    const url = new URL("/api/auth/devices", `${baseUrl}/`).toString();
    const res = await debugFetch(url, {
      headers: {
        Authorization: `Bearer ${currentSession.token}`,
        Accept: "application/json",
      },
      timeoutMs: 10000,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `Could not load devices (HTTP ${res.status})`);
    }
    return JSON.parse(text) as {
      devices: { hwHash: string; hostname: string; enrolledAt: string }[];
    };
  });

}

