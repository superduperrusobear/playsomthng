import { useMutation } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type IgdbMeta, type IgdbSearchResult } from "@shared/schemas";

/** Search IGDB for title candidates. Call `.mutate({ q: "..." })` from the editor. */
export function useIgdbSearch() {
  return useMutation({
    mutationFn: ({ q, limit }: { q: string; limit?: number }) =>
      invoke<{ results: IgdbSearchResult[] }>(IpcChannel.IGDB_SEARCH, { q, limit }),
  });
}

/** Fetch full IGDB metadata for a specific igdbId. */
export function useIgdbFetchGame() {
  return useMutation({
    mutationFn: ({ igdbId }: { igdbId: number }) =>
      invoke<IgdbMeta>(IpcChannel.IGDB_FETCH_GAME, { igdbId }),
  });
}
