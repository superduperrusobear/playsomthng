import { IpcMain } from "electron";
import { IpcChannel, IgdbSearchResponseSchema, IgdbMetaSchema, IpcRequestSchema } from "../../shared/schemas";
import { assertSessionAdmin, getAuthTokenForDownloads } from "./auth.handler";
import { SettingsService } from "../services/settings.service";
import { debugFetch } from "../utils/network-debug";

const settings = new SettingsService();

function getBaseAndHeaders(): { base: string; headers: Record<string, string> } {
  const src = settings.getSettings().sources.find((s) => s.enabled);
  if (!src) throw new Error("No enabled library source configured");
  const base = src.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getAuthTokenForDownloads();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return { base, headers };
}

export function registerIgdbHandlers(ipcMain: IpcMain) {
  /** GET /api/admin/igdb/search?q=...&limit=... */
  ipcMain.handle(IpcChannel.IGDB_SEARCH, async (_event, raw) => {
    assertSessionAdmin();
    const { q, limit } = IpcRequestSchema[IpcChannel.IGDB_SEARCH].parse(raw);
    const { base, headers } = getBaseAndHeaders();
    const params = new URLSearchParams({ q });
    if (limit) params.set("limit", String(limit));
    const res = await debugFetch(`${base}/api/admin/igdb/search?${params}`, { headers, timeoutMs: 15000 });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`IGDB search failed: HTTP ${res.status}${text ? ` — ${text}` : ""}`);
    }
    const data: unknown = await res.json();
    return IgdbSearchResponseSchema.parse(data);
  });

  /** GET /api/admin/igdb/game/:igdb_id */
  ipcMain.handle(IpcChannel.IGDB_FETCH_GAME, async (_event, raw) => {
    assertSessionAdmin();
    const { igdbId } = IpcRequestSchema[IpcChannel.IGDB_FETCH_GAME].parse(raw);
    const { base, headers } = getBaseAndHeaders();
    const res = await debugFetch(`${base}/api/admin/igdb/game/${igdbId}`, { headers, timeoutMs: 15000 });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`IGDB fetch failed: HTTP ${res.status}${text ? ` — ${text}` : ""}`);
    }
    const data: unknown = await res.json();
    return IgdbMetaSchema.parse(data);
  });
}
