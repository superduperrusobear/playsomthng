import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, AppSettings } from "@shared/schemas";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => invoke<AppSettings>(IpcChannel.SETTINGS_GET),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partial: Partial<AppSettings>) =>
      invoke<AppSettings>(IpcChannel.SETTINGS_SET, partial),
    onSuccess: (updated) => {
      qc.setQueryData(["settings"], updated);
    },
  });
}
