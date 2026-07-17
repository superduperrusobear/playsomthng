import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type LocalSessionContext } from "@shared/schemas";

export function useSessionContext() {
  return useQuery({
    queryKey: ["sessionContext"],
    queryFn: () => invoke<LocalSessionContext>(IpcChannel.SESSION_CONTEXT_GET),
    staleTime: Infinity,
  });
}
