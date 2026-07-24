import { IpcMain } from "electron";
import { z } from "zod";
import { IpcChannel } from "../../shared/schemas";
import { debugFetch } from "../utils/network-debug";
import { assertSessionAdmin, getAuthTokenForDownloads } from "./auth.handler";
import { assertSecureServerUrl, getEnabledLibraryBaseUrl } from "../services/library-base-url";

const RequestSchema = z.object({
  method: z.enum(["GET", "POST", "DELETE"]),
  path: z.string().startsWith("/api/admin/").refine((path) => {
    if (path.includes("..") || path.includes(String.fromCharCode(92)) || path.startsWith("//")) return false;
    const parsed = new URL(path, "https://admin.invalid");
    return parsed.origin === "https://admin.invalid" && parsed.pathname.startsWith("/api/admin/");
  }, "Invalid admin API path"),
  body: z.unknown().optional(),
});

/** Authenticated passthrough to the server's /api/admin/* routes (admin token attached here). */
export function registerAdminApiHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.ADMIN_API, async (_event, raw) => {
    // Defense in depth: require a local admin session before forwarding to the
    // server's admin routes. The server also enforces admin role, but this stops
    // a non-admin authenticated user from driving admin IPC at all.
    assertSessionAdmin();
    const { method, path, body } = RequestSchema.parse(raw);
    const configuredBase = getEnabledLibraryBaseUrl();
    if (!configuredBase) throw new Error("No server configured.");
    const base = assertSecureServerUrl(configuredBase);
    const token = getAuthTokenForDownloads();
    if (!token) throw new Error("Sign in as an admin first.");

    const res = await debugFetch(new URL(path, `${base}/`).toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body != null ? { "Content-Type": "application/json" } : {}),
      },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 20000,
    });

    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const json = JSON.parse(text) as { error?: string };
        if (json.error) msg = json.error;
      } catch {
        // Keep the raw response for diagnostics.
      }
      if (res.status === 403) throw new Error(`Forbidden — admin only. ${msg}`);
      throw new Error(msg || `Request failed (HTTP ${res.status})`);
    }
    return text ? JSON.parse(text) : { ok: true };
  });
}
