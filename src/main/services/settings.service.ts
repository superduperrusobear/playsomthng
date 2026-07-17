import { app } from "electron";
import path from "path";
import fs from "fs";
import {
  AppSettings,
  AppSettingsSchema,
  SETTINGS_VERSION,
  type LibrarySource,
} from "../../shared/schemas";
import { logger } from "../utils/logger";

/** Stable id so the default dev source does not multiply on each launch. */
const DEFAULT_DEV_SOURCE_ID = "a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6";

function normalizeBaseUrl(base: string): string {
  const b = base.trim();
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

/**
 * First library source, or `null` if none should be seeded.
 *
 * - `PLAYSOMTHNG_API_BASE` env wins in any build.
 * - **Packaged / distributable builds seed nothing** — no server is baked in.
 *   The user enters their own server URL on the connect screen (Nextcloud / Immich style),
 *   which keeps the open-source build free of any hardcoded host.
 * - Dev builds default to the local server for convenience.
 */
function defaultLibrarySource(): LibrarySource | null {
  const env = process.env.PLAYSOMTHNG_API_BASE?.trim() || process.env.PLAYSMTHNG_API_BASE?.trim();
  if (env) {
    return {
      id: DEFAULT_DEV_SOURCE_ID,
      name: app.isPackaged ? "Server" : "Local (playsomthng-server)",
      baseUrl: normalizeBaseUrl(env),
      enabled: true,
    };
  }
  if (app.isPackaged) {
    return null;
  }
  return {
    id: DEFAULT_DEV_SOURCE_ID,
    name: "Local (playsomthng-server)",
    baseUrl: "http://127.0.0.1:3000",
    enabled: true,
  };
}

/** In dev, prefer explicit API base without requiring manual settings reset. */
function applyDevEnvSourceOverride(currentSources: LibrarySource[]): LibrarySource[] {
  if (app.isPackaged) return currentSources;
  const env = process.env.PLAYSOMTHNG_API_BASE?.trim() || process.env.PLAYSMTHNG_API_BASE?.trim();
  if (!env) return currentSources;

  const normalized = normalizeBaseUrl(env);
  const idx = currentSources.findIndex((s) => s.id === DEFAULT_DEV_SOURCE_ID);
  if (idx >= 0) {
    const next = [...currentSources];
    next[idx] = {
      ...next[idx],
      baseUrl: normalized,
      enabled: true,
      name: "Somthng (Dev Remote)",
    };
    return next;
  }

  return [
    {
      id: DEFAULT_DEV_SOURCE_ID,
      name: "Somthng (Dev Remote)",
      baseUrl: normalized,
      enabled: true,
    },
    ...currentSources,
  ];
}

/**
 * Pre-v2 settings had no `mode`; an existing source means they were already on a
 * server. Runs once so a later `unset` (user reopening the gate) is respected.
 */
function migrateMode(loaded: AppSettings): AppSettings["mode"] {
  if (loaded.version >= SETTINGS_VERSION) return loaded.mode;
  return loaded.sources.some((s) => s.enabled) ? "remote" : loaded.mode;
}

/** Module-level cache shared across all SettingsService instances. */
let _moduleCache: AppSettings | null = null;

export class SettingsService {
  private readonly filePath: string;

  constructor() {
    const userDataDir = app?.getPath("userData") ?? ".";
    this.filePath = path.join(userDataDir, "settings.json");
  }

  getSettings(): AppSettings {
    if (_moduleCache) return _moduleCache;

    logger.info(`[BOOT] App packaged: IS_PACKAGED=${app.isPackaged}`);
    logger.info(`[BOOT] USER_DATA_PATH=${app.getPath("userData")}`);
    logger.info(`[BOOT] SETTINGS_PATH=${this.filePath}`);

    let loaded: AppSettings;
    let fileExists = false;
    try {
      if (fs.existsSync(this.filePath)) {
        fileExists = true;
        const raw = fs.readFileSync(this.filePath, "utf-8");
        loaded = AppSettingsSchema.parse(JSON.parse(raw));
      } else {
        loaded = AppSettingsSchema.parse({});
      }
    } catch (err) {
      logger.warn(`[BOOT] Failed to parse settings.json: ${String(err)}`);
      loaded = AppSettingsSchema.parse({});
    }

    logger.info(`[BOOT] SETTINGS_FILE_EXISTS=${fileExists}`);

    // First run (no sources): seed a default when we have one.
    // Packaged builds seed nothing (user enters their server URL on the connect screen);
    // dev builds default to localhost unless PLAYSOMTHNG_API_BASE is set.
    if (loaded.sources.length === 0) {
      const defSource = defaultLibrarySource();
      if (defSource) {
        logger.info(`[BOOT] No sources found, seeding default source baseUrl=${defSource.baseUrl} (isPackaged: ${app.isPackaged})`);
        // Seeds the address only — mode stays the user's choice at the gate.
        loaded = AppSettingsSchema.parse({
          ...loaded,
          sources: [defSource],
        });
      } else {
        logger.info(`[BOOT] No sources found and no default to seed — awaiting server URL from connect screen`);
      }
    } else {
      loaded = AppSettingsSchema.parse({
        ...loaded,
        sources: applyDevEnvSourceOverride(loaded.sources),
        mode: migrateMode(loaded),
      });
    }
    loaded = AppSettingsSchema.parse({ ...loaded, version: SETTINGS_VERSION });

    const enabledSource = loaded.sources.find((s) => s.enabled);
    logger.info(`[BOOT] RESOLVED_SOURCES=${JSON.stringify(loaded.sources)}`);
    if (enabledSource) {
      logger.info(`[BOOT] Using source baseUrl: ${enabledSource.baseUrl}`);
    } else {
      logger.warn(`[BOOT] No enabled source found!`);
    }

    // Persist normalization/override result so next boot is deterministic.
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(loaded, null, 2), "utf-8");
    } catch (err) {
      logger.error(`[BOOT] Failed to save settings.json: ${String(err)}`);
    }

    _moduleCache = loaded;
    return _moduleCache;
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const merged = AppSettingsSchema.parse({ ...current, ...partial });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2), "utf-8");
    _moduleCache = merged;
    return merged;
  }
}
