import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type CatalogMeta } from "@shared/schemas";

const KEY = (id: string) => ["catalog-meta", id];

/** Load editable metadata for one catalog item (creates a draft stub if not yet saved). */
export function useCatalogMeta(id: string | undefined) {
  return useQuery({
    queryKey: KEY(id ?? ""),
    queryFn: () => invoke<CatalogMeta>(IpcChannel.CATALOG_META_GET, { id: id! }),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/** Save (PUT) editable metadata for one catalog item. */
export function useSaveCatalogMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meta: CatalogMeta) =>
      invoke<CatalogMeta>(IpcChannel.CATALOG_META_SET, meta),
    onSuccess: async (saved) => {
      qc.setQueryData(KEY(saved.id), saved);
      // Server merges catalog-meta into GET /api/games — bust caches so Store/Library update immediately.
      // refetchType: "all" refetches inactive queries too (e.g. Store tab) despite refetchOnMount: false.
      await qc.invalidateQueries({
        queryKey: ["library"],
        refetchType: "all",
      });
      await qc.invalidateQueries({
        queryKey: ["game"],
        refetchType: "all",
      });
      await qc.invalidateQueries({
      });
      void qc.invalidateQueries({ queryKey: ["local-storage-breakdown"] });
    },
  });
}
