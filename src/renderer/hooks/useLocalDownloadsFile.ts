import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type LocalDownloadsFile } from "@shared/schemas";

export function useLocalDownloadsFile() {
  return useQuery({
    queryKey: ["localDownloadsFile"],
    queryFn: () => invoke<LocalDownloadsFile>(IpcChannel.LOCAL_DOWNLOADS_GET),
  });
}

export function useSaveLocalDownloadsFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: LocalDownloadsFile) =>
      invoke<LocalDownloadsFile>(IpcChannel.LOCAL_DOWNLOADS_SET, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["localDownloadsFile"] }),
  });
}
