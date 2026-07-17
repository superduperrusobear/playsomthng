import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, ServerStatus } from "@shared/schemas";

export function useServerStatus() {
  return useQuery({
    queryKey: ["serverStatus"],
    queryFn: () => invoke<ServerStatus>(IpcChannel.SERVER_STATUS_GET),
    // Poll faster when offline to recover quickly; never when unconfigured.
    refetchInterval: (query) => {
      const data = query.state.data as ServerStatus | undefined;
      if (data?.serverState === "unconfigured") return false;
      return data?.online ? 20_000 : 10_000;
    },
    refetchOnMount: true,
    staleTime: 0,
    retry: 1,
    retryDelay: 1500,
  });
}
