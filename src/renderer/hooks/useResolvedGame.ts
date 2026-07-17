import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalLibraryFile } from "./useLocalLibraryFile";
import { invoke } from "../lib/ipc";
import { IpcChannel, type Game } from "@shared/schemas";
import { gameFromLocalLibraryEntry } from "../lib/localGame";
import { gameQueryKey } from "../lib/gameQueryCache";

/**
 * Resolves a game for `/game/:id`: catalog games from the server, user-owned games from disk.
 *
 * Remote `GAME_GET` runs in parallel with loading `user-library.json` — we only skip the server
 * fetch once we know this id is a user-owned entry (`source: own`), since that data is local-only.
 */
export function useResolvedGame(id: string | undefined) {
  const { data: libraryFile, isLoading: libLoading } = useLocalLibraryFile();
  const localEntry = useMemo(
    () => (id ? libraryFile?.games.find((g) => g.gameId === id) : undefined),
    [libraryFile?.games, id],
  );

  const isKnownOwn = localEntry?.source === "own";
  const remoteEnabled = !!id && !isKnownOwn;

  const remote = useQuery({
    queryKey: id ? gameQueryKey(id) : ["game", "__disabled__"],
    queryFn: () => invoke<Game>(IpcChannel.GAME_GET, { id: id! }),
    enabled: remoteEnabled,
    retry: false,
  });

  const synthetic = useMemo(() => {
    if (!id || !localEntry || localEntry.source !== "own") return null;
    return gameFromLocalLibraryEntry(localEntry);
  }, [id, localEntry]);

  const data = synthetic ?? remote.data ?? undefined;
  const isLoading =
    !!id &&
    data === undefined &&
    (libLoading || (remoteEnabled && (remote.isLoading || remote.isFetching)));
  const isOwnGame = localEntry?.source === "own";

  return {
    data,
    isLoading,
    isError: !isOwnGame && remote.isError && !libLoading && data === undefined,
    isOwnGame: !!isOwnGame,
  };
}
