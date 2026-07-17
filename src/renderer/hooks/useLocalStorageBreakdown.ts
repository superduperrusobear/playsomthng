import { useQuery } from "@tanstack/react-query";
import { IpcChannel, type LocalStorageBreakdown } from "@shared/schemas";
import { invoke } from "../lib/ipc";

export function useLocalStorageBreakdown() {
  return useQuery({
    queryKey: ["local-storage-breakdown"],
    queryFn: () => invoke<LocalStorageBreakdown>(IpcChannel.LOCAL_STORAGE_BREAKDOWN_GET),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
