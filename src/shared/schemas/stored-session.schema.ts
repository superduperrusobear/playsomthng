import { z } from "zod";
import { UserRoleSchema } from "./user.schema";

/**
 * Persisted auth snapshot on disk (`user-session.bin` under data dir, OS-encrypted).
 * All times are **Unix time in seconds** (integer), not milliseconds.
 * Used to reopen the app when the library server is offline (local library / installs still work).
 */
export const StoredUserSessionSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().min(1),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
  /** Last session token from the server — offline mode does not re-validate against the API. */
  token: z.string().min(1),
  /** Unix timestamp (seconds) when the access token expires (informational). */
  tokenExpiresAt: z.number().int(),
  /** Unix timestamp (seconds) of last successful authentication. */
  lastAuthenticatedAt: z.number().int(),
});

export type StoredUserSession = z.infer<typeof StoredUserSessionSchema>;
