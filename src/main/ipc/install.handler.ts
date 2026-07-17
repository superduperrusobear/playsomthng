import path from "node:path";
import { IpcMain } from "electron";
import { IpcChannel, InstallOptionsSchema, ManifestJsonSchema } from "../../shared/schemas";
import { SettingsService } from "../services/settings.service";
import { getEnabledLibraryBaseUrl } from "../services/library-base-url";
import { ensureSystemInfoCollected } from "../services/sysinfo.service";
import { getAuthTokenForDownloads, getHardwareUuidForDownloads } from "./auth.handler";
import { makeDownloadAuthHeader } from "../services/device-key.service";
import { debugFetch } from "../utils/network-debug";
import {
  startInstall,
  pauseInstall,
  resumeInstall,
  cancelInstall,
  readSession,
  listSessions,
  listDrives,
  checkDiskSpaceForGame,
  launchGame,
  stopGame,
  verifyInstall,
  openInstallFolder,
  setLaunchOverride,
  listLaunchCandidatesInInstallRoot,
  uninstallGame,
  getInstallPref,
  setInstallPref,
  clearCompletedSessions,
  assertNoConcurrentLibraryDownload,
} from "../services/install.service";

export function registerInstallHandlers(ipcMain: IpcMain) {
  // ── Drive info ───────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.DRIVES_LIST, async () => {
    return listDrives();
  });

  ipcMain.handle(IpcChannel.DISK_SPACE_FOR_GAME, async (_e, raw: { mount: string; requiredBytes: number }) => {
    return checkDiskSpaceForGame(raw.mount, raw.requiredBytes);
  });

  // ── Preferred install mount ───────────────────────────────────────────────
  ipcMain.handle(IpcChannel.INSTALL_PREF_GET, async () => {
    const mount = await getInstallPref();
    return { mount };
  });

  ipcMain.handle(IpcChannel.INSTALL_PREF_SET, async (_e, raw: { mount: string }) => {
    await setInstallPref(raw.mount);
    return { mount: raw.mount };
  });

  // ── Install lifecycle ─────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.INSTALL_START, async (_e, raw: unknown) => {
    const opts = InstallOptionsSchema.parse(raw);

    await assertNoConcurrentLibraryDownload(opts.gameId);

    const baseUrl = getEnabledLibraryBaseUrl();

    // Prefer URLs from the renderer (already validated by the same library fetch the user sees).
    let manifestUrl: string;
    let downloadBaseUrl: string;
    let title: string;

    if (opts.manifestUrl && opts.downloadBaseUrl && opts.gameTitle) {
      manifestUrl = resolveAgainstBase(opts.manifestUrl, baseUrl);
      downloadBaseUrl = resolveAgainstBase(opts.downloadBaseUrl, baseUrl);
      title = opts.gameTitle;
    } else {
      const gameRes = await _fetchLibraryGame(opts.gameId, baseUrl);
      if (!gameRes) {
        throw new Error(
          `Could not resolve catalog entry for gameId ${opts.gameId}. ` +
            `Check Settings → library source base URL matches your server, or add the game again.`,
        );
      }
      ({ manifestUrl, downloadBaseUrl, title } = gameRes);
    }

    await ensureSystemInfoCollected();
    const manifestOrigin = normalizeManifestOrigin(manifestUrl);
    const baseOrigin = normalizeManifestOrigin(baseUrl);
    if (manifestOrigin === baseOrigin && !getAuthTokenForDownloads()) {
      throw new Error(
        "Sign in with your library account to download and install games from this server.",
      );
    }
    const manifestHeaders: Record<string, string> = { Accept: "application/json" };
    const token = getAuthTokenForDownloads();
    const hw = getHardwareUuidForDownloads();
    if (token) manifestHeaders.Authorization = `Bearer ${token}`;
    if (hw) manifestHeaders["X-Hardware-Uuid"] = hw;
    manifestHeaders["X-Download-Auth"] = makeDownloadAuthHeader();
    const mRes = await debugFetch(manifestUrl, { headers: manifestHeaders, timeoutMs: 30000 });
    if (!mRes.ok) {
      const errBody = await mRes.text().catch(() => "");
      if (mRes.status === 503) {
        throw new Error("Server busy.");
      }
      throw new Error(
        errBody.trim()
          ? `Manifest fetch failed (HTTP ${mRes.status}): ${errBody.slice(0, 200)}`
          : `Manifest fetch failed: HTTP ${mRes.status}`,
      );
    }
    const manifest = ManifestJsonSchema.parse(await mRes.json());

    return startInstall(opts, manifest, title, downloadBaseUrl);
  });

  ipcMain.handle(IpcChannel.INSTALL_PAUSE, async (_e, raw: { gameId: string }) => {
    return pauseInstall(raw.gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_RESUME, async (_e, raw: { gameId: string }) => {
    return resumeInstall(raw.gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_CANCEL, async (_e, raw: { gameId: string }) => {
    await cancelInstall(raw.gameId);
    return { ok: true };
  });

  ipcMain.handle(IpcChannel.INSTALL_GET, async (_e, raw: { gameId: string }) => {
    return readSession(raw.gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_LIST, async () => {
    return listSessions();
  });

  ipcMain.handle(IpcChannel.INSTALL_CLEAR_COMPLETED, async () => {
    return clearCompletedSessions();
  });

  ipcMain.handle(IpcChannel.INSTALL_VERIFY, async (_e, raw: { gameId: string }) => {
    return verifyInstall(raw.gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_OPEN_FOLDER, async (_e, raw: { gameId: string }) => {
    return openInstallFolder(raw.gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_LAUNCH_CANDIDATES_LIST, async (_e, raw: { installPath: string }) => {
    return listLaunchCandidatesInInstallRoot(raw.installPath);
  });

  ipcMain.handle(IpcChannel.LAUNCH_OVERRIDE_SET, async (_e, raw: { gameId: string; launchTarget: string | null }) => {
    return setLaunchOverride(raw.gameId, raw.launchTarget);
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  // installPath and launchTarget are resolved by the renderer (from local-library + catalog-meta).
  // This handler just joins them into a full exe path and spawns it.
  ipcMain.handle(
    IpcChannel.GAME_LAUNCH,
    async (
      _e,
      raw:
        | { gameId: string; installPath: string; launchTarget: string }
        | { gameId: string; absoluteExePath: string },
    ) => {
      if ("absoluteExePath" in raw) {
        return launchGame(raw.absoluteExePath, raw.gameId);
      }
      const base = path.basename(raw.installPath);
      const segments = raw.launchTarget
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean);
      const segs =
        segments.length > 0 && segments[0].toLowerCase() === base.toLowerCase()
          ? segments.slice(1)
          : segments;

      const execPath = path.join(raw.installPath, ...segs);
      return launchGame(execPath, raw.gameId);
    },
  );

  // ── Stop ─────────────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.GAME_STOP, async (_e, raw: { gameId: string }) => {
    return stopGame(raw.gameId);
  });

  // ── Uninstall ─────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.GAME_UNINSTALL, async (_e, raw: { gameId: string }) => {
    return uninstallGame(raw.gameId);
  });
}

// ── Internal helper: resolve catalog entry (same source as LibraryService) ────

type GameRef = { manifestUrl: string; downloadBaseUrl: string; title: string };

async function _fetchLibraryGame(gameId: string, baseUrl: string): Promise<GameRef | null> {
  try {
    const svc = new SettingsService();
    const settings = svc.getSettings();
    const enabled = settings.sources.filter((s) => s.enabled);
    if (enabled.length === 0) return null;

    const source = enabled[0];
    // Single-game lookup — server matches slug OR stable UUID (see catalog_entry_matches_param).
    const url = new URL(`/api/games/${encodeURIComponent(gameId)}`, source.baseUrl);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (source.apiKey) headers["Authorization"] = `Bearer ${source.apiKey}`;

    const res = await debugFetch(url.toString(), { headers, timeoutMs: 15000 });
    if (!res.ok) return null;

    const g = (await res.json()) as {
      error?: string;
      name?: string;
      manifestUrl?: string;
      downloadBaseUrl?: string;
    };
    if (g.error === "NOT_FOUND" || !g.manifestUrl || !g.downloadBaseUrl || !g.name) {
      return null;
    }

    return {
      manifestUrl: resolveAgainstBase(g.manifestUrl, baseUrl),
      downloadBaseUrl: resolveAgainstBase(g.downloadBaseUrl, baseUrl),
      title: g.name,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the admin-defined launchTarget from catalog-meta for a given gameId (UUID or slug).
 * Returns null if the server can't be reached or the field is unset.
 */
async function _resolveCatalogLaunchTarget(gameId: string): Promise<string | null> {
  try {
    const svc = new SettingsService();
    const src = svc.getSettings().sources.find((s) => s.enabled);
    if (!src) return null;
    const base = src.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getAuthTokenForDownloads();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await debugFetch(`${base}/api/admin/catalog-meta/${encodeURIComponent(gameId)}`, { headers, timeoutMs: 15000 });
    if (!res.ok) return null;
    const data = (await res.json()) as { launchTarget?: string | null };
    return data.launchTarget ?? null;
  } catch {
    return null;
  }
}

function normalizeManifestOrigin(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}`;
  } catch {
    return "";
  }
}

/** Relative paths resolve against the library source base (same as renderer). */
function resolveAgainstBase(pathOrUrl: string, baseUrl: string): string {
  const t = pathOrUrl.trim();
  try {
    return new URL(t, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
  } catch {
    return t;
  }
}
