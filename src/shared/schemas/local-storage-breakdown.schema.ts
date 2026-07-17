import { z } from "zod";

/** Where this file lives under the app’s Electron-managed folders. */
export const LocalStorageBucketSchema = z.enum(["cache", "data", "config", "userData"]);
export type LocalStorageBucket = z.infer<typeof LocalStorageBucketSchema>;

export const LocalStorageEntrySchema = z.object({
  bucket: LocalStorageBucketSchema,
  /** Short label for the UI (e.g. “Catalog API cache”). */
  role: z.string(),
  /** Path relative to the bucket root or userData for display. */
  relativePath: z.string(),
  absolutePath: z.string(),
  bytes: z.number().nonnegative(),
  exists: z.boolean(),
});

export const LocalStorageBreakdownSchema = z.object({
  /** ISO timestamp when sizes were measured. */
  scannedAtIso: z.string(),
  /** Electron `app.getPath("userData")` — parent of cache/data/config. */
  userDataRoot: z.string(),
  entries: z.array(LocalStorageEntrySchema),
  totalBytes: z.number().nonnegative(),
});

export type LocalStorageEntry = z.infer<typeof LocalStorageEntrySchema>;
export type LocalStorageBreakdown = z.infer<typeof LocalStorageBreakdownSchema>;
