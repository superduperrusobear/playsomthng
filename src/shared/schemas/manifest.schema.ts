import { z } from "zod";

/** Mirrors `playsomthng-server` manifest JSON (`serde` camelCase). */
export const PackageTypeSchema = z.enum(["pc-game", "rom", "rom-bundle", "iso", "emulator"]);

/**
 * Manifest file entries are always relative, forward-slashed paths inside the
 * game folder. Reject anything that could escape that folder (traversal, absolute
 * paths, drive letters, UNC paths) or that isn't a simple relative path.
 */
export const ManifestFileRelativePathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.includes("\0"), "Path contains a null byte")
  .refine((p) => !p.startsWith("/") && !p.startsWith("\\"), "Path must be relative")
  .refine((p) => !/^[A-Za-z]:[\\/]/.test(p), "Path must not include a drive letter")
  .refine((p) => !p.startsWith("\\\\"), "UNC paths are not allowed")
  .refine((p) => {
    const segments = p.replace(/\\/g, "/").split("/");
    return segments.every((s) => s !== "" && s !== "." && s !== "..");
  }, "Path may not contain traversal segments");

export const ManifestFileSchema = z.object({
  path: ManifestFileRelativePathSchema,
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
