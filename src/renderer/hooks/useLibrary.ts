import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, LibraryResponse } from "@shared/schemas";
import { useLibraryStore } from "../store/library.store";

export function useLibrary() {
  const filters = useLibraryStore((s) => s.filters);

  return useQuery({
    queryKey: ["library", filters],
    queryFn: () => invoke<LibraryResponse>(IpcChannel.LIBRARY_FETCH, filters),
    placeholderData: (prev) => prev,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Fetches the full unfiltered catalog via /api/admin/games (all games, not just published). */
export function useAdminCatalog() {
  return useQuery({
    queryKey: ["admin-catalog"],
    queryFn: () =>
      invoke<LibraryResponse>(IpcChannel.LIBRARY_FETCH, { admin: true }),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}
