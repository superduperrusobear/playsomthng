import { z } from "zod";

// ── Drive / disk info (from sysinfo) ─────────────────────────────────────────

export const DriveInfoSchema = z.object({
  /** Full path / mount point — used as the key when the user picks a drive. */
  mount: z.string(),
  /** E.g. "Local Disk (C:)" or drive label from OS. */
  label: z.string(),
  /** Filesystem type. */
  type: z.string().optional(),
  /** Total bytes. */
  size: z.number().nonnegative(),
  /** Free bytes. */
  available: z.number().nonnegative(),
  /** Used bytes. */
  used: z.number().nonnegative(),
  /** Percentage used (0–100). */
  usePercent: z.number().nonnegative(),
  /** Whether this is the boot / primary drive. */
  isSystem: z.boolean().optional(),
});
export type DriveInfo = z.infer<typeof DriveInfoSchema>;

// ── Disk space check result ───────────────────────────────────────────────────

export const DiskSpaceResultSchema = z.object({
  hasSufficient: z.boolean(),
  availableBytes: z.number().nonnegative(),
  requiredBytes: z.number().nonnegative(),
  mount: z.string(),
});
export type DiskSpaceResult = z.infer<typeof DiskSpaceResultSchema>;

// ── Install options (user choices from the modal) ─────────────────────────────

export const InstallOptionsSchema = z.object({
  gameId: z.string().min(1),
  /** Absolute root directory chosen by user, e.g. "C:\PSGAMES". */
  installRoot: z.string().min(1),
  /** Create a desktop shortcut. */
  desktopShortcut: z.boolean().default(false),
  /** Create a Start Menu / application launcher shortcut. */
  startMenuShortcut: z.boolean().default(false),
  /** Remember chosen drive for future installs. */
  rememberDrive: z.boolean().default(true),
  /**
   * When the library UI already has catalog URLs (same as `/api/games`), pass them here
   * so the main process does not need a second HTTP lookup (avoids base-URL / UUID mismatches).
   */
  manifestUrl: z.string().min(1).optional(),
  downloadBaseUrl: z.string().min(1).optional(),
  gameTitle: z.string().min(1).optional(),
});
export type InstallOptions = z.infer<typeof InstallOptionsSchema>;

// ── Per-file download status ──────────────────────────────────────────────────

export const FileDownloadStatusSchema = z.enum([
  "pending",
  "downloading",
  "done",
  "failed",
]);
export type FileDownloadStatus = z.infer<typeof FileDownloadStatusSchema>;

export const FileDownloadEntrySchema = z.object({
  relativePath: z.string(),
  sizeBytes: z.number().nonnegative(),
  remoteUrl: z.string(),
  localPath: z.string(),
  status: FileDownloadStatusSchema,
  downloadedBytes: z.number().nonnegative(),
  error: z.string().nullable(),
  /** Optional expected content hash from the manifest (e.g. "sha256:<hex>" or bare hex). */
  hash: z.string().optional().nullable(),
});
export type FileDownloadEntry = z.infer<typeof FileDownloadEntrySchema>;

// ── Install session (persisted to disk, survives restarts) ───────────────────

export const InstallSessionStateSchema = z.enum([
  "preflight",
  "downloading",
  "paused",
  "completed",
  "error",
]);
export type InstallSessionState = z.infer<typeof InstallSessionStateSchema>;

export const InstallSessionSchema = z.object({
  gameId: z.string().min(1),
  gameTitle: z.string(),
  /** Where `downloadBaseUrl/{relativePath}` files are fetched from. */
  downloadBaseUrl: z.string(),
  manifestUrl: z.string(),
  /** Absolute root the game is being installed into, e.g. "C:\Games\my-game". */
  installRoot: z.string(),
  totalBytes: z.number().nonnegative(),
  downloadedBytes: z.number().nonnegative(),
  state: InstallSessionStateSchema,
  /** The launch target (relative path inside installRoot). */
  launchTarget: z.string().nullable(),
  files: z.array(FileDownloadEntrySchema),
  /** Unix seconds. */
  createdAt: z.number(),
  updatedAt: z.number(),
  error: z.string().nullable(),
});
export type InstallSession = z.infer<typeof InstallSessionSchema>;

// ── Progress event pushed to renderer ────────────────────────────────────────

export const InstallProgressEventSchema = z.object({
  gameId: z.string(),
  state: InstallSessionStateSchema,
  totalBytes: z.number(),
  downloadedBytes: z.number(),
  /** 0–1 */
  progress: z.number(),
  currentFile: z.string().nullable(),
  error: z.string().nullable(),
});
export type InstallProgressEvent = z.infer<typeof InstallProgressEventSchema>;
