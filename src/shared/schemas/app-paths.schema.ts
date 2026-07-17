import { z } from "zod";

/** App id string — useful for Rust / logs; Electron `userData` already includes the app name from package.json. */
export const APP_STORAGE_SLUG = "somthng" as const;

/**
 * Coarse OS bucket — mirrors `process.platform` groupings Rust will use.
 * `other` = anything we do not special-case yet; paths still resolve best-effort.
 */
export const PlatformFamilySchema = z.enum(["windows", "darwin", "linux", "other"]);
export type PlatformFamily = z.infer<typeof PlatformFamilySchema>;

/** Which logical bucket a path belongs to. */
export const AppStorageBucketSchema = z.enum(["config", "data", "cache", "logs"]);
export type AppStorageBucket = z.infer<typeof AppStorageBucketSchema>;

/**
 * Resolved absolute directories. All roots come from Electron `app.getPath()` so the OS
 * picks the right place per platform (userData / cache / logs are canonical).
 *
 * Layout:
 * - `userDataDir` — `app.getPath("userData")` (anchor)
 * - `configDir` — `join(userData, "config")`
 * - `dataDir` — `join(userData, "data")` (e.g. `local-user.json`)
 * - `cacheDir` — `join(userData, "cache")` (stays under Electron’s userData tree)
 * - `logsDir` — `app.getPath("logs")`
 */
export const AppPathsSchema = z.object({
  platformFamily: PlatformFamilySchema,
  platform: z.string(),
  userDataDir: z.string().min(1),
  configDir: z.string().min(1),
  dataDir: z.string().min(1),
  cacheDir: z.string().min(1),
  logsDir: z.string().min(1),
});

export type AppPaths = z.infer<typeof AppPathsSchema>;
