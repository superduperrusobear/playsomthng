import { z } from "zod";
import { AppPathsSchema } from "./app-paths.schema";

/**
 * On-disk identity before any remote auth exists.
 * Lives under `AppPaths.dataDir` (e.g. `local-user.json`) — Rust can own the same file shape later.
 */
export const LocalUserIdentitySchema = z.object({
  /** Stable id for this install / machine profile (UUID v4). */
  localId: z.string().uuid(),
  /** Optional friendly label (not a login name). */
  displayName: z.string().max(64).optional(),
  /** ISO time when the local profile was first created. */
  createdAt: z.string().datetime(),
  /** ISO time of last local update. */
  updatedAt: z.string().datetime(),
});

export type LocalUserIdentity = z.infer<typeof LocalUserIdentitySchema>;

/**
 * Light bundle for UI + services: resolved paths + local install identity.
 * No tokens — remote auth is a later layer.
 */
export const LocalSessionContextSchema = z.object({
  paths: AppPathsSchema,
  localUser: LocalUserIdentitySchema,
});

export type LocalSessionContext = z.infer<typeof LocalSessionContextSchema>;
