import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel } from "@shared/schemas";

/** Cached snapshot from startup (or last refresh). */
export function useSysinfo() {
  return useQuery({
    queryKey: ["sysinfo"],
    queryFn: () => invoke<unknown>(IpcChannel.SYSINFO_GET),
    staleTime: Infinity,
  });
}

export function useRefreshSysinfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<unknown>(IpcChannel.SYSINFO_REFRESH),
    onSuccess: (data) => {
      qc.setQueryData(["sysinfo"], data);
    },
  });
}

export function useDiskSpaceCheck() {
  return useMutation({
    mutationFn: (args: { requiredBytes: number; preferredMount?: string | null }) =>
      invoke<unknown>(IpcChannel.SYSINFO_DISK_CHECK, args),
  });
}
