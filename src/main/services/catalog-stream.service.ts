import type { BrowserWindow } from "electron";
import { IpcChannel } from "../../shared/schemas";
import { SettingsService } from "./settings.service";
import { markCatalogStale, readCachedLibraryRevision } from "./library.service";
import { debugFetch } from "../utils/network-debug";
import { logger } from "../utils/logger";

let abort: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastSeenRevision: number | null = null;

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(run: () => void) {
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    void run();
  }, 4000);
}

function parseSseDataBlock(block: string): { revision?: number } | null {
  for (const line of block.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const raw = t.slice(5).trim();
    try {
      return JSON.parse(raw) as { revision?: number };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Long-lived SSE connection to `GET /api/catalog/stream`.
 * When the admin bumps the catalog revision, subscribers invalidate local cache and refetch once.
 */
export function startCatalogRevisionStream(win: BrowserWindow): () => void {
  const settingsService = new SettingsService();

  const run = async () => {
    lastSeenRevision = null;
    clearReconnect();
    abort?.abort();
    abort = new AbortController();

    const settings = settingsService.getSettings();
    const source = settings.sources.find((s) => s.enabled);
    if (!source) {
      return;
    }

    const url = new URL("/api/catalog/stream", source.baseUrl).toString();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (source.apiKey) headers["Authorization"] = `Bearer ${source.apiKey}`;

    try {
      const res = await debugFetch(url, { headers, signal: abort.signal, timeoutMs: 0 });
      if (!res.ok || !res.body) {
        scheduleReconnect(run);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop() ?? "";
        for (const block of parts) {
          const parsed = parseSseDataBlock(block);
          if (!parsed || typeof parsed.revision !== "number") continue;
          const rev = parsed.revision;

          if (lastSeenRevision === null) {
            lastSeenRevision = rev;
            const diskRev = await readCachedLibraryRevision();
            if (diskRev === null || diskRev !== rev) {
              markCatalogStale();
              win.webContents.send(IpcChannel.LIBRARY_CATALOG_REVISION, { revision: rev });
            }
            continue;
          }

          if (rev > lastSeenRevision) {
            lastSeenRevision = rev;
            markCatalogStale();
            win.webContents.send(IpcChannel.LIBRARY_CATALOG_REVISION, { revision: rev });
          }
        }
      }
    } catch (err) {
      if (abort?.signal.aborted) return;
      void logger.warn(`[SSE] Catalog stream disconnected: ${err instanceof Error ? err.message : String(err)}`);
    }

    scheduleReconnect(run);
  };

  void run();

  return () => {
    clearReconnect();
    abort?.abort();
    abort = null;
    lastSeenRevision = null;
  };
}
