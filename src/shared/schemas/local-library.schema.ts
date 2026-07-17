import { z } from "zod";
import { LaunchFlagsSchema } from "./launch-compat.schema";

/** Where this library entry came from — self-added vs catalog server. */
export const LibraryEntrySourceSchema = z.enum(["own", "server"]);
export type LibraryEntrySource = z.infer<typeof LibraryEntrySourceSchema>;

export const DownloadStateSchema = z.enum([
  "not_installed",
  "queued",
  "downloading",
  "paused",
  "completed",
  "error",
  "verifying",
]);
export type DownloadState = z.infer<typeof DownloadStateSchema>;

/**
 * One row in the **local** user library (install/download state), not the store catalog.
 * `gameId` is your catalog id (slug or uuid string from the server).
 */
export const LocalLibraryGameEntrySchema = z.object({
  gameId: z.string().min(1),
  installed: z.boolean(),
  installPath: z.string().nullable(),
  installedVersion: z.string().nullable(),
  downloadState: DownloadStateSchema,
  /** Per-user override for launch executable (relative to install path). */
  launchOverride: z.string().nullable().optional(),
  /** Unix timestamp (seconds), or null if never played. */
  lastPlayedAt: z.number().int().nullable(),
  pinned: z.boolean(),
  source: LibraryEntrySourceSchema,
  /** Custom / user-added metadata (optional for server-backed entries). */
  customTitle: z.string().optional(),
  customPlatform: z.string().optional(),
  customCoverImage: z.string().optional(),
  /** From IGDB when the user picks a search result — not user-edited. */
  customScreenshotUrls: z.array(z.string()).optional(),
  /** IGDB summary when enriching from search. */
  customDescription: z.string().optional(),
  customDeveloper: z.string().optional(),
  customPublisher: z.string().optional(),
  /** ISO `YYYY-MM-DD` from IGDB first release. */
  customReleaseDate: z.string().optional(),
  customLaunchPath: z.string().optional(),
  customAddedAt: z.number().int().optional(),
  /** Linux launch wrappers / env / extra args (gamemoderun, gamescope, etc.). */
  launchFlags: LaunchFlagsSchema.nullable().optional(),
  /** Steam store app id for ProtonDB / compatibility (digits as string). */
  steamAppId: z.string().nullable().optional(),
  /**
   * Folder name under Steam compatibility tools (e.g. `Proton-9.0-4`).
   * `null` or omitted = system default (no PROTON_VERSION override).
   */
  protonVersion: z.string().nullable().optional(),
});

export type LocalLibraryGameEntry = z.infer<typeof LocalLibraryGameEntrySchema>;

/** On-disk `user-library.json` — the user’s library state only. */
export const LocalLibraryFileSchema = z.object({
  version: z.number().int().positive().default(1),
  games: z.array(LocalLibraryGameEntrySchema).default([]),
});

export type LocalLibraryFile = z.infer<typeof LocalLibraryFileSchema>;
