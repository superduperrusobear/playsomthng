import { IpcMain } from "electron";
import { z } from "zod";
import { IpcChannel, ManifestJsonSchema } from "../../shared/schemas";
import { debugFetch } from "../utils/network-debug";
import { getAuthTokenForDownloads, getHardwareUuidForDownloads } from "./auth.handler";
import { makeDownloadAuthHeader } from "../services/device-key.service";
import { getEnabledLibraryBaseUrl } from "../services/library-base-url";

const ManifestFetchRequestSchema = z.object({ url: z.string().url() });

export function registerManifestHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.MANIFEST_FETCH, async (_event, raw) => {
    const { url } = ManifestFetchRequestSchema.parse(raw);

    const headers: Record<string, string> = { Accept: "application/json" };

    try {
      const libraryBase = getEnabledLibraryBaseUrl();
      if (url.startsWith(libraryBase)) {
        const token = getAuthTokenForDownloads();
        const hw = getHardwareUuidForDownloads();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (hw) headers["X-Hardware-Uuid"] = hw;
        headers["X-Download-Auth"] = makeDownloadAuthHeader();
      }
    } catch {
      // non-library URL or settings unavailable — proceed without auth
    }

    const res = await debugFetch(url, {
      headers,
      timeoutMs: 30000,
    });
    if (!res.ok) {
      if (res.status === 503) {
        throw new Error("Server busy.");
      }
      throw new Error(`Manifest fetch failed: HTTP ${res.status} for ${url}`);
    }
    const data: unknown = await res.json();
    return ManifestJsonSchema.parse(data);
  });
}
