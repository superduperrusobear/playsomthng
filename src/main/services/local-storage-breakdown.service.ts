import fs from "node:fs/promises";
import path from "node:path";
import type { LocalStorageBreakdown, LocalStorageEntry } from "../../shared/schemas/local-storage-breakdown.schema";
import { getAppPaths } from "./app-paths.service";
import { getDirectorySizeBytes } from "./install.service";
import { LOCAL_LIBRARY_FILENAME } from "./local-library-file.service";
import { LOCAL_DOWNLOADS_FILENAME } from "./local-downloads-file.service";
import { STORED_SESSION_FILENAME } from "./stored-session.service";

function sessionsDir(): string {
  return path.join(getAppPaths().dataDir, "install-sessions");
}

async function statFile(abs: string): Promise<{ bytes: number; exists: boolean }> {
  try {
    const st = await fs.stat(abs);
    if (st.isDirectory()) {
      const r = await getDirectorySizeBytes(abs);
      return { bytes: r.bytes, exists: true };
    }
    return { bytes: st.size, exists: true };
  } catch {
    return { bytes: 0, exists: false };
  }
}

/**
 * Human-readable inventory of on-disk app data (cache, data, settings).
 * Used by Settings → Storage so users can see paths and sizes.
 */
export async function getLocalStorageBreakdown(): Promise<LocalStorageBreakdown> {
  const paths = getAppPaths();
  const { userDataDir, cacheDir, dataDir, configDir } = paths;
  const settingsPath = path.join(userDataDir, "settings.json");

  const seen = new Set<string>();
  const entries: LocalStorageEntry[] = [];

  async function add(
    bucket: LocalStorageEntry["bucket"],
    role: string,
    relativePath: string,
    absolutePath: string,
  ): Promise<void> {
    if (seen.has(absolutePath)) return;
    seen.add(absolutePath);
    const { bytes, exists } = await statFile(absolutePath);
    entries.push({ bucket, role, relativePath, absolutePath, bytes, exists });
  }

  // —— Known files (purpose-labelled) ——
  await add("cache", "Catalog snapshot (GET /api/games + revision)", "cache/library-cache.json", path.join(cacheDir, "library-cache.json"));
  await add("data", "Your library (installs, pins)", `data/${LOCAL_LIBRARY_FILENAME}`, path.join(dataDir, LOCAL_LIBRARY_FILENAME));
  await add("data", "Download jobs", `data/${LOCAL_DOWNLOADS_FILENAME}`, path.join(dataDir, LOCAL_DOWNLOADS_FILENAME));
  await add("data", "Local install profile", "data/local-user.json", path.join(dataDir, "local-user.json"));
  await add("data", "Saved session", `data/${STORED_SESSION_FILENAME}`, path.join(dataDir, STORED_SESSION_FILENAME));
  await add("data", "Install drive preference", "data/install-pref.json", path.join(dataDir, "install-pref.json"));
  await add("data", "Install session files (per game)", "data/install-sessions/", sessionsDir());
  await add("userData", "App settings", "settings.json", settingsPath);

  // —— Extra files in cache/ (future-proof) ——
  try {
    const names = await fs.readdir(cacheDir);
    for (const name of names) {
      const abs = path.join(cacheDir, name);
      if (seen.has(abs)) continue;
      await add("cache", `Other (cache/${name})`, `cache/${name}`, abs);
    }
  } catch {
    /* cache dir missing */
  }

  // —— Extra top-level files in data/ ——
  try {
    const names = await fs.readdir(dataDir, { withFileTypes: true });
    for (const d of names) {
      const abs = path.join(dataDir, d.name);
      if (seen.has(abs)) continue;
      const rel = `data/${d.name}${d.isDirectory() ? "/" : ""}`;
      const label = d.isDirectory() ? `Other folder (${d.name}/)` : `Other file (${d.name})`;
      await add("data", label, rel, abs);
    }
  } catch {
    /* data dir missing */
  }

  // —— Config dir (if used) ——
  try {
    const names = await fs.readdir(configDir);
    for (const name of names) {
      const abs = path.join(configDir, name);
      if (seen.has(abs)) continue;
      await add("config", `config/${name}`, `config/${name}`, abs);
    }
  } catch {
    /* optional */
  }

  const totalBytes = entries.filter((e) => e.exists).reduce((s, e) => s + e.bytes, 0);

  entries.sort((a, b) => {
    const o = { cache: 0, data: 1, config: 2, userData: 3 };
    const bo = o[a.bucket] - o[b.bucket];
    if (bo !== 0) return bo;
    return a.role.localeCompare(b.role);
  });

  return {
    scannedAtIso: new Date().toISOString(),
    userDataRoot: userDataDir,
    entries,
    totalBytes,
  };
}
