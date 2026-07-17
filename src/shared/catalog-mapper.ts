import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import type { Game, GameListItem, Platform } from "./schemas/index";
import { PlatformSchema } from "./schemas/game.schema";
import { LibraryResponseSchema, type LibraryResponse } from "./schemas/library.schema";

/** Namespace UUID — same slug always maps to the same game id (list + detail). */
const CATALOG_NAMESPACE = "e7b8c5d0-9d2a-4f6e-8b1c-0a3d5e7f9a2b";

/** Shape returned by `playsomthng-server` /games catalog. */
export const CatalogGameRawSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.number().nonnegative().optional(),
  downloadBaseUrl: z.string(),
  manifestUrl: z.string(),
  /** Merged from `catalog-meta/{id}.json` when present. */
  coverImage: z.string().optional(),
  screenshotUrls: z.array(z.string()).optional(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  developer: z.string().optional(),
  publisher: z.string().optional(),
  releaseDate: z.string().optional(),
  platform: z.string().optional(),
  tags: z.array(z.string()).optional(),
  emulatorRequired: z.boolean().optional(),
  specialInstructions: z.string().optional(),
  /** Store visibility — only sent on the admin catalog route. */
  publishState: z.enum(["published", "draft"]).optional(),
});

export type CatalogGameRaw = z.infer<typeof CatalogGameRawSchema>;

export function isCatalogGameRaw(v: unknown): v is CatalogGameRaw {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  /** Catalog entries always carry manifest + download base; legacy games use `platform`. */
  return (
    typeof o.manifestUrl === "string" &&
    typeof o.downloadBaseUrl === "string" &&
    typeof o.id === "string" &&
    typeof o.name === "string"
  );
}

export function catalogSlugToStableUuid(slug: string): string {
  return uuidv5(slug, CATALOG_NAMESPACE);
}

/** Normalize image URLs from catalog / IGDB / admin (not manifest file paths). */
function safeHttpUrl(s: string | undefined): string | undefined {
  if (!s?.trim()) return undefined;
  const t = s.trim();
  // Protocol-relative URLs (common on CDNs) — browsers resolve them; Zod .url() often rejects them.
  if (t.startsWith("//")) return t;
  try {
    const u = new URL(t);
    if (u.protocol === "http:" || u.protocol === "https:") return t;
    return undefined;
  } catch {
    return undefined;
  }
}

function parseCatalogPlatform(p: string | undefined): Platform {
  if (!p) return "other";
  const r = PlatformSchema.safeParse(p);
  return r.success ? r.data : "other";
}

function emulatorFromCatalog(raw: CatalogGameRaw): Game["emulator"] {
  if (raw.emulatorRequired === true) {
    return { required: true, emulator: "other" };
  }
  return { required: false };
}

/** Full `Game` for carousel + detail (catalog-backed). */
export function catalogEntryToGame(raw: CatalogGameRaw): Game {
  const slug = raw.id;
  const id = catalogSlugToStableUuid(slug);
  const screenshotList = (raw.screenshotUrls ?? [])
    .map(safeHttpUrl)
    .filter((x): x is string => x !== undefined);
  const cover = safeHttpUrl(raw.coverImage);
  const description =
    raw.description?.trim() ||
    raw.shortDescription?.trim() ||
    `Download base: ${raw.downloadBaseUrl}`;

  return {
    id,
    title: raw.name,
    slug,
    platform: parseCatalogPlatform(raw.platform),
    tags: raw.tags ?? [],
    emulator: emulatorFromCatalog(raw),
    screenshots: screenshotList,
    coverImage: cover,
    sizeBytes: raw.size,
    downloadUrl: raw.manifestUrl,
    manifestUrl: raw.manifestUrl,
    downloadBaseUrl: raw.downloadBaseUrl,
    description,
    developer: raw.developer?.trim() || undefined,
    publisher: raw.publisher?.trim() || undefined,
    releaseDate: raw.releaseDate?.trim() || undefined,
  };
}

export function catalogEntryToGameListItem(raw: CatalogGameRaw): GameListItem {
  const g = catalogEntryToGame(raw);
  return {
    id: g.id,
    title: g.title,
    slug: g.slug,
    platform: g.platform,
    tags: g.tags,
    emulator: g.emulator,
    coverImage: g.coverImage,
    bannerImage: g.bannerImage,
    description: g.description,
    screenshots: g.screenshots,
    developer: g.developer,
    publisher: g.publisher,
    releaseDate: g.releaseDate,
    dateAddedToLibrary: g.dateAddedToLibrary,
    sizeBytes: raw.size,
    manifestUrl: raw.manifestUrl,
    downloadBaseUrl: raw.downloadBaseUrl,
    ...(raw.publishState ? { publishState: raw.publishState } : {}),
  };
}

/** Accepts Rust catalog JSON or legacy library JSON; returns a validated `LibraryResponse`. */
export function normalizeLibraryResponse(data: unknown): LibraryResponse {
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!obj || !Array.isArray(obj.games)) {
    return LibraryResponseSchema.parse(data);
  }

  if (obj.games.length === 0) {
    return LibraryResponseSchema.parse({
      source: String(obj.source ?? "download-server"),
      totalGames: Number(obj.totalGames ?? 0),
      games: [],
      page: Number(obj.page ?? 1),
      pageSize: Number(obj.pageSize ?? 50),
      totalPages: Number(obj.totalPages ?? 1),
    });
  }

  if (isCatalogGameRaw(obj.games[0])) {
    const games = obj.games.map((g) =>
      catalogEntryToGameListItem(CatalogGameRawSchema.parse(g))
    );
    return LibraryResponseSchema.parse({
      source: String(obj.source ?? "download-server"),
      totalGames: Number(obj.totalGames ?? games.length),
      games,
      page: Number(obj.page ?? 1),
      pageSize: Number(obj.pageSize ?? 50),
      totalPages: Number(obj.totalPages ?? 1),
    });
  }

  return LibraryResponseSchema.parse(data);
}
