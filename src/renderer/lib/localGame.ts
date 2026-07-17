import type { Game, LocalLibraryGameEntry } from "@shared/schemas";

/** Build a full `Game` object for user-added (`source: own`) library entries. */
export function gameFromLocalLibraryEntry(entry: LocalLibraryGameEntry): Game {
  if (entry.source !== "own") {
    throw new Error("gameFromLocalLibraryEntry: entry must be source own");
  }
  return {
    id: entry.gameId,
    title: entry.customTitle ?? entry.gameId,
    slug: entry.gameId,
    description: entry.customDescription?.trim() || undefined,
    coverImage: entry.customCoverImage,
    bannerImage: undefined,
    screenshots: entry.customScreenshotUrls ?? [],
    developer: entry.customDeveloper?.trim() || undefined,
    publisher: entry.customPublisher?.trim() || undefined,
    releaseDate: entry.customReleaseDate?.match(/^\d{4}-\d{2}-\d{2}$/)
      ? entry.customReleaseDate
      : undefined,
    dateAddedToLibrary:
      entry.customAddedAt != null ? new Date(entry.customAddedAt * 1000).toISOString() : undefined,
    platform: "other",
    tags: [],
    emulator: { required: false },
    sizeBytes: undefined,
    manifestUrl: undefined,
    downloadBaseUrl: undefined,
  };
}
