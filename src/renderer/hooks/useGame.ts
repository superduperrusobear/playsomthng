import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, Game } from "@shared/schemas";
import { gameQueryKey } from "../lib/gameQueryCache";

export function useGame(id: string) {
  return useQuery({
    queryKey: gameQueryKey(id),
    queryFn: () => invoke<Game>(IpcChannel.GAME_GET, { id }),
    enabled: !!id,
  });
}
