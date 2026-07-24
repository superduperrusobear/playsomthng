import type { Game, GameListItem } from "@shared/schemas";

/**
 * IGDB serves multiple Cloudinary-style sizes (`t_cover_big`, etc.). Store cards are large —
 * request a sharper derivative when the URL is from IGDB.
 */
export function preferHigherResImageUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  if (!url.includes("images.igdb.com")) return url;
  return url.replace(/\/t_[a-z0-9_]+\//i, "/t_1080p/");
}

/**
 * Card art for Store / Library: comes from server-merged catalog metadata (IGDB, admin URLs),
 * not from manifest file paths. Prefer cover → banner → first screenshot.
 */
export function resolveStoreCoverImage(g: GameListItem | Game): string | undefined {
  const shots = g.screenshots ?? [];
  const raw = g.coverImage ?? g.bannerImage ?? shots[0];
  return preferHigherResImageUrl(raw);
}

/**
 * Catalog list items omit several `Game` fields; the store/detail UI expects a full `Game`
 * (e.g. `screenshots` array) so we fill safe defaults — avoids runtime crashes on expand.
 */
export function gameListItemToGame(g: GameListItem): Game {
  const shots = (g.screenshots ?? [])
    .map((u) => preferHigherResImageUrl(u))
    .filter((u): u is string => !!u);
  const cover = resolveStoreCoverImage(g);
  return {
    id: g.id,
    title: g.title,
    slug: g.slug,
    platform: g.platform,
    tags: g.tags ?? [],
    emulator: g.emulator ?? { required: false },
    coverImage: cover,
    bannerImage: g.bannerImage,
    developer: g.developer,
    publisher: g.publisher,
    releaseDate: g.releaseDate,
    dateAddedToLibrary: g.dateAddedToLibrary,
    screenshots: shots,
    description: g.description,
    specialInstructions: g.specialInstructions,
    systemRequirements: undefined,
    sizeBytes: g.sizeBytes,
    /** Same as catalogEntryToGame — list hydration must keep install URLs or InstallModal breaks. */
    downloadUrl: g.manifestUrl,
    manifestUrl: g.manifestUrl,
    downloadBaseUrl: g.downloadBaseUrl,
  };
}
