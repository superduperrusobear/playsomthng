import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IpcChannel, type LibraryFilters, type LibraryResponse } from "@shared/schemas";
import { invoke } from "../lib/ipc";
import type { Game, GameListItem } from "@shared/schemas";
import { gameListItemToGame } from "../lib/storeGame";

/**
 * Stable filters for the Store only: full catalog (no search/platform from the Library UI).
 */
const STORE_CATALOG_FILTERS: LibraryFilters = {
  sortBy: "title",
  sortDir: "asc",
  page: 1,
  pageSize: 50,
};

/**
 * Store carousel: the server's /api/games already returns only admin-published titles,
 * so no client-side filtering is needed.
 */
export function useStoreGames() {
  const libraryQuery = useQuery({
    queryKey: ["library", "store-catalog", STORE_CATALOG_FILTERS],
    queryFn: () => invoke<LibraryResponse>(IpcChannel.LIBRARY_FETCH, STORE_CATALOG_FILTERS),
    placeholderData: (prev) => prev,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const catalogItems: GameListItem[] = useMemo(
    () => (libraryQuery.data?.games ?? []) as GameListItem[],
    [libraryQuery.data?.games],
  );

  const games: Game[] = useMemo(
    () => catalogItems.map((g) => gameListItemToGame(g)),
    [catalogItems],
  );

  const isLoading = libraryQuery.isLoading;
  const isError = libraryQuery.isError;
  const error = libraryQuery.error;

  return {
    games,
    importedListItems: catalogItems,
    isLoading,
    isError,
    error,
    isEmpty: !isLoading && !isError && games.length === 0,
    refetch: libraryQuery.refetch,
  };
}
