import { IpcMain } from "electron";
import { IpcChannel, ServerStatusSchema } from "../../shared/schemas";
import type { ServerState } from "../../shared/schemas";
import { SettingsService } from "../services/settings.service";
import { debugFetch } from "../utils/network-debug";

const settingsService = new SettingsService();

function parseMaintenance(body: Record<string, unknown>): boolean {
  if (body.maintenance === true) return true;
  if (body.status === "maintenance") return true;
  if (body.state === "maintenance") return true;
  return false;
}

function friendlyError(raw: string): string {
  if (raw.includes("ECONNREFUSED") || raw.includes("ERR_CONNECTION_REFUSED"))
    return "Connection refused — server may be down or blocked";
  if (raw.includes("ENOTFOUND") || raw.includes("ERR_NAME_NOT_RESOLVED"))
    return "Server address not found — check your internet connection";
  if (raw.includes("AbortError") || raw.includes("timeout") || raw.includes("ETIMEDOUT"))
    return "Connection timed out — server took too long to respond";
  if (raw.includes("ERR_CERT") || raw.includes("certificate"))
    return "SSL certificate error — contact the server admin";
  return "Could not reach the server";
}

async function probeServer(baseUrl: string, apiKey?: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const paths = ["/health", "/api/health"];
  let lastErrorMsg = "Unreachable";

  for (const p of paths) {
    const url = new URL(p, baseUrl);
    const start = Date.now();
    try {
      const res = await debugFetch(url.toString(), { method: "GET", headers, timeoutMs: 8000 });
      const latencyMs = Date.now() - start;

      if (res.status === 503) {
        return ServerStatusSchema.parse({
          online: false,
          serverState: "maintenance" satisfies ServerState,
          latencyMs,
          error: "Service unavailable (503)",
        });
      }

      if (!res.ok) {
        lastErrorMsg = `HTTP ${res.status} ${res.statusText}`;
        continue;
      }

      let uptimeSeconds: number | undefined;
      let maintenance = false;
      try {
        const text = await res.text();
        if (text) {
          const j = JSON.parse(text) as Record<string, unknown>;
          if (typeof j.uptime === "number") uptimeSeconds = j.uptime;
          else if (typeof j.uptimeSeconds === "number") uptimeSeconds = j.uptimeSeconds;
          maintenance = parseMaintenance(j);
        }
      } catch {
        // non-JSON body is fine
      }

      const serverState: ServerState = maintenance ? "maintenance" : "online";

      return ServerStatusSchema.parse({
        online: !maintenance,
        serverState,
        latencyMs,
        uptimeSeconds,
      });
    } catch (err: any) {
      // capture specific errors for the offline message
      const errCode = err.cause?.code || err.code || err.name || "Error";
      lastErrorMsg = friendlyError(`${errCode}: ${err.message || String(err)}`);
      // try next path
    }
  }

  return ServerStatusSchema.parse({
    online: false,
    serverState: "offline" satisfies ServerState,
    error: friendlyError(lastErrorMsg),
  });
}

/** Bare hosts default to https; plain http must be typed explicitly (LAN). Null if unparseable. */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return null;
    return withScheme;
  } catch {
    return null;
  }
}

export function registerServerStatusHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.SERVER_STATUS_PROBE, async (_e, payload: { baseUrl: string }) => {
    const url = normalizeServerUrl(payload?.baseUrl ?? "");
    if (!url) {
      return ServerStatusSchema.parse({
        online: false,
        serverState: "offline" satisfies ServerState,
        error: "That doesn't look like a valid address",
      });
    }
    return probeServer(url);
  });

  ipcMain.handle(IpcChannel.SERVER_STATUS_GET, async () => {
    const settings = settingsService.getSettings();
    const source = settings.sources.find((s) => s.enabled);
    // Local mode or no address yet — nothing to be offline from.
    if (settings.mode !== "remote" || !source) {
      return ServerStatusSchema.parse({
        online: false,
        serverState: "unconfigured" satisfies ServerState,
      });
    }
    return probeServer(source.baseUrl, source.apiKey);
  });
}
