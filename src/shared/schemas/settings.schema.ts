import { z } from "zod";
import { LibrarySourceSchema } from "./library.schema";

export const AppearanceSchema = z.object({
  theme: z.enum(["dark", "darker", "midnight"]).default("dark"),
  accentColor: z.enum(["purple", "blue", "pink", "green"]).default("purple"),
  reducedMotion: z.boolean().default(false),
  compactMode: z.boolean().default(false),
});

/** `unset` shows the connect gate. Authoritative over `sources[].enabled`. */
export const LibraryModeSchema = z.enum(["unset", "local", "remote"]);
export type LibraryMode = z.infer<typeof LibraryModeSchema>;

/** Bumped to 2 when `mode` was added. */
export const SETTINGS_VERSION = 2;

export const AppSettingsSchema = z.object({
  version: z.number().default(SETTINGS_VERSION),
  appearance: AppearanceSchema.default({}),
  mode: LibraryModeSchema.default("unset"),
  sources: z.array(LibrarySourceSchema).default([]),
  minimizeToTray: z.boolean().default(true),
  launchOnStartup: z.boolean().default(false),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type Appearance = z.infer<typeof AppearanceSchema>;
