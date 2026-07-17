import { IpcMain } from "electron";
import { IpcChannel, CatalogMetaSchema } from "../../shared/schemas";
import { assertSessionAdmin, getAuthTokenForDownloads } from "./auth.handler";
import { markCatalogStale } from "../services/library.service";
import { SettingsService } from "../services/settings.service";
import { debugFetch } from "../utils/network-debug";

const settings = new SettingsService();

function getAdminBaseAndHeaders(): { base: string; headers: Record<string, string> } {
  const src = settings.getSettings().sources.find((s) => s.enabled);
  if (!src) throw new Error("No enabled library source configured");
  const base = src.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const token = getAuthTokenForDownloads();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return { base, headers };
}

export function registerCatalogMetaHandlers(ipcMain: IpcMain) {
  /** GET /api/admin/catalog-meta/:id */
  ipcMain.handle(IpcChannel.CATALOG_META_GET, async (_event, raw) => {
    assertSessionAdmin();
    const { id } = raw as { id: string };
    const { base, headers } = getAdminBaseAndHeaders();
    const res = await debugFetch(`${base}/api/admin/catalog-meta/${encodeURIComponent(id)}`, { headers, timeoutMs: 15000 });
    if (!res.ok) throw new Error(`catalog-meta GET failed: HTTP ${res.status}`);
    const data: unknown = await res.json();
    return CatalogMetaSchema.parse(data);
  });

  /** PUT /api/admin/catalog-meta/:id */
  ipcMain.handle(IpcChannel.CATALOG_META_SET, async (_event, raw) => {
    assertSessionAdmin();
    const meta = CatalogMetaSchema.parse(raw);
    const { base, headers } = getAdminBaseAndHeaders();
    const res = await debugFetch(`${base}/api/admin/catalog-meta/${encodeURIComponent(meta.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(meta),
      timeoutMs: 15000,
    });
    if (!res.ok) throw new Error(`catalog-meta PUT failed: HTTP ${res.status}`);
    markCatalogStale();
    const data: unknown = await res.json();
    return CatalogMetaSchema.parse(data);
  });
}
