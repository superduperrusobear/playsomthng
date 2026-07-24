import { z } from "zod";
import { GameListItemSchema } from "./game.schema";
import { PlatformSchema } from "./game.schema";

/** Credentials may use plain HTTP only on the same machine during development. */
export const SecureServerUrlSchema = z.string().url().refine((raw) => {
  const url = new URL(raw);
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}, "Remote servers must use HTTPS so credentials are encrypted in transit");

export const LibrarySourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  baseUrl: SecureServerUrlSchema,
  enabled: z.boolean().default(true),
  lastSynced: z.string().datetime().optional(),
});

export const LibraryResponseSchema = z.object({
  source: z.string(),
  totalGames: z.number().nonnegative(),
  games: z.array(GameListItemSchema),
  page: z.number().nonnegative().default(1),
  pageSize: z.number().nonnegative().default(50),
  totalPages: z.number().nonnegative().default(1),
});

export const LibraryFiltersSchema = z.object({
  search: z.string().optional(),
  platform: PlatformSchema.optional(),
  tags: z.array(z.string()).optional(),
  emulatorRequired: z.boolean().optional(),
  sortBy: z
    .enum(["title", "dateAddedToLibrary", "releaseDate", "platform"])
    .default("title"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(50),
  admin: z.boolean().optional(),
});

export type LibrarySource = z.infer<typeof LibrarySourceSchema>;
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;
export type LibraryFilters = z.infer<typeof LibraryFiltersSchema>;
