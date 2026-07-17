import type { QueryClient } from "@tanstack/react-query";
import type { GameListItem } from "@shared/schemas";
import { gameListItemToGame } from "./storeGame";

/** Game rows are hydrated from the library list and invalidated when the catalog revision changes (SSE / save). */
export const GAME_QUERY_STALE_MS = Number.POSITIVE_INFINITY;
export const GAME_QUERY_GC_MS = 2 * 60 * 60 * 1000;

export const gameQueryDefaults = {
  staleTime: GAME_QUERY_STALE_MS,
  gcTime: GAME_QUERY_GC_MS,
  refetchOnMount: false as const,
  refetchOnWindowFocus: false as const,
};

export function gameQueryKey(id: string) {
  return ["game", id] as const;
}

/**
 * Seeds `["game", id]` from the catalog list response so detail views reuse known data
 * instead of refetching the same game repeatedly.
 */
export function hydrateGameQueriesFromList(qc: QueryClient, games: GameListItem[]) {
  for (const item of games) {
    qc.setQueryData(gameQueryKey(item.id), gameListItemToGame(item));
  }
}
