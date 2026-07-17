import { useMemo } from "react";
import { useLibrary } from "./useLibrary";
import { useLocalLibraryFile } from "./useLocalLibraryFile";
import type { Game, GameListItem } from "@shared/schemas";
import { gameListItemToGame } from "../lib/storeGame";

/**
 * User Library: games the user added via Store → "Add to library" (`user-library.json`).
 * Not the same as the Store catalog (admin-published).
 */
export function useUserLibraryGames() {
  const libraryQuery = useLibrary();
  const localQuery = useLocalLibraryFile();

  const importedListItems: GameListItem[] = useMemo(() => {
    const catalog = (libraryQuery.data?.games ?? []) as GameListItem[];
    const localGames = localQuery.data?.games ?? [];
    const userIds = new Set(localGames.map((e) => e.gameId));

    const catalogMatches = catalog.filter((g) => userIds.has(g.id));

    // When catalog is unavailable, synthesize minimal entries for installed "library" source games
    // so they remain visible and launchable without network access.
    const catalogMatchIds = new Set(catalogMatches.map((g) => g.id));
    const offlineFallback: GameListItem[] = libraryQuery.isError
      ? localGames
          .filter((e) => e.source === "server" && !catalogMatchIds.has(e.gameId))
          .map((e): GameListItem => ({
            id: e.gameId,
            title: e.customTitle ?? e.gameId,
            slug: e.gameId,
            platform: "other",
            tags: [],
            screenshots: [],
            coverImage: e.customCoverImage,
            emulator: { required: false },
          }))
      : [];

    const customGames: GameListItem[] = localGames
      .filter((e) => e.source === "own")
      .map((e) => {
        const item: GameListItem = {
          id: e.gameId,
          title: e.customTitle ?? e.gameId,
          slug: e.gameId,
          description: e.customDescription?.trim() || undefined,
          platform: "other",
          tags: [],
          developer: e.customDeveloper?.trim() || undefined,
          publisher: e.customPublisher?.trim() || undefined,
          releaseDate: e.customReleaseDate?.match(/^\d{4}-\d{2}-\d{2}$/)
            ? e.customReleaseDate
            : undefined,
          dateAddedToLibrary: e.customAddedAt != null ? new Date(e.customAddedAt * 1000).toISOString() : undefined,
          emulator: { required: false },
          sizeBytes: undefined,
          manifestUrl: undefined,
          downloadBaseUrl: undefined,
          coverImage: e.customCoverImage,
          bannerImage: undefined,
          screenshots: e.customScreenshotUrls ?? [],
        };
        return item;
      });

    return [...catalogMatches, ...offlineFallback, ...customGames];
  }, [libraryQuery.data?.games, libraryQuery.isError, localQuery.data?.games]);

  const games: Game[] = useMemo(
    () => importedListItems.map((g) => gameListItemToGame(g)),
    [importedListItems],
  );

  const isLoading = libraryQuery.isLoading || localQuery.isLoading;
  const isError = libraryQuery.isError;
  const error = libraryQuery.error;

  return {
    games,
    importedListItems,
    isLoading,
    isError,
    error,
    isEmpty: !isLoading && !isError && games.length === 0,
  };
}
