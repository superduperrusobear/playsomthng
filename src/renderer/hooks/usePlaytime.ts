import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, PlaytimeEntry } from "@shared/schemas";

export function usePlaytime() {
  return useQuery({
    queryKey: ["playtime"],
    queryFn: () => invoke<PlaytimeEntry[]>(IpcChannel.PLAYTIME_GET),
  });
}

export function useStartPlaytime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) => invoke(IpcChannel.PLAYTIME_START, { gameId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playtime"] }),
  });
}

export function useStopPlaytime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) => invoke(IpcChannel.PLAYTIME_STOP, { gameId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playtime"] }),
  });
}
