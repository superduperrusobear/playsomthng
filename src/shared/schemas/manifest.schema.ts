import { z } from "zod";

/** Mirrors `playsomthng-server` manifest JSON (`serde` camelCase). */
export const PackageTypeSchema = z.enum(["pc-game", "rom", "rom-bundle", "iso", "emulator"]);

export const ManifestFileSchema = z.object({
  path: z.string(),
  size: z.number().nonnegative(),
  hash: z.string().optional().nullable(),
});

export const ManifestJsonSchema = z.object({
  id: z.string(),
  source: z.string(),
  generatedAt: z.number(),
  size: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  packageType: PackageTypeSchema,
  launchTarget: z.string().optional().nullable(),
  files: z.array(ManifestFileSchema),
});

export type ManifestJson = z.infer<typeof ManifestJsonSchema>;
export type PackageTypeManifest = z.infer<typeof PackageTypeSchema>;
