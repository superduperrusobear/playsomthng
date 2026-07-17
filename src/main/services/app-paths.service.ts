import path from "node:path";
import { app } from "electron";
import type { AppPaths, PlatformFamily } from "../../shared/schemas/app-paths.schema";

function platformFamily(): PlatformFamily {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      return "other";
  }
}

/**
 * Canonical dirs via Electron — no manual %APPDATA% / XDG tables.
 * `userData` is the anchor; config/data are subfolders; cache/logs use Electron’s paths.
 */
export function resolveAppPaths(): AppPaths {
  if (!app.isReady()) {
    throw new Error("resolveAppPaths() must run after app.ready (e.g. from IPC handlers)");
  }

  const userData = app.getPath("userData");

  return {
    platformFamily: platformFamily(),
    platform: process.platform,
    userDataDir: userData,
    configDir: path.join(userData, "config"),
    dataDir: path.join(userData, "data"),
    /** Under `userData` — Electron’s typings don’t expose `getPath("cache")` on all versions. */
    cacheDir: path.join(userData, "cache"),
    logsDir: app.getPath("logs"),
  };
}

let cached: AppPaths | null = null;

export function getAppPaths(): AppPaths {
  if (!cached) cached = resolveAppPaths();
  return cached;
}

/** Call after tests or if you need to re-resolve (normally unnecessary). */
export function clearAppPathsCache(): void {
  cached = null;
}
