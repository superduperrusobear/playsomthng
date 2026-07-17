import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type StoredUserSession } from "@shared/schemas";

export function useStoredSession() {
  return useQuery({
    queryKey: ["storedSession"],
    queryFn: () => invoke<StoredUserSession | null>(IpcChannel.AUTH_SESSION_GET),
  });
}

export function useSaveStoredSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StoredUserSession | null) =>
      invoke<StoredUserSession | null>(IpcChannel.AUTH_SESSION_SET, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["storedSession"] }),
  });
}
