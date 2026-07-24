/**
 * Install / download engine.
 *
 * Flow:
 *   1. startInstall()  — create session, queue files from manifest, begin download loop
 *   2. Download loop   — sequential, stream to disk, update progress, push events to renderer
 *   3. On complete     — verify launch target, mark game installed in user-library.json
 *   4. On restart      — resumeInstall() continues incomplete sessions
 *
 * Sessions persist in `{dataDir}/install-sessions/{gameId}.json`.
 * One active download at a time per game; multiple games can run concurrently (simple map).
 */

import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import http from "node:http";
import https from "node:https";
import { BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

import type {
  InstallSession,
  InstallOptions,
  FileDownloadEntry,
  InstallProgressEvent,
  LocalLibraryGameEntry,
} from "../../shared/schemas";
import { formatLaunchCommandPreview, needsShellLaunch } from "../../shared/launchCommand";
import type { ManifestJson } from "../../shared/schemas";
import { getAppPaths } from "./app-paths.service";
import { loadLocalLibraryFile, saveLocalLibraryFile } from "./local-library-file.service";
import { getAuthTokenForDownloads, getHardwareUuidForDownloads } from "../ipc/auth.handler";
import { makeDownloadAuthHeader } from "./device-key.service";
import { getEnabledLibraryBaseUrl } from "./library-base-url";
import { getCachedSystemInfo, ensureSystemInfoCollected } from "./sysinfo.service";
import { playtimeStart, playtimeStop } from "../ipc/playtime.handler";

// ── Paths ─────────────────────────────────────────────────────────────────────

function sessionsDir(): string {
  return path.join(getAppPaths().dataDir, "install-sessions");
}

function sessionPath(gameId: string): string {
  return path.join(sessionsDir(), `${gameId}.json`);
}

// ── Active jobs (in-memory abort controllers) ─────────────────────────────────

const activeAborts = new Map<string, AbortController>();
const activeProcs = new Map<string, import("node:child_process").ChildProcess>();

/** Serialize HTTP downloads against the library server so only one file streams at a time (matches server per-user limit). */
let libraryDownloadChain: Promise<void> = Promise.resolve();

// Reuse sockets across many small file requests to reduce connect churn/timeouts.
const sharedHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 6,
});
const sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 6,
});

function enqueueLibraryDownload<T>(fn: () => Promise<T>): Promise<T> {
  const next = libraryDownloadChain.then(() => fn());
  libraryDownloadChain = next.then(() => {}).catch(() => {});
  return next;
}

function normalizeUrlOrigin(u: string): string {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}`;
  } catch {
    return "";
  }
}

function isLibraryServerUrl(remoteUrl: string): boolean {
  const base = getEnabledLibraryBaseUrl();
  return normalizeUrlOrigin(remoteUrl) === normalizeUrlOrigin(base);
}

import { logger } from "../utils/logger";

class ServerBusyError extends Error {
  readonly code = "SERVER_BUSY";
  constructor(
    readonly retryAfterSeconds: number,
    message?: string,
  ) {
    super(message ?? "Download queue busy");
    this.name = "ServerBusyError";
  }
}

function formatDownloadFailure(err: unknown): string {
  if (err instanceof ServerBusyError) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Session persistence ───────────────────────────────────────────────────────

export async function readSession(gameId: string): Promise<InstallSession | null> {
  try {
    const raw = await fs.readFile(sessionPath(gameId), "utf8");
    return JSON.parse(raw) as InstallSession;
  } catch {
    return null;
  }
}

export async function writeSession(session: InstallSession): Promise<void> {
  await fs.mkdir(sessionsDir(), { recursive: true });
  session.updatedAt = unixNow();
  await fs.writeFile(sessionPath(session.gameId), JSON.stringify(session, null, 2), "utf8");
}

export async function deleteSession(gameId: string): Promise<void> {
  try { await fs.unlink(sessionPath(gameId)); } catch { /* already gone */ }
}

const COMPLETED_SESSION_MAX_AGE_SEC = 6 * 60 * 60; // 6 hours
const CLEANUP_INTERVAL_MS = COMPLETED_SESSION_MAX_AGE_SEC * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

async function readAllSessionsFromDisk(): Promise<InstallSession[]> {
  try {
    const dir = sessionsDir();
    const entries = await fs.readdir(dir);
    const sessions = await Promise.all(
      entries
        .filter((e) => e.endsWith(".json"))
        .map((e) => readSession(e.replace(".json", ""))),
    );
    return sessions.filter((s): s is InstallSession => s !== null);
  } catch {
    return [];
  }
}

async function pruneCompletedSessions(
  sessions: InstallSession[],
  maxAgeSeconds = COMPLETED_SESSION_MAX_AGE_SEC,
): Promise<InstallSession[]> {
  const cutoff = unixNow() - maxAgeSeconds;
  const keep: InstallSession[] = [];

  for (const s of sessions) {
    const lastUpdate = s.updatedAt ?? s.createdAt ?? 0;
    if (s.state === "completed" && lastUpdate < cutoff) {
      await deleteSession(s.gameId);
      activeAborts.delete(s.gameId);
      activeProcs.delete(s.gameId);
      continue;
    }
    keep.push(s);
  }

  return keep;
}

export async function listSessions(): Promise<InstallSession[]> {
  const sessions = await readAllSessionsFromDisk();
  return pruneCompletedSessions(sessions);
}

/**
 * Block starting another install while any game is actively downloading (one stream at a time UX).
 */
export async function assertNoConcurrentLibraryDownload(gameId: string): Promise<void> {
  const sessions = await listSessions();
  const active = sessions.find((s) => s.state === "downloading");
  if (!active) return;
  if (active.gameId === gameId) {
    throw new Error(
      "This game is already downloading. Watch its progress on the library card, or wait until it finishes.",
    );
  }
  throw new Error(
    "You can’t download two games at once. Wait for the current install to finish, or pause or cancel it. You can install this title later from your library when nothing else is downloading.",
  );
}

export async function cleanupCompletedSessions(
  maxAgeSeconds = COMPLETED_SESSION_MAX_AGE_SEC,
): Promise<InstallSession[]> {
  const sessions = await readAllSessionsFromDisk();
  return pruneCompletedSessions(sessions, maxAgeSeconds);
}

export async function clearCompletedSessions(): Promise<{ removed: number; sessions: InstallSession[] }> {
  const sessions = await readAllSessionsFromDisk();
  let removed = 0;
  const keep: InstallSession[] = [];

  for (const s of sessions) {
    if (s.state === "completed") {
      removed += 1;
      await deleteSession(s.gameId);
      activeAborts.delete(s.gameId);
      activeProcs.delete(s.gameId);
      continue;
    }
    keep.push(s);
  }

  return { removed, sessions: keep };
}

export function startInstallHousekeeping(): void {
  if (cleanupTimer) return;
  void cleanupCompletedSessions();
  cleanupTimer = setInterval(() => { void cleanupCompletedSessions(); }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the interval is still scheduled.
  cleanupTimer.unref?.();
}

// ── Preferred install mount ───────────────────────────────────────────────────

const PREF_FILE = () => path.join(getAppPaths().dataDir, "install-pref.json");

export async function getInstallPref(): Promise<string | null> {
  try {
    const raw = await fs.readFile(PREF_FILE(), "utf8");
    return (JSON.parse(raw) as { mount: string }).mount ?? null;
  } catch {
    return null;
  }
}

export async function setInstallPref(mount: string): Promise<void> {
  await fs.mkdir(getAppPaths().dataDir, { recursive: true });
  await fs.writeFile(PREF_FILE(), JSON.stringify({ mount }), "utf8");
}

// ── Drive listing ─────────────────────────────────────────────────────────────

type SysInfoDisk = {
  fs: string; type: string; size: number;
  available: number; used: number; use: number; mount: string;
};

type SysInfoSnapshot = { disks: SysInfoDisk[] };

export async function listDrives() {
  try {
    // Use the sysinfo snapshot that's already been collected at startup.
    let snap = getCachedSystemInfo() as SysInfoSnapshot | null;
    if (!snap) {
      snap = (await ensureSystemInfoCollected()) as SysInfoSnapshot;
    }
    const disks: SysInfoDisk[] = snap?.disks ?? [];
    return disks
      .filter((d) => d.size > 0)
      .map((d) => ({
        mount: d.mount,
        label: driveLabel(d.mount),
        type: d.type,
        size: d.size,
        available: d.available,
        used: d.used,
        usePercent: d.use,
        isSystem: /^C(:\\|:|\/)?$/i.test(d.mount) || d.mount === "/",
      }));
  } catch {
    return [];
  }
}

function driveLabel(mount: string): string {
  // Normalise slashes and strip trailing slash for comparison
  const norm = mount.replace(/\\/g, "/").replace(/\/$/, "");
  // Windows drive letters: "C:" or "C:/" → "Local Disk (C:)"
  const winMatch = norm.match(/^([A-Za-z]):/);
  if (winMatch) {
    const letter = winMatch[1].toUpperCase();
    if (letter === "C") return `Local Disk (${letter}:)`;
    return `Storage ${letter} (${letter}:)`;
  }
  // Linux/macOS: show mount point
  return mount;
}

export async function checkDiskSpaceForGame(mount: string, requiredBytes: number) {
  const drives = await listDrives();
  const d = drives.find((dr) => dr.mount === mount || dr.mount.startsWith(mount));
  return {
    hasSufficient: d ? d.available >= requiredBytes : false,
    availableBytes: d?.available ?? 0,
    requiredBytes,
    mount,
  };
}

// ── Install start ─────────────────────────────────────────────────────────────

export async function startInstall(
  opts: InstallOptions,
  manifest: ManifestJson,
  gameTitle: string,
  downloadBaseUrl: string,
): Promise<InstallSession> {
  const gameDir = path.join(opts.installRoot, manifest.id);
  const files: FileDownloadEntry[] = manifest.files.map((f) => ({
    relativePath: f.path,
    sizeBytes: f.size,
    remoteUrl: `${downloadBaseUrl.replace(/\/$/, "")}/${f.path}`,
    localPath: path.join(gameDir, ...f.path.split("/")),
    status: "pending" as const,
    downloadedBytes: 0,
    error: null,
    hash: f.hash ?? null,
  }));

  const session: InstallSession = {
    gameId: opts.gameId,
    gameTitle,
    downloadBaseUrl,
    manifestUrl: manifest.id,
    installRoot: gameDir,
    totalBytes: manifest.totalBytes,
    downloadedBytes: 0,
    state: "downloading",
    launchTarget: manifest.launchTarget ?? null,
    files,
    createdAt: unixNow(),
    updatedAt: unixNow(),
    error: null,
  };

  await writeSession(session);

  if (opts.rememberDrive) {
    // Remember the drive letter / mount point
    const mountRe = /^[A-Za-z]:(\\|\/)?/;
    const m = opts.installRoot.match(mountRe);
    if (m) await setInstallPref(m[0].replace(/[\\/]$/, "") + "\\");
    else await setInstallPref(opts.installRoot.split(path.sep)[0] + path.sep);
  }

  // Kick off async without awaiting
  void runDownload(session);

  return session;
}

// ── Download loop ─────────────────────────────────────────────────────────────

async function runDownload(session: InstallSession): Promise<void> {
  const abort = new AbortController();
  activeAborts.set(session.gameId, abort);

  try {
    for (const file of session.files) {
      if (abort.signal.aborted) break;
      if (file.status === "done") continue;

      file.status = "downloading";
      pushProgress(session, true);

      try {
        await downloadFile(
          file,
          abort.signal,
          (chunk) => {
            file.downloadedBytes += chunk;
            session.downloadedBytes += chunk;
            pushProgress(session);
          },
          (baseBytes) => {
            // Resync counters to what's actually on disk (resume or restart).
            session.downloadedBytes += baseBytes - file.downloadedBytes;
            file.downloadedBytes = baseBytes;
            pushProgress(session);
          },
        );
        // Verify hash if the manifest provided one — protects against a
        // compromised or misconfigured download origin.
        const expected = getExpectedHash(file);
        if (expected) {
          const actual = await sha256OfFile(file.localPath);
          if (actual !== expected.value) {
            throw new Error(
              `Downloaded file failed integrity check (${expected.algorithm}: expected ${short(expected.value)}, got ${short(actual)}).`,
            );
          }
        }
        file.status = "done";
      } catch (err) {
        if (abort.signal.aborted) break;
        file.status = "failed";
        const msg = formatDownloadFailure(err);
        file.error = msg;
        // Keep it short — no filename prefix, the message alone.
        session.error = msg;
        // Stop the loop on first failure. Steam stops the download and shows an error.
        break;
      }

      await writeSession(session);
    }

    if (!abort.signal.aborted) {
      const allDone = session.files.every((f) => f.status === "done");
      session.state = allDone ? "completed" : "error";
      await writeSession(session);

      if (allDone) {
        await markInstalled(session);
      }

      pushProgress(session, true);
    }
  } finally {
    activeAborts.delete(session.gameId);
    lastPushTime.delete(session.gameId);
  }
}

async function downloadFile(
  file: FileDownloadEntry,
  signal: AbortSignal,
  onChunk: (bytes: number) => void,
  onResume: (baseBytes: number) => void,
): Promise<void> {
  await fs.mkdir(path.dirname(file.localPath), { recursive: true });
  await ensureSystemInfoCollected();

  if (isLibraryServerUrl(file.remoteUrl)) {
    const token = getAuthTokenForDownloads();
    if (!token) {
      throw new Error("Sign in with your library account to download games.");
    }
    return enqueueLibraryDownload(() => downloadFileWithRetries(file, signal, onChunk, onResume));
  }

  return downloadFileWithRetries(file, signal, onChunk, onResume);
}

const SERVER_BUSY_MAX_ATTEMPTS = 24;
const TRANSIENT_NETWORK_MAX_ATTEMPTS = 6;

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as NodeJS.ErrnoException;
  const code = e.code ?? "";
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "ENETUNREACH" ||
    code === "ECONNREFUSED"
  ) {
    return true;
  }
  const msg = err.message.toLowerCase();
  return msg.includes("socket hang up") || msg.includes("connect timeout");
}

async function downloadFileWithRetries(
  file: FileDownloadEntry,
  signal: AbortSignal,
  onChunk: (bytes: number) => void,
  onResume: (baseBytes: number) => void,
): Promise<void> {
  for (let attempt = 0; attempt < SERVER_BUSY_MAX_ATTEMPTS; attempt++) {
    if (signal.aborted) throw new Error("Aborted");
    try {
      await downloadFileOnce(file, signal, onChunk, onResume);
      return;
    } catch (err) {
      if (signal.aborted) throw new Error("Aborted");
      if (err instanceof ServerBusyError && attempt < SERVER_BUSY_MAX_ATTEMPTS - 1) {
        const sec = Math.min(120, Math.max(1, err.retryAfterSeconds));
        await sleep(sec * 1000);
        continue;
      }
      if (isTransientNetworkError(err) && attempt < TRANSIENT_NETWORK_MAX_ATTEMPTS - 1) {
        // Short exponential backoff for flaky WAN links.
        const backoffMs = Math.min(12_000, 1500 * (attempt + 1));
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }
  }
}

function buildLibraryDownloadHeaders(): Record<string, string> {
  const token = getAuthTokenForDownloads();
  if (!token) throw new Error("Sign in with your library account to download games.");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Download-Auth": makeDownloadAuthHeader(),
  };
  const hw = getHardwareUuidForDownloads();
  if (hw) headers["X-Hardware-Uuid"] = hw;
  return headers;
}

async function downloadFileOnce(
  file: FileDownloadEntry,
  signal: AbortSignal,
  onChunk: (bytes: number) => void,
  onResume: (baseBytes: number) => void,
): Promise<void> {
  const useLibraryAuth = isLibraryServerUrl(file.remoteUrl);
  // Hardware id rides in the X-Hardware-Uuid header only — never the query string —
  // so it never lands in reverse-proxy / CDN access logs.
  const extraHeaders = useLibraryAuth ? buildLibraryDownloadHeaders() : undefined;
  const requestUrl = file.remoteUrl;

  // Resume from whatever survived on disk (Range) instead of restarting the file.
  let resumeFrom = 0;
  const existing = await fs.stat(file.localPath).catch(() => null);
  if (existing?.isFile() && file.sizeBytes > 0) {
    if (existing.size === file.sizeBytes) {
      onResume(file.sizeBytes);
      return;
    }
    if (existing.size > 0 && existing.size < file.sizeBytes) resumeFrom = existing.size;
    // size > expected → corrupt; fall through and rewrite from zero.
  }
  const headers: Record<string, string> = {
    ...(extraHeaders ?? {}),
    ...(resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {}),
  };

  logger.info(
    `[NET_REQ] START STREAM: GET ${requestUrl.split("?")[0]}${resumeFrom > 0 ? ` (resume @${resumeFrom})` : ""}`,
  );

  await new Promise<void>((resolve, reject) => {
    const url = new URL(requestUrl);
    const transport = url.protocol === "https:" ? https : http;
    const agent = url.protocol === "https:" ? sharedHttpsAgent : sharedHttpAgent;

    let isDone = false;

    const cleanup = () => {
      if (isDone) return;
      isDone = true;
      signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      req.destroy();
      reject(new Error("Aborted"));
    };

    const req = transport.get(
      url,
      { headers, agent },
      (res) => {
        if (res.statusCode === 503) {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            cleanup();
            let retryAfter = 15;
            let reason: string | undefined;
            try {
              const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                retryAfterSeconds?: number;
                reason?: string;
              };
              if (typeof j.retryAfterSeconds === "number") retryAfter = j.retryAfterSeconds;
              if (typeof j.reason === "string") reason = j.reason;
            } catch {
              /* use defaults */
            }
            // Short, fixed labels — never the server's long prose.
            const msg = reason === "user_busy" ? "Can only download one" : "Download queue busy";
            reject(new ServerBusyError(retryAfter, msg));
          });
          res.on("error", (err) => {
            cleanup();
            reject(err);
          });
          return;
        }

        if ((res.statusCode ?? 0) >= 400) {
          cleanup();
          logger.error(`[NET_ERR] FAILED STREAM: GET ${requestUrl.split("?")[0]} -> HTTP ${res.statusCode}`);
          reject(new Error(`HTTP ${res.statusCode ?? "?"} for ${requestUrl.split("?")[0]}`));
          res.resume();
          return;
        }

        logger.info(`[NET_RES] STREAM OK: GET ${requestUrl.split("?")[0]} -> HTTP ${res.statusCode}`);
        // 206 → append to the partial; 200 → server sent the whole file, start over.
        const resumed = res.statusCode === 206 && resumeFrom > 0;
        onResume(resumed ? resumeFrom : 0);
        const ws = createWriteStream(file.localPath, resumed ? { flags: "a" } : undefined);
        res.on("data", (chunk: Buffer) => onChunk(chunk.byteLength));

        pipeline(res, ws)
          .then(() => {
            cleanup();
            resolve();
          })
          .catch((err) => {
            cleanup();
            reject(err);
          });
      },
    );

    req.on("error", (err) => {
      cleanup();
      reject(err);
    });

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort);
    }
  });
}

// ── Pause / resume / cancel ───────────────────────────────────────────────────

export async function pauseInstall(gameId: string): Promise<InstallSession | null> {
  activeAborts.get(gameId)?.abort();
  activeAborts.delete(gameId);
  const session = await readSession(gameId);
  if (!session) return null;
  session.state = "paused";
  session.files.forEach((f) => { if (f.status === "downloading") f.status = "pending"; });
  await writeSession(session);
  return session;
}

export async function resumeInstall(gameId: string): Promise<InstallSession | null> {
  const session = await readSession(gameId);
  if (!session) return null;
  session.state = "downloading";
  await writeSession(session);
  void runDownload(session);
  return session;
}

export async function cancelInstall(gameId: string): Promise<void> {
  activeAborts.get(gameId)?.abort();
  activeAborts.delete(gameId);
  const session = await readSession(gameId);
  if (session && session.installRoot) {
    try {
      await fs.rm(session.installRoot, { recursive: true, force: true });
    } catch {
      // Ignore errors if the folder is already gone or locked
    }
  }
  await deleteSession(gameId);
}

// ── Completion: mark installed in user-library.json ──────────────────────────

async function markInstalled(session: InstallSession): Promise<void> {
  const lib = await loadLocalLibraryFile();
  const idx = lib.games.findIndex((g) => g.gameId === session.gameId);
  if (idx >= 0) {
    lib.games[idx] = {
      ...lib.games[idx],
      installed: true,
      installPath: session.installRoot,
      downloadState: "completed",
    };
  } else {
    lib.games.push({
      gameId: session.gameId,
      installed: true,
      installPath: session.installRoot,
      installedVersion: null,
      downloadState: "completed",
      lastPlayedAt: null,
      pinned: false,
      source: "server",
    });
  }
  await saveLocalLibraryFile(lib);
}

// ── Game launch ───────────────────────────────────────────────────────────────

/**
 * Launch a game given its fully-resolved executable path.
 * Path resolution happens in the IPC handler before this is called.
 */
export async function launchGame(
  execPath: string,
  gameId?: string,
): Promise<{ ok: boolean; pid?: number; error?: string }> {
  try {
    await fs.access(execPath);
  } catch {
    return {
      ok: false,
      error: `Executable not found: ${execPath} — verify your install folder`,
    };
  }

  const paths = getAppPaths();
  let entry: LocalLibraryGameEntry | undefined;
  if (gameId) {
    const lib = await loadLocalLibraryFile();
    entry = lib.games.find((g) => g.gameId === gameId);
  }

  const cwd = path.dirname(execPath);
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pv = entry?.protonVersion?.trim();
  if (pv) env.PROTON_VERSION = pv;

  const flags = entry?.launchFlags ?? undefined;
  const shellLaunch = needsShellLaunch(paths.platformFamily, flags);

  if (flags?.customFlags && !isSafeCustomFlagString(flags.customFlags)) {
    return {
      ok: false,
      error:
        "Custom launch flags contain disallowed characters (shell metacharacters are not permitted).",
    };
  }

  if (gameId) playtimeStart(gameId);

  const attachExit = (child: ReturnType<typeof spawn>) => {
    child.unref();
    if (gameId) activeProcs.set(gameId, child);
    child.on("exit", () => {
      if (gameId) {
        playtimeStop(gameId);
        activeProcs.delete(gameId);
        pushGameExit(gameId);
      }
    });
  };

  if (shellLaunch && flags) {
    const preview = formatLaunchCommandPreview({
      execPath,
      launchFlags: flags,
      platformFamily: paths.platformFamily,
    });
    const child = spawn(preview, {
      shell: true,
      detached: true,
      stdio: "ignore",
      cwd,
      env,
    });
    attachExit(child);
    return { ok: true, pid: child.pid };
  }

  // No shell: optional env-only flags
  const spawnEnv = { ...env };
  if (flags?.skipIntro) spawnEnv.SKIP_INTRO = "1";

  const argv: string[] = [];
  if (flags?.windowed) argv.push("-windowed");

  const child = spawn(execPath, argv, {
    detached: true,
    stdio: "ignore",
    cwd,
    env: spawnEnv,
  });
  attachExit(child);

  return { ok: true, pid: child.pid };
}

export async function stopGame(gameId: string): Promise<{ ok: boolean; error?: string }> {
  const proc = activeProcs.get(gameId);
  if (!proc || proc.killed) {
    return { ok: false, error: "Game is not running" };
  }
  try {
    proc.kill();
    activeProcs.delete(gameId);
    playtimeStop(gameId);
    pushGameExit(gameId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function openInstallFolder(gameId: string): Promise<{ ok: boolean; error?: string }> {
  const lib = await loadLocalLibraryFile();
  const entry = lib.games.find((g) => g.gameId === gameId);
  const session = await readSession(gameId);
  const installPath = entry?.installPath ?? session?.installRoot ?? null;
  if (!installPath) return { ok: false, error: "No install path recorded for this game" };
  let revealPath = installPath;
  try {
    const st = await fs.stat(installPath);
    if (st.isFile()) revealPath = path.dirname(installPath);
  } catch {
    /* fall back to installPath */
  }
  const result = await shell.openPath(revealPath);
  if (result) return { ok: false, error: result };
  return { ok: true };
}

export async function verifyInstall(gameId: string): Promise<{ ok: boolean; missing: number; mismatched: number; error?: string }> {
  const session = await readSession(gameId);
  if (!session) return { ok: false, missing: 0, mismatched: 0, error: "No install session saved for this game" };

  let missing = 0;
  let mismatched = 0;

  for (const f of session.files) {
    try {
      const stat = await fs.stat(f.localPath);
      if (stat.size !== f.sizeBytes) {
        mismatched += 1;
        continue;
      }
      const expected = getExpectedHash(f);
      if (expected && expected.algorithm === "sha256") {
        const actual = await sha256OfFile(f.localPath);
        if (actual !== expected.value) mismatched += 1;
      }
    } catch {
      missing += 1;
    }
  }

  return { ok: missing === 0 && mismatched === 0, missing, mismatched };
}

export async function setLaunchOverride(gameId: string, launchTarget: string | null): Promise<{ ok: boolean; error?: string }> {
  const lib = await loadLocalLibraryFile();
  const idx = lib.games.findIndex((g) => g.gameId === gameId);
  if (idx < 0) return { ok: false, error: "Game not in local library" };
  lib.games[idx] = { ...lib.games[idx], launchOverride: launchTarget ?? null };
  await saveLocalLibraryFile(lib);
  return { ok: true };
}

// ── Launch candidates (scan install folder for user override dropdown) ─────

const LAUNCH_SCAN_MAX_DEPTH = 12;
const LAUNCH_SCAN_MAX_FILES = 5000;
const SKIP_LAUNCH_SCAN_DIRS = new Set(["node_modules", ".git", "__pycache__", ".svn", ".hg"]);

function shouldSkipLaunchScanDir(name: string): boolean {
  return SKIP_LAUNCH_SCAN_DIRS.has(name);
}

async function fileIsLaunchCandidate(absPath: string, name: string): Promise<boolean> {
  const lower = name.toLowerCase();
  if (process.platform === "win32") {
    return lower.endsWith(".exe") || lower.endsWith(".bat") || lower.endsWith(".cmd");
  }
  if (process.platform === "darwin") {
    return lower.endsWith(".command") || lower.endsWith(".sh");
  }
  const ext = path.extname(name).toLowerCase();
  if ([".sh", ".bin", ".run", ".x86_64", ".appimage"].includes(ext)) return true;
  if (!ext) {
    try {
      const st = await fs.stat(absPath);
      return st.isFile() && (st.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }
  return false;
}

async function collectMacOSBundleBinaries(
  appDir: string,
  relPrefix: string,
  out: string[],
  seen: Set<string>,
): Promise<void> {
  const macos = path.join(appDir, "Contents", "MacOS");
  try {
    const st = await fs.stat(macos);
    if (!st.isDirectory()) return;
  } catch {
    return;
  }
  const entries = await fs.readdir(macos, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const ent of entries) {
    if (!ent.isFile() || out.length >= LAUNCH_SCAN_MAX_FILES) break;
    const rel = `${relPrefix}/Contents/MacOS/${ent.name}`.replace(/\\/g, "/");
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
}

async function walkLaunchCandidates(
  dir: string,
  relPrefix: string,
  depth: number,
  out: string[],
  seen: Set<string>,
): Promise<void> {
  if (depth > LAUNCH_SCAN_MAX_DEPTH || out.length >= LAUNCH_SCAN_MAX_FILES) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const ent of entries) {
    if (out.length >= LAUNCH_SCAN_MAX_FILES) return;
    const full = path.join(dir, ent.name);
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    const relNorm = rel.replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (shouldSkipLaunchScanDir(ent.name)) continue;
      if (process.platform === "darwin" && ent.name.toLowerCase().endsWith(".app")) {
        await collectMacOSBundleBinaries(full, relNorm, out, seen);
        continue;
      }
      await walkLaunchCandidates(full, relNorm, depth + 1, out, seen);
    } else if (ent.isFile()) {
      if (await fileIsLaunchCandidate(full, ent.name)) {
        if (!seen.has(relNorm)) {
          seen.add(relNorm);
          out.push(relNorm);
        }
      }
    }
  }
}

/**
 * Recursively list files under `installPath` that are reasonable launch targets,
 * as paths relative to the install root (forward slashes).
 */
export async function listLaunchCandidatesInInstallRoot(
  installPathRaw: string,
): Promise<{ relativePaths: string[]; error?: string }> {
  let root: string;
  try {
    root = path.resolve(installPathRaw.trim());
    const st = await fs.stat(root);
    if (!st.isDirectory()) {
      return { relativePaths: [], error: "Install path is not a folder" };
    }
  } catch {
    return { relativePaths: [], error: "Install folder not found" };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  await walkLaunchCandidates(root, "", 0, out, seen);
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return { relativePaths: out };
}

// ── Uninstall ─────────────────────────────────────────────────────────────────

/**
 * Fully uninstall a game:
 *   1. Abort any active download
 *   2. Delete the installed files from disk
 *   3. Remove the install session
 *   4. Mark the library entry as not_installed (keeps the entry in the library)
 */
export async function uninstallGame(gameId: string): Promise<{ ok: boolean; error?: string }> {
  // Stop active download if any
  activeAborts.get(gameId)?.abort();
  activeAborts.delete(gameId);

  const lib = await loadLocalLibraryFile();
  const entry = lib.games.find((g) => g.gameId === gameId);
  const session = await readSession(gameId);

  const installPath = entry?.installPath ?? session?.installRoot ?? null;

  if (installPath) {
    try {
      await fs.rm(installPath, { recursive: true, force: true });
    } catch {
      // Non-fatal — files may already be gone
    }
  }

  await deleteSession(gameId);

  // Keep the library entry but mark it uninstalled
  const idx = lib.games.findIndex((g) => g.gameId === gameId);
  if (idx >= 0) {
    lib.games[idx] = {
      ...lib.games[idx],
      installed: false,
      installPath: null,
      downloadState: "not_installed",
    };
    await saveLocalLibraryFile(lib);
  }

  return { ok: true };
}

// ── Directory size (Settings → Storage) ─────────────────────────────────────

/**
 * Total byte size of a file or directory (recursive). Skips unreadable entries.
 */
export async function getDirectorySizeBytes(targetPath: string): Promise<{ bytes: number; error?: string }> {
  try {
    const st = await fs.stat(targetPath);
    if (st.isFile()) return { bytes: st.size };
    const bytes = await recurseDirectorySize(targetPath);
    return { bytes };
  } catch (e) {
    return { bytes: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function recurseDirectorySize(dirPath: string): Promise<number> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let total = 0;
  for (const e of entries) {
    const p = path.join(dirPath, e.name);
    try {
      if (e.isDirectory()) total += await recurseDirectorySize(p);
      else total += (await fs.stat(p)).size;
    } catch {
      /* skip */
    }
  }
  return total;
}

// ── Progress push to renderer ─────────────────────────────────────────────────

const lastPushTime = new Map<string, number>();
const PUSH_INTERVAL_MS = 250;

function pushProgress(session: InstallSession, force = false): void {
  const now = Date.now();
  const last = lastPushTime.get(session.gameId) ?? 0;
  if (!force && now - last < PUSH_INTERVAL_MS) return;
  lastPushTime.set(session.gameId, now);

  const event: InstallProgressEvent = {
    gameId: session.gameId,
    state: session.state,
    totalBytes: session.totalBytes,
    downloadedBytes: session.downloadedBytes,
    progress: session.totalBytes > 0 ? session.downloadedBytes / session.totalBytes : 0,
    currentFile: session.files.find((f) => f.status === "downloading")?.relativePath ?? null,
    error: session.error,
  };

  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send("install:progress", event);
    }
  });
}

function pushGameExit(gameId: string): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send("game:exit", { gameId });
    }
  });
}

// ── Resume on startup ─────────────────────────────────────────────────────────

/**
 * Called from main/index.ts after app.ready.
 * Any session that was "downloading" when the app last closed gets paused
 * (the user can manually resume from the library). We don't auto-resume
 * to avoid unexpected background bandwidth on startup.
 */
export async function pauseStaleDownloadingSessions(): Promise<void> {
  try {
    const sessions = await listSessions();
    for (const s of sessions) {
      if (s.state === "downloading") {
        s.state = "paused";
        s.files.forEach((f) => { if (f.status === "downloading") f.status = "pending"; });
        await writeSession(s);
      }
    }
  } catch {
    // non-fatal
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

// ── Launch flag safety ────────────────────────────────────────────────────────

/**
 * `customFlags` is appended raw to a shell command in `formatLaunchCommandPreview`.
 * Reject any string containing shell metacharacters that could break out of the
 * intended argv position (command chaining, redirection, subshells, quoting
 * shenanigans, backticks, newlines, etc.). Users who need special characters
 * must escape them via environment variables or a wrapper script.
 */
export function isSafeCustomFlagString(raw: string): boolean {
  if (typeof raw !== "string") return false;
  if (raw.length > 512) return false;
  // Any of these can change the meaning of the assembled shell command.
  // Note: we deliberately allow `=` (env-like flags), `-`, `_`, `.`, `/`, `:`,
  // `@`, `+`, `,` and whitespace so common flag syntaxes still work.
  const disallowed = /[;&|`$><\r\n\\"'()\[\]{}!*?~#]/;
  if (disallowed.test(raw)) return false;
  return true;
}

// ── Download integrity ────────────────────────────────────────────────────────

type ExpectedHash = { algorithm: string; value: string };

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

/** Parse an optional manifest hash into a normalized {algorithm, value}. */
function getExpectedHash(file: FileDownloadEntry): ExpectedHash | null {
  const raw = typeof file.hash === "string" ? file.hash.trim() : null;
  if (!raw) return null;
  const match = raw.match(/^(sha256|sha512|sha1|md5):([a-fA-F0-9]+)$/i);
  if (match) {
    return { algorithm: match[1].toLowerCase(), value: match[2].toLowerCase() };
  }
  // Bare 64-char hex → assume sha256.
  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    return { algorithm: "sha256", value: raw.toLowerCase() };
  }
  return null;
}

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
