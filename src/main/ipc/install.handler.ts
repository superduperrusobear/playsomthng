import path from "node:path";
import { IpcMain } from "electron";
import { IpcChannel, InstallOptionsSchema, ManifestJsonSchema, IpcRequestSchema } from "../../shared/schemas";
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
import { loadLocalLibraryFile } from "../services/local-library-file.service";

export function registerInstallHandlers(ipcMain: IpcMain) {
  // ── Drive info ───────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.DRIVES_LIST, async () => {
    return listDrives();
  });

  ipcMain.handle(IpcChannel.DISK_SPACE_FOR_GAME, async (_e, raw: unknown) => {
    const { mount, requiredBytes } = IpcRequestSchema[IpcChannel.DISK_SPACE_FOR_GAME].parse(raw);
    return checkDiskSpaceForGame(mount, requiredBytes);
  });

  // ── Preferred install mount ───────────────────────────────────────────────
  ipcMain.handle(IpcChannel.INSTALL_PREF_GET, async () => {
    const mount = await getInstallPref();
    return { mount };
  });

  ipcMain.handle(IpcChannel.INSTALL_PREF_SET, async (_e, raw: unknown) => {
    const { mount } = IpcRequestSchema[IpcChannel.INSTALL_PREF_SET].parse(raw);
    await setInstallPref(mount);
    return { mount };
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
      // Defense in depth: renderer-supplied URLs must resolve to the configured
      // library origin. Reject arbitrary external hosts so a compromised renderer
      // cannot point installs at attacker-controlled servers (which would bypass
      // library download auth and write arbitrary files into the install root).
      if (!isUrlOnLibraryOrigin(manifestUrl, baseUrl)) {
        throw new Error("Manifest URL must be served by your configured library server.");
      }
      if (!isUrlOnLibraryOrigin(downloadBaseUrl, baseUrl)) {
        throw new Error("Download URL must be served by your configured library server.");
      }
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

  ipcMain.handle(IpcChannel.INSTALL_PAUSE, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.INSTALL_PAUSE].parse(raw);
    return pauseInstall(gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_RESUME, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.INSTALL_RESUME].parse(raw);
    return resumeInstall(gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_CANCEL, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.INSTALL_CANCEL].parse(raw);
    await cancelInstall(gameId);
    return { ok: true };
  });

  ipcMain.handle(IpcChannel.INSTALL_GET, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.INSTALL_GET].parse(raw);
    return readSession(gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_LIST, async () => {
    return listSessions();
  });

  ipcMain.handle(IpcChannel.INSTALL_CLEAR_COMPLETED, async () => {
    return clearCompletedSessions();
  });

  ipcMain.handle(IpcChannel.INSTALL_VERIFY, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.INSTALL_VERIFY].parse(raw);
    return verifyInstall(gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_OPEN_FOLDER, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.INSTALL_OPEN_FOLDER].parse(raw);
    return openInstallFolder(gameId);
  });

  ipcMain.handle(IpcChannel.INSTALL_LAUNCH_CANDIDATES_LIST, async (_e, raw: unknown) => {
    const { installPath } = IpcRequestSchema[IpcChannel.INSTALL_LAUNCH_CANDIDATES_LIST].parse(raw);
    return listLaunchCandidatesInInstallRoot(installPath);
  });

  ipcMain.handle(IpcChannel.LAUNCH_OVERRIDE_SET, async (_e, raw: unknown) => {
    const { gameId, launchTarget } = IpcRequestSchema[IpcChannel.LAUNCH_OVERRIDE_SET].parse(raw);
    return setLaunchOverride(gameId, launchTarget);
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  // installPath and launchTarget are resolved by the renderer (from local-library + catalog-meta).
  // This handler validates the payload and confines the resolved exe under the
  // recorded install directory before spawning.
  ipcMain.handle(IpcChannel.GAME_LAUNCH, async (_e, raw: unknown) => {
    const payload = IpcRequestSchema[IpcChannel.GAME_LAUNCH].parse(raw);

    if ("absoluteExePath" in payload) {
      const recordedInstallPath = await resolveRecordedInstallPath(payload.gameId);
      if (!recordedInstallPath) {
        return {
          ok: false,
          error: "This game is not installed on this device.",
        };
      }
      const resolved = path.resolve(payload.absoluteExePath);
      if (!isPathInside(resolved, recordedInstallPath)) {
        return {
          ok: false,
          error: "Launch target is outside the installed game folder.",
        };
      }
      return launchGame(resolved, payload.gameId);
    }

    if (!isSafeRelativeLaunchTarget(payload.launchTarget)) {
      return {
        ok: false,
        error: "Launch target is not allowed (must be relative to the install folder).",
      };
    }

    const recordedInstallPath = await resolveRecordedInstallPath(payload.gameId);
    // Prefer the on-disk record if we have one — otherwise trust the renderer payload,
    // but only accept it if it agrees with the record.
    const requestedRoot = path.resolve(payload.installPath);
    if (recordedInstallPath && !arePathsEqual(recordedInstallPath, requestedRoot)) {
      return {
        ok: false,
        error: "Install path does not match the installed location for this game.",
      };
    }
    const installRoot = recordedInstallPath ?? requestedRoot;

    const base = path.basename(installRoot);
    const segments = payload.launchTarget
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    const segs =
      segments.length > 0 && segments[0].toLowerCase() === base.toLowerCase()
        ? segments.slice(1)
        : segments;

    const execPath = path.resolve(installRoot, ...segs);
    if (!isPathInside(execPath, installRoot)) {
      return {
        ok: false,
        error: "Launch target escapes the install folder.",
      };
    }
    return launchGame(execPath, payload.gameId);
  });

  // ── Stop ─────────────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.GAME_STOP, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.GAME_STOP].parse(raw);
    return stopGame(gameId);
  });

  // ── Uninstall ─────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.GAME_UNINSTALL, async (_e, raw: unknown) => {
    const { gameId } = IpcRequestSchema[IpcChannel.GAME_UNINSTALL].parse(raw);
    return uninstallGame(gameId);
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

/**
 * True if `url` is on the same origin as the configured library base.
 * When no library base is configured (empty), no renderer-supplied URL is
 * trusted — the caller must fall back to a server-resolved lookup instead.
 */
function isUrlOnLibraryOrigin(url: string, baseUrl: string): boolean {
  if (!baseUrl) return false;
  const urlOrigin = normalizeManifestOrigin(url);
  const baseOrigin = normalizeManifestOrigin(baseUrl);
  return !!urlOrigin && urlOrigin === baseOrigin;
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

// ── Launch path safety helpers ────────────────────────────────────────────────

/** Case-insensitive on Windows/macOS, case-sensitive elsewhere. */
function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
}

function arePathsEqual(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/** True if `child` is the same as `parent` or a descendant of it. */
function isPathInside(child: string, parent: string): boolean {
  const normChild = normalizeForCompare(child);
  const normParent = normalizeForCompare(parent);
  if (normChild === normParent) return true;
  const withSep = normParent.endsWith(path.sep) ? normParent : normParent + path.sep;
  return normChild.startsWith(withSep);
}

/** Reject `..`, absolute paths, drive letters, and empty targets. */
function isSafeRelativeLaunchTarget(target: string): boolean {
  if (typeof target !== "string") return false;
  const trimmed = target.trim();
  if (!trimmed) return false;
  // Absolute (Unix) or UNC (Windows).
  if (trimmed.startsWith("/") || trimmed.startsWith("\\\\")) return false;
  // Windows drive letter, e.g. "C:\..."
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  const segments = trimmed.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.some((s) => s === "..")) return false;
  return true;
}

/** Read the recorded install path for `gameId` from the local library file. */
async function resolveRecordedInstallPath(gameId: string): Promise<string | null> {
  try {
    const lib = await loadLocalLibraryFile();
    const entry = lib.games.find((g) => g.gameId === gameId);
    if (entry?.installed && entry.installPath) {
      return path.resolve(entry.installPath);
    }
    return null;
  } catch {
    return null;
  }
}
