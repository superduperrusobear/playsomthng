import { z } from "zod";

// ─── Platform ────────────────────────────────────────────────────────────────

export const PlatformSchema = z.enum([
  // Native PC
  "pc",
  // PlayStation
  "ps1",
  "ps2",
  "ps3",
  "ps4",
  "ps5",
  // Xbox
  "xbox",
  "xbox360",
  "xboxone",
  // Nintendo home
  "nes",
  "snes",
  "n64",
  "gamecube",
  "wii",
  "wiiu",
  "switch",
  // Nintendo handheld
  "gba",
  "nds",
  "3ds",
  // Sony handheld
  "psp",
  "psvita",
  // Other
  "arcade",
  "other",
]);

export type Platform = z.infer<typeof PlatformSchema>;

// ─── Emulator ─────────────────────────────────────────────────────────────────

export const EmulatorSchema = z.enum([
  "rpcs3",      // PS3
  "pcsx2",      // PS2
  "duckstation", // PS1
  "dolphin",    // GameCube / Wii
  "cemu",       // Wii U
  "yuzu",       // Switch
  "ryujinx",    // Switch
  "xemu",       // Original Xbox
  "xenia",      // Xbox 360
  "ppsspp",     // PSP
  "vita3k",     // PS Vita
  "melonds",    // NDS
  "citra",      // 3DS
  "mame",       // Arcade
  "retroarch",  // Multi-system
  "other",
]);

export type Emulator = z.infer<typeof EmulatorSchema>;

export const EmulatorRequirementSchema = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false) }),
  z.object({
    required: z.literal(true),
    emulator: EmulatorSchema,
    emulatorVersion: z.string().optional(),
    setupNotes: z.string().optional(),
  }),
]);

export type EmulatorRequirement = z.infer<typeof EmulatorRequirementSchema>;

// ─── System Requirements ──────────────────────────────────────────────────────

export const SystemSpecSchema = z.object({
  os: z.string().optional(),
  cpu: z.string().optional(),
  gpu: z.string().optional(),
  ram: z.string().optional(),
  storage: z.string().optional(),
  notes: z.string().optional(),
});

export const SystemRequirementsSchema = z.object({
  minimum: SystemSpecSchema.optional(),
  recommended: SystemSpecSchema.optional(),
});

export type SystemSpec = z.infer<typeof SystemSpecSchema>;
export type SystemRequirements = z.infer<typeof SystemRequirementsSchema>;

// ─── Game ─────────────────────────────────────────────────────────────────────

export const GameSchema = z.object({
  id: z.string().uuid(),

  // Identity
  title: z.string().min(1),
  slug: z.string(),
  description: z.string().optional(),

  // Media — any non-empty string (IGDB, Steam, custom CDNs); UI loads <img>; avoid strict .url() stripping valid links.
  coverImage: z.string().optional(),
  bannerImage: z.string().optional(),
  screenshots: z.array(z.string()).default([]),

  // Credits
  developer: z.string().optional(),
  publisher: z.string().optional(),

  // Dates
  releaseDate: z.string().date().optional(),           // "YYYY-MM-DD"
  dateAddedToLibrary: z.string().datetime().optional(), // ISO timestamp when admin added it

  // Classification
  platform: PlatformSchema,
  tags: z.array(z.string()).default([]),

  // Technical
  systemRequirements: SystemRequirementsSchema.optional(),
  emulator: EmulatorRequirementSchema.default({ required: false }),
  downloadUrl: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  /** Manifest URL for downloads (catalog / server). */
  manifestUrl: z.string().optional(),
  /** CDN base for file downloads (catalog / server). */
  downloadBaseUrl: z.string().optional(),
});

// Lightweight version used in grid/list views — no heavy fields
export const GameListItemSchema = GameSchema.pick({
  id: true,
  title: true,
  slug: true,
  description: true,
  platform: true,
  tags: true,
  developer: true,
  publisher: true,
  releaseDate: true,
  dateAddedToLibrary: true,
  emulator: true,
  sizeBytes: true,
  manifestUrl: true,
  downloadBaseUrl: true,
}).extend({
  /** Card / row art — from catalog-meta or APIs; independent of package manifest paths. */
  coverImage: z.string().optional(),
  bannerImage: z.string().optional(),
  screenshots: z.array(z.string()).default([]),
  /** Store visibility. Only present on the admin catalog route. */
  publishState: z.enum(["published", "draft"]).optional(),
});

// Shape used when an admin creates or edits a game
export const GameWriteSchema = GameSchema.omit({ id: true, slug: true, dateAddedToLibrary: true });
export const GameUpdateSchema = GameWriteSchema.partial();

export type Game = z.infer<typeof GameSchema>;
export type GameListItem = z.infer<typeof GameListItemSchema>;
export type GameWrite = z.infer<typeof GameWriteSchema>;
export type GameUpdate = z.infer<typeof GameUpdateSchema>;
