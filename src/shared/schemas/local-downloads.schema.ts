import { z } from "zod";
import { DownloadStateSchema } from "./local-library.schema";

/**
 * High-level phase for an on-disk download job (same vocabulary as library `downloadState`
 * where it makes sense).
 */
export const DownloadJobStateSchema = DownloadStateSchema;
export type DownloadJobState = z.infer<typeof DownloadJobStateSchema>;

/**
 * One active or resumable download job — persisted so the client can resume after restart.
 */
export const DownloadJobEntrySchema = z.object({
  gameId: z.string().min(1),
  state: DownloadJobStateSchema,
  installPath: z.string(),
  manifestVersion: z.string().min(1),
  downloadedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  currentFile: z.string(),
  completedFiles: z.array(z.string()),
  failedFiles: z.array(z.string()),
  lastError: z.string().nullable(),
});

export type DownloadJobEntry = z.infer<typeof DownloadJobEntrySchema>;

/** On-disk `downloads.json` — all in-progress / resumable download jobs. */
export const LocalDownloadsFileSchema = z.object({
  version: z.number().int().positive().default(1),
  jobs: z.array(DownloadJobEntrySchema).default([]),
});

export type LocalDownloadsFile = z.infer<typeof LocalDownloadsFileSchema>;
