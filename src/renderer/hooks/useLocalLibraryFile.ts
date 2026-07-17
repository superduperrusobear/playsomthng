import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type LocalLibraryFile } from "@shared/schemas";

export function useLocalLibraryFile() {
  return useQuery({
    queryKey: ["localLibraryFile"],
    queryFn: () => invoke<LocalLibraryFile>(IpcChannel.LOCAL_LIBRARY_GET),
    staleTime: 60_000,
  });
}

export function useSaveLocalLibraryFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: LocalLibraryFile) => invoke<LocalLibraryFile>(IpcChannel.LOCAL_LIBRARY_SET, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["localLibraryFile"] }),
  });
}
