import { z } from "zod";

// Remote / authenticated user lives here. Local on-disk identity before login is
// `LocalUserIdentity` in `local-user.schema.ts` (same repo, separate lifecycle).

// ─── Roles ────────────────────────────────────────────────────────────────────

export const UserRoleSchema = z.enum(["admin", "user"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

// ─── Playtime ─────────────────────────────────────────────────────────────────

export const PlaytimeEntrySchema = z.object({
  gameId: z.string().uuid(),
  totalMinutes: z.number().nonnegative().default(0),
  lastPlayedAt: z.string().datetime().optional(),
  sessions: z.number().nonnegative().default(0),
});

export type PlaytimeEntry = z.infer<typeof PlaytimeEntrySchema>;

// ─── User ─────────────────────────────────────────────────────────────────────

export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(2).max(32),
  displayName: z.string().max(64).optional(),
  role: UserRoleSchema.default("user"),
  createdAt: z.string().datetime(),
  playtime: z.array(PlaytimeEntrySchema).default([]),
});

// What the client receives — no credentials
export const UserPublicSchema = UserSchema.omit({ playtime: true });

// Full profile view (own account)
export const UserProfileSchema = UserSchema;

export type User = z.infer<typeof UserSchema>;
export type UserPublic = z.infer<typeof UserPublicSchema>;

export const EnrolledDeviceSchema = z.object({
  /** Salted server-side fingerprint; the raw hardware UUID is never returned. */
  hwHash: z.string().min(1),
  hostname: z.string(),
  enrolledAt: z.string(),
  lastSeenAt: z.string(),
  lastDownloadAt: z.string().nullable(),
  current: z.boolean(),
});

export const AccountSessionSchema = z.object({
  /** SHA-256 session identifier, never the bearer token itself. */
  sessionId: z.string().min(1),
  deviceHash: z.string().nullable(),
  hostname: z.string(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  current: z.boolean(),
});

export const AccountSecuritySchema = z.object({
  devices: z.array(EnrolledDeviceSchema),
  sessions: z.array(AccountSessionSchema),
});

export type EnrolledDevice = z.infer<typeof EnrolledDeviceSchema>;
export type AccountSession = z.infer<typeof AccountSessionSchema>;
export type AccountSecurity = z.infer<typeof AccountSecuritySchema>;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const LoginPayloadSchema = z.object({
  username: z.string().min(1),
  /** Invite code (UI name). Empty when the server already knows this machine. Sent on the wire as `setupKey`. */
  scikde: z.string().default(""),
});

export const AuthResponseSchema = z.object({
  user: UserPublicSchema,
  token: z.string(),
});

export type LoginPayload = z.infer<typeof LoginPayloadSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
