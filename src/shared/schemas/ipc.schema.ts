import { z } from "zod";
import { GameSchema, GameWriteSchema, GameUpdateSchema } from "./game.schema";
import { LibraryFiltersSchema, LibraryResponseSchema } from "./library.schema";
import { AppSettingsSchema } from "./settings.schema";
import {
  LoginPayloadSchema,
  AuthResponseSchema,
  UserSchema,
  UserPublicSchema,
  PlaytimeEntrySchema,
  AccountSecuritySchema,
} from "./user.schema";
import { ServerStatusSchema } from "./server.schema";
import { LocalSessionContextSchema } from "./local-user.schema";
import { StoredUserSessionSchema } from "./stored-session.schema";
import { LocalLibraryFileSchema } from "./local-library.schema";
import { LocalDownloadsFileSchema } from "./local-downloads.schema";
import { ManifestJsonSchema } from "./manifest.schema";
import { CatalogMetaSchema } from "./catalog-meta.schema";
import { IgdbSearchResponseSchema, IgdbMetaSchema } from "./igdb.schema";
import {
  InstallOptionsSchema,
  InstallSessionSchema,
  DriveInfoSchema,
  DiskSpaceResultSchema,
} from "./install.schema";
import { LocalStorageBreakdownSchema } from "./local-storage-breakdown.schema";

// ─── Channel registry ─────────────────────────────────────────────────────────
// Every IPC channel name lives here — both ends import this same object.

export const IpcChannel = {
  // Auth
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",
  AUTH_ME: "auth:me",
  /** Restore main-process session after loading the stored session file (offline bootstrap). */
  AUTH_RESTORE: "auth:restore",
  /** Persisted session file (username, role, unix token times). */
  AUTH_SESSION_GET: "auth:session:get",
  AUTH_SESSION_SET: "auth:session:set",
  AUTH_SECURITY_GET: "auth:security:get",
  AUTH_DEVICE_REVOKE: "auth:device:revoke",
  AUTH_SESSION_REVOKE: "auth:session:revoke",

  /** Local user library on disk (installs, pins, source own|server). */
  LOCAL_LIBRARY_GET: "local:library:get",
  LOCAL_LIBRARY_SET: "local:library:set",

  /** Resumable download jobs (`downloads.json`). */
  LOCAL_DOWNLOADS_GET: "local:downloads:get",
  LOCAL_DOWNLOADS_SET: "local:downloads:set",

  // Library (user-facing, read-only)
  LIBRARY_FETCH: "library:fetch",
  LIBRARY_SYNC: "library:sync",
  LIBRARY_SYNC_PROGRESS: "library:sync:progress",
  /** Server pushed a new catalog revision (SSE); renderer invalidates library/game queries. */
  LIBRARY_CATALOG_REVISION: "library:catalog:revision",

  // Game (user-facing, read-only)
  GAME_GET: "game:get",

  // Playtime (user-facing)
  PLAYTIME_GET: "playtime:get",           // get all playtime for current user
  PLAYTIME_START: "playtime:start",       // called when user opens a game
  PLAYTIME_STOP: "playtime:stop",         // called when game closes

  // Admin — game management (admin role required)
  ADMIN_GAME_CREATE: "admin:game:create",
  ADMIN_GAME_UPDATE: "admin:game:update",
  ADMIN_GAME_DELETE: "admin:game:delete",

  // Admin — user management
  ADMIN_USERS_LIST: "admin:users:list",
  ADMIN_USER_UPDATE_ROLE: "admin:user:update-role",

  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",

  /** Resolved config/data/cache/logs dirs + local install identity (no remote auth). */
  SESSION_CONTEXT_GET: "session:context:get",

  /** Sizes + paths for local cache/data files (Settings → Storage). */
  LOCAL_STORAGE_BREAKDOWN_GET: "local:storage-breakdown:get",

  /** Ping first enabled library source; no auth required (login screen). */
  SERVER_STATUS_GET: "server:status:get",
  /** Ping an arbitrary URL without saving it — connect gate verifies before committing. */
  SERVER_STATUS_PROBE: "server:status:probe",

  /** GET manifest JSON from the Rust server (or any URL) — main process fetch. */
  MANIFEST_FETCH: "manifest:fetch",


  /** Authenticated passthrough to /api/admin/* (users, audit, keys). Admin token attached in main. */
  ADMIN_API: "admin:api",

  /** Catalog metadata editor — admin CRUD via Rust server */
  CATALOG_META_GET: "catalog:meta:get",
  CATALOG_META_SET: "catalog:meta:set",

  /** IGDB search/fetch (proxied through Rust server) */
  IGDB_SEARCH: "igdb:search",
  IGDB_FETCH_GAME: "igdb:fetch-game",

  // App window controls
  APP_VERSION: "app:version",
  APP_MINIMIZE: "app:minimize",
  APP_MAXIMIZE: "app:maximize",
  APP_CLOSE: "app:close",
  APP_OPEN_LOGS: "app:open-logs",
  /** Native OS dialog: pick a game executable (Windows / Linux / macOS). */
  DIALOG_PICK_EXECUTABLE: "dialog:pick-executable",

  // System snapshot (collected once at startup; refresh on demand)
  SYSINFO_GET: "sysinfo:get",
  SYSINFO_REFRESH: "sysinfo:refresh",
  SYSINFO_DISK_CHECK: "sysinfo:disk-check",

  // Download / install pipeline
  DRIVES_LIST: "drives:list",
  DISK_SPACE_FOR_GAME: "disk:space-for-game",
  INSTALL_START: "install:start",
  INSTALL_PAUSE: "install:pause",
  INSTALL_RESUME: "install:resume",
  INSTALL_CANCEL: "install:cancel",
  INSTALL_GET: "install:get",
  INSTALL_LIST: "install:list",
  INSTALL_CLEAR_COMPLETED: "install:clear-completed",
  INSTALL_VERIFY: "install:verify",
  INSTALL_OPEN_FOLDER: "install:open-folder",
  /** List relative paths to launchable files under an install root (for user launch-target picker). */
  INSTALL_LAUNCH_CANDIDATES_LIST: "install:launch-candidates:list",
  LAUNCH_OVERRIDE_SET: "launch:override:set",
  INSTALL_PROGRESS: "install:progress",

  // Game launch / stop / uninstall
  GAME_LAUNCH: "game:launch",
  GAME_LAUNCH_STATUS: "game:launch-status",
  GAME_STOP: "game:stop",
  GAME_UNINSTALL: "game:uninstall",

  // Preferred install location (persisted preference)
  INSTALL_PREF_GET: "install:pref:get",
  INSTALL_PREF_SET: "install:pref:set",

  /** Recursive size of a file or directory on disk (Settings → Storage). */
  FS_DIR_SIZE_BYTES: "fs:dir-size-bytes",

  /** Steam Proton tool folder names (Linux). */
  COMPAT_PROTON_LIST: "compat:proton:list",
  /** ProtonDB tier for a Steam app id (main-process fetch). */
  COMPAT_PROTONDB_GET: "compat:protondb:get",
  /** Run a whitelisted winetricks verb; streams `compat:winetricks:log` / `compat:winetricks:done`. */
  COMPAT_WINETRICKS_RUN: "compat:winetricks:run",

  /** Renderer → main: write a message to the log file (used by ErrorBoundary). */
  APP_LOG_ERROR: "app:log-error",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

// ─── Request schemas ──────────────────────────────────────────────────────────

export const IpcRequestSchema = {
  [IpcChannel.AUTH_LOGIN]: LoginPayloadSchema,
  [IpcChannel.AUTH_LOGOUT]: z.undefined(),
  [IpcChannel.AUTH_ME]: z.undefined(),
  [IpcChannel.AUTH_RESTORE]: z.object({
    user: UserPublicSchema,
    token: z.string().min(1),
  }),
  [IpcChannel.AUTH_SESSION_GET]: z.undefined(),
  [IpcChannel.AUTH_SESSION_SET]: z.union([StoredUserSessionSchema, z.null()]),
  [IpcChannel.AUTH_SECURITY_GET]: z.undefined(),
  [IpcChannel.AUTH_DEVICE_REVOKE]: z.object({ hwHash: z.string().min(1) }),
  [IpcChannel.AUTH_SESSION_REVOKE]: z.object({ sessionId: z.string().min(1) }),

  [IpcChannel.LOCAL_LIBRARY_GET]: z.undefined(),
  [IpcChannel.LOCAL_LIBRARY_SET]: LocalLibraryFileSchema,

  [IpcChannel.LOCAL_DOWNLOADS_GET]: z.undefined(),
  [IpcChannel.LOCAL_DOWNLOADS_SET]: LocalDownloadsFileSchema,

  [IpcChannel.LIBRARY_FETCH]: LibraryFiltersSchema,

  [IpcChannel.GAME_GET]: z.object({ id: z.string() }),

  [IpcChannel.PLAYTIME_GET]: z.undefined(),
  [IpcChannel.PLAYTIME_START]: z.object({ gameId: z.string().uuid() }),
  [IpcChannel.PLAYTIME_STOP]: z.object({ gameId: z.string().uuid() }),

  [IpcChannel.ADMIN_GAME_CREATE]: GameWriteSchema,
  [IpcChannel.ADMIN_GAME_UPDATE]: z.object({ id: z.string().uuid(), data: GameUpdateSchema }),
  [IpcChannel.ADMIN_GAME_DELETE]: z.object({ id: z.string().uuid() }),

  [IpcChannel.ADMIN_USERS_LIST]: z.undefined(),
  [IpcChannel.ADMIN_USER_UPDATE_ROLE]: z.object({
    userId: z.string().uuid(),
    role: z.enum(["admin", "user"]),
  }),

  [IpcChannel.SETTINGS_GET]: z.undefined(),
  [IpcChannel.SETTINGS_SET]: AppSettingsSchema.partial(),

  [IpcChannel.SESSION_CONTEXT_GET]: z.undefined(),

  [IpcChannel.LOCAL_STORAGE_BREAKDOWN_GET]: z.undefined(),

  [IpcChannel.SERVER_STATUS_GET]: z.undefined(),
  [IpcChannel.SERVER_STATUS_PROBE]: z.object({ baseUrl: z.string().min(1) }),

  [IpcChannel.MANIFEST_FETCH]: z.object({ url: z.string().url() }),


  [IpcChannel.ADMIN_API]: z.object({
    method: z.enum(["GET", "POST", "DELETE"]),
    path: z.string().startsWith("/api/admin/"),
    body: z.unknown().optional(),
  }),

  [IpcChannel.CATALOG_META_GET]: z.object({ id: z.string() }),
  [IpcChannel.CATALOG_META_SET]: CatalogMetaSchema,

  [IpcChannel.IGDB_SEARCH]: z.object({ q: z.string(), limit: z.number().optional() }),
  [IpcChannel.IGDB_FETCH_GAME]: z.object({ igdbId: z.number() }),

  [IpcChannel.SYSINFO_GET]: z.undefined(),
  [IpcChannel.SYSINFO_REFRESH]: z.undefined(),
  [IpcChannel.SYSINFO_DISK_CHECK]: z.object({
    requiredBytes: z.number().nonnegative(),
    preferredMount: z.string().nullable().optional(),
  }),

  [IpcChannel.DRIVES_LIST]: z.undefined(),
  [IpcChannel.DISK_SPACE_FOR_GAME]: z.object({
    mount: z.string(),
    requiredBytes: z.number().nonnegative(),
  }),
  [IpcChannel.INSTALL_START]: InstallOptionsSchema,
  [IpcChannel.INSTALL_PAUSE]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_RESUME]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_CANCEL]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_GET]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_LIST]: z.undefined(),
  [IpcChannel.INSTALL_CLEAR_COMPLETED]: z.undefined(),
  [IpcChannel.INSTALL_VERIFY]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_OPEN_FOLDER]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_LAUNCH_CANDIDATES_LIST]: z.object({ installPath: z.string().min(1) }),
  [IpcChannel.LAUNCH_OVERRIDE_SET]: z.object({ gameId: z.string(), launchTarget: z.string().nullable() }),
  [IpcChannel.GAME_LAUNCH]: z.union([
    z.object({ gameId: z.string(), installPath: z.string(), launchTarget: z.string() }),
    z.object({ gameId: z.string(), absoluteExePath: z.string().min(1) }),
  ]),
  [IpcChannel.GAME_STOP]: z.object({ gameId: z.string() }),
  [IpcChannel.GAME_UNINSTALL]: z.object({ gameId: z.string() }),
  [IpcChannel.INSTALL_PREF_GET]: z.undefined(),
  [IpcChannel.INSTALL_PREF_SET]: z.object({ mount: z.string() }),
  [IpcChannel.DIALOG_PICK_EXECUTABLE]: z.undefined(),
  [IpcChannel.FS_DIR_SIZE_BYTES]: z.object({ path: z.string().min(1) }),

  [IpcChannel.COMPAT_PROTON_LIST]: z.undefined(),
  [IpcChannel.COMPAT_PROTONDB_GET]: z.object({ appId: z.string().min(1) }),
  [IpcChannel.COMPAT_WINETRICKS_RUN]: z.object({ verb: z.string().min(1) }),

  [IpcChannel.APP_LOG_ERROR]: z.object({ message: z.string() }),
};

// ─── Response schemas ─────────────────────────────────────────────────────────

export const IpcResponseSchema = {
  [IpcChannel.AUTH_LOGIN]: AuthResponseSchema,
  [IpcChannel.AUTH_RESTORE]: z.object({ ok: z.literal(true) }),
  [IpcChannel.AUTH_ME]: UserSchema,
  [IpcChannel.AUTH_SESSION_GET]: z.union([StoredUserSessionSchema, z.null()]),
  [IpcChannel.AUTH_SESSION_SET]: z.union([StoredUserSessionSchema, z.null()]),
  [IpcChannel.AUTH_SECURITY_GET]: AccountSecuritySchema,
  [IpcChannel.AUTH_DEVICE_REVOKE]: z.object({
    ok: z.literal(true),
    sessionsRevoked: z.number().int().nonnegative(),
  }),
  [IpcChannel.AUTH_SESSION_REVOKE]: z.object({ ok: z.literal(true) }),
  [IpcChannel.LOCAL_LIBRARY_GET]: LocalLibraryFileSchema,
  [IpcChannel.LOCAL_LIBRARY_SET]: LocalLibraryFileSchema,
  [IpcChannel.LOCAL_DOWNLOADS_GET]: LocalDownloadsFileSchema,
  [IpcChannel.LOCAL_DOWNLOADS_SET]: LocalDownloadsFileSchema,
  [IpcChannel.LIBRARY_FETCH]: LibraryResponseSchema,
  [IpcChannel.GAME_GET]: GameSchema,
  [IpcChannel.PLAYTIME_GET]: z.array(PlaytimeEntrySchema),
  [IpcChannel.SETTINGS_GET]: AppSettingsSchema,
  [IpcChannel.SESSION_CONTEXT_GET]: LocalSessionContextSchema,

  [IpcChannel.LOCAL_STORAGE_BREAKDOWN_GET]: LocalStorageBreakdownSchema,
  [IpcChannel.SERVER_STATUS_GET]: ServerStatusSchema,
  [IpcChannel.SERVER_STATUS_PROBE]: ServerStatusSchema,
  [IpcChannel.MANIFEST_FETCH]: ManifestJsonSchema,
  [IpcChannel.ADMIN_API]: z.unknown(),
  [IpcChannel.CATALOG_META_GET]: CatalogMetaSchema,
  [IpcChannel.CATALOG_META_SET]: CatalogMetaSchema,
  [IpcChannel.IGDB_SEARCH]: IgdbSearchResponseSchema,
  [IpcChannel.IGDB_FETCH_GAME]: IgdbMetaSchema,
  [IpcChannel.DRIVES_LIST]: z.array(DriveInfoSchema),
  [IpcChannel.DISK_SPACE_FOR_GAME]: DiskSpaceResultSchema,
  [IpcChannel.INSTALL_START]: InstallSessionSchema,
  [IpcChannel.INSTALL_PAUSE]: InstallSessionSchema,
  [IpcChannel.INSTALL_RESUME]: InstallSessionSchema,
  [IpcChannel.INSTALL_CANCEL]: z.object({ ok: z.boolean() }),
  [IpcChannel.INSTALL_GET]: InstallSessionSchema.nullable(),
  [IpcChannel.INSTALL_LIST]: z.array(InstallSessionSchema),
  [IpcChannel.INSTALL_CLEAR_COMPLETED]: z.object({
    removed: z.number(),
    sessions: z.array(InstallSessionSchema),
  }),
  [IpcChannel.INSTALL_VERIFY]: z.object({
    ok: z.boolean(),
    missing: z.number(),
    mismatched: z.number(),
    error: z.string().optional(),
  }),
  [IpcChannel.INSTALL_OPEN_FOLDER]: z.object({ ok: z.boolean(), error: z.string().optional() }),
  [IpcChannel.INSTALL_LAUNCH_CANDIDATES_LIST]: z.object({
    relativePaths: z.array(z.string()),
    error: z.string().optional(),
  }),
  [IpcChannel.LAUNCH_OVERRIDE_SET]: z.object({ ok: z.boolean(), error: z.string().optional() }),
  [IpcChannel.GAME_LAUNCH]: z.object({ ok: z.boolean(), pid: z.number().optional(), error: z.string().optional() }),
  [IpcChannel.GAME_STOP]: z.object({ ok: z.boolean(), error: z.string().optional() }),
  [IpcChannel.GAME_UNINSTALL]: z.object({ ok: z.boolean(), error: z.string().optional() }),
  [IpcChannel.INSTALL_PREF_GET]: z.object({ mount: z.string().nullable() }),
  [IpcChannel.INSTALL_PREF_SET]: z.object({ mount: z.string() }),
  [IpcChannel.DIALOG_PICK_EXECUTABLE]: z.object({ path: z.string().nullable() }),
  [IpcChannel.FS_DIR_SIZE_BYTES]: z.object({
    bytes: z.number().nonnegative(),
    error: z.string().optional(),
  }),

  [IpcChannel.COMPAT_PROTON_LIST]: z.object({
    versions: z.array(z.string()),
  }),
  [IpcChannel.COMPAT_PROTONDB_GET]: z.object({
    tier: z.string().nullable(),
    raw: z.string().optional(),
  }),
  [IpcChannel.COMPAT_WINETRICKS_RUN]: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),

  [IpcChannel.APP_LOG_ERROR]: z.object({ ok: z.literal(true) }),
};

// ─── Push event payloads (on() listeners, not invoke) ─────────────────────────

export const SyncProgressSchema = z.object({
  sourceId: z.string(),
  status: z.enum(["connecting", "fetching", "done", "error"]),
  gamesFound: z.number().optional(),
  error: z.string().optional(),
});

export type SyncProgress = z.infer<typeof SyncProgressSchema>;
