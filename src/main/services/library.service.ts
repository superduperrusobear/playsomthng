import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  LibraryFilters,
  LibraryResponse,
  SyncProgress,
} from "../../shared/schemas";
import { normalizeLibraryResponse } from "../../shared/catalog-mapper";
import { SettingsService } from "./settings.service";
import { getAppPaths } from "./app-paths.service";
import { debugFetch } from "../utils/network-debug";
import { getAuthTokenForDownloads, getHardwareUuidForDownloads } from "../ipc/auth.handler";

/** Thrown when the server reports the account is revoked. Client shows a banner, stays signed in. */
export class AccessRevokedError extends Error {
  constructor() {
    super("ACCOUNT_REVOKED");
    this.name = "AccessRevokedError";
  }
}

/** Session + hardware headers so the (now gated) catalog endpoints accept the request. */
function sessionHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = getAuthTokenForDownloads();
  const hw = getHardwareUuidForDownloads();
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (hw) h["X-Hardware-Uuid"] = hw;
  return h;
}

/** In-memory copy of the last successful fetch for this filter key. */
let cachedResponse: LibraryResponse | null = null;
let cacheKey = "";
/** After the first successful load in this process, we can serve from memory with zero HTTP until the server pushes a change. */
let booted = false;
/** Set when SSE (or explicit invalidation) says the remote catalog may have changed. */
let catalogStaleFromPush = false;

type LibraryCacheFile = {
  key: string;
  fetchedAt: number;
  /** Server `GET /api/catalog-revision` at the time `data` was fetched. */
  revision?: number;
  data: LibraryResponse;
};

const CACHE_FILE_PATH = () => path.join(getAppPaths().cacheDir, "library-cache.json");

async function readCacheFromDisk(): Promise<LibraryCacheFile | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE_PATH(), "utf8");
    return JSON.parse(raw) as LibraryCacheFile;
  } catch {
    return null;
  }
}

async function writeCacheToDisk(entry: LibraryCacheFile): Promise<void> {
  const cachePath = CACHE_FILE_PATH();
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), "utf8");
}

async function deleteCacheFromDisk(): Promise<void> {
  try {
    await fs.rm(CACHE_FILE_PATH(), { force: true });
  } catch {
    // ignore
  }
}

async function fetchRemoteRevision(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<number | null> {
  try {
    const url = new URL("/api/catalog-revision", baseUrl).toString();
    const res = await debugFetch(url, { headers, timeoutMs: 4000 });
    if (!res.ok) return null;
    const j = (await res.json()) as { revision?: unknown };
    return typeof j.revision === "number" ? j.revision : null;
  } catch {
    return null;
  }
}

/**
 * Called when the server signals a new catalog revision (SSE) or after catalog-meta PUT.
 * Must drop disk cache too — otherwise fetchGames can still serve stale titles/covers from
 * library-cache.json when the revision check lines up with what's on disk.
 */
export function markCatalogStale(): void {
  catalogStaleFromPush = true;
  cachedResponse = null;
  cacheKey = "";
  booted = false;
  try {
    rmSync(CACHE_FILE_PATH(), { force: true });
  } catch {
    // ignore
  }
}

/** Disk revision for the current library cache file (if any). Used to avoid pointless invalidations on SSE connect. */
export async function readCachedLibraryRevision(): Promise<number | null> {
  const disk = await readCacheFromDisk();
  return typeof disk?.revision === "number" ? disk.revision : null;
}

export class LibraryService {
  private settingsService = new SettingsService();

  async fetchGames(filters: LibraryFilters): Promise<LibraryResponse> {
    const settings = this.settingsService.getSettings();
    const enabledSources = settings.sources.filter((s) => s.enabled);

    if (enabledSources.length === 0) {
      return normalizeLibraryResponse({
        source: "none",
        totalGames: 0,
        games: [],
      });
    }

    const source = enabledSources[0];
    const endpoint = filters.admin ? "/api/admin/games" : "/api/games";
    const url = new URL(endpoint, source.baseUrl);

    if (filters.search) url.searchParams.set("search", filters.search);
    if (filters.platform) url.searchParams.set("platform", filters.platform);
    if (filters.sortBy) url.searchParams.set("sortBy", filters.sortBy);
    if (filters.sortDir) url.searchParams.set("sortDir", filters.sortDir);
    url.searchParams.set("page", String(filters.page));
    url.searchParams.set("pageSize", String(filters.pageSize));

    const key = url.toString();
    const headers: Record<string, string> = { "Content-Type": "application/json", ...sessionHeaders() };
    if (cachedResponse && cacheKey === key && !catalogStaleFromPush && booted) {
      return cachedResponse;
    }

    const diskCache = await readCacheFromDisk();
    const remoteRev = await fetchRemoteRevision(source.baseUrl, headers);

    if (diskCache && diskCache.key === key) {
      // Unreachable host / no network — last catalog on disk keeps library + store usable offline.
      if (remoteRev === null) {
        cachedResponse = diskCache.data;
        cacheKey = key;
        booted = true;
        catalogStaleFromPush = false;
        return diskCache.data;
      }
      // Revision matches server — use disk without re-downloading.
      if (typeof diskCache.revision === "number" && remoteRev === diskCache.revision) {
        catalogStaleFromPush = false;
        cachedResponse = diskCache.data;
        cacheKey = key;
        booted = true;
        return diskCache.data;
      }
    }

    return this.refreshAndPersist(url, headers, key, source.baseUrl);
  }

  async syncLibrary(onProgress: (p: SyncProgress) => void): Promise<void> {
    cachedResponse = null;
    cacheKey = "";
    booted = false;
    catalogStaleFromPush = false;
    await deleteCacheFromDisk();

    const settings = this.settingsService.getSettings();

    for (const source of settings.sources.filter((s) => s.enabled)) {
      onProgress({ sourceId: source.id, status: "connecting" });
      try {
        const res = await debugFetch(new URL("/api/games", source.baseUrl).toString(), { headers: sessionHeaders(), timeoutMs: 30000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        onProgress({ sourceId: source.id, status: "done", gamesFound: data.totalGames ?? 0 });
      } catch (err) {
        onProgress({ sourceId: source.id, status: "error", error: String(err) });
      }
    }
  }

  private async refreshAndPersist(
    url: URL,
    headers: Record<string, string>,
    key: string,
    baseUrl: string,
  ): Promise<LibraryResponse> {
    try {
      const res = await debugFetch(url.toString(), { headers, timeoutMs: 30000 });
      if (res.status === 403) {
        const body = await res.text().catch(() => "");
        if (body.includes("ACCOUNT_REVOKED")) throw new AccessRevokedError();
      }
      if (!res.ok) {
        return await this.fallbackDiskOrThrow(
          key,
          new Error(`Library fetch failed: ${res.status} ${res.statusText}`),
        );
      }

      const data = await res.json();
      const result = normalizeLibraryResponse(data);

      const revision = await fetchRemoteRevision(baseUrl, headers);

      const ts = Date.now();
      cachedResponse = result;
      cacheKey = key;
      booted = true;
      catalogStaleFromPush = false;
      await writeCacheToDisk({
        key,
        fetchedAt: ts,
        data: result,
        ...(revision !== null ? { revision } : {}),
      });

      return result;
    } catch (e) {
      if (e instanceof AccessRevokedError) throw e; // never mask revocation with cached data
      const err = e instanceof Error ? e : new Error(String(e));
      return await this.fallbackDiskOrThrow(key, err);
    }
  }

  /** When the live catalog fetch fails, return the last on-disk snapshot for this filter key. */
  private async fallbackDiskOrThrow(key: string, err: Error): Promise<LibraryResponse> {
    const disk = await readCacheFromDisk();
    if (disk && disk.key === key) {
      cachedResponse = disk.data;
      cacheKey = key;
      booted = true;
      catalogStaleFromPush = false;
      return disk.data;
    }
    throw err;
  }
}
