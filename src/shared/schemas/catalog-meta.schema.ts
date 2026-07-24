import { z } from "zod";

// ── Platform tags (mirrors Rust PlatformTag enum) ──────────────────────────

export const PlatformTagSchema = z.enum([
  "windows",
  "ps1",
  "ps2",
  "ps3",
  "ps4",
  "ps5",
  "xbox",
  "xbox-360",
  "xbox-one",
  "nes",
  "snes",
  "n64",
  "game-cube",
  "wii",
  "wii-u",
  "switch",
  "gba",
  "nds",
  "3ds",
  "psp",
  "ps-vita",
  "arcade",
  "other",
]);
export type PlatformTag = z.infer<typeof PlatformTagSchema>;

export const PLATFORM_LABELS: Record<PlatformTag, string> = {
  windows: "Windows",
  ps1: "PlayStation 1",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  ps4: "PlayStation 4",
  ps5: "PlayStation 5",
  xbox: "Xbox",
  "xbox-360": "Xbox 360",
  "xbox-one": "Xbox One",
  nes: "NES",
  snes: "SNES",
  n64: "Nintendo 64",
  "game-cube": "GameCube",
  wii: "Wii",
  "wii-u": "Wii U",
  switch: "Nintendo Switch",
  gba: "Game Boy Advance",
  nds: "Nintendo DS",
  "3ds": "Nintendo 3DS",
  psp: "PSP",
  "ps-vita": "PS Vita",
  arcade: "Arcade",
  other: "Other",
};

// ── Publish state ──────────────────────────────────────────────────────────

export const PublishStateSchema = z.enum(["draft", "published"]);
export type PublishState = z.infer<typeof PublishStateSchema>;

// ── CatalogMeta (mirrors Rust CatalogMeta struct) ──────────────────────────

export const CatalogMetaSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  packageType: z.string(),
  version: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  developer: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  /** ISO `YYYY-MM-DD` */
  releaseDate: z.string().nullable().optional(),
  platformTags: z.array(PlatformTagSchema),
  emulatorRequired: z.boolean(),
  emulatorOverride: z.boolean(),
  launchTarget: z.string().nullable().optional(),
  /** Extra launch targets for multi-executable games; the user picks one at launch. */
  launchTargets: z.array(z.string()).default([]),
  coverImageUrl: z.string().nullable().optional(),
  screenshotUrls: z.array(z.string()),
  specialInstructions: z.string().nullable().optional(),
  adminNotes: z.string().nullable().optional(),
  publishState: PublishStateSchema,
  igdbId: z.number().nullable().optional(),
  igdbSlug: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CatalogMeta = z.infer<typeof CatalogMetaSchema>;

// Partial version used for form state (fields can be undefined while editing)
export type CatalogMetaDraft = Partial<CatalogMeta> & Pick<CatalogMeta, "id">;
