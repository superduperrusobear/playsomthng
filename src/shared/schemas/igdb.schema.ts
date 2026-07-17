import { z } from "zod";

export const IgdbSearchResultSchema = z.object({
  igdbId: z.number(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  releaseYear: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
  platforms: z.array(z.string()),
  genres: z.array(z.string()),
});
export type IgdbSearchResult = z.infer<typeof IgdbSearchResultSchema>;

export const IgdbMetaSchema = z.object({
  igdbId: z.number(),
  igdbSlug: z.string().nullable().optional(),
  name: z.string(),
  summary: z.string().nullable().optional(),
  coverUrl: z.string().nullable().optional(),
  screenshotUrls: z.array(z.string()),
  artworkUrls: z.array(z.string()),
  genres: z.array(z.string()),
  platforms: z.array(z.string()),
  releaseDateUnix: z.number().nullable().optional(),
  /** First release as `YYYY-MM-DD`. */
  releaseDateIso: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  franchises: z.array(z.string()),
  developers: z
    .array(z.string())
    .optional()
    .nullable()
    .transform((v) => v ?? []),
  publishers: z
    .array(z.string())
    .optional()
    .nullable()
    .transform((v) => v ?? []),
});
export type IgdbMeta = z.infer<typeof IgdbMetaSchema>;

export const IgdbSearchResponseSchema = z.object({
  results: z.array(IgdbSearchResultSchema),
});
