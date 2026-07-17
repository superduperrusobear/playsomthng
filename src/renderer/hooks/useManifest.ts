import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type ManifestJson } from "@shared/schemas";

/** Fetch a single package manifest JSON (Rust `GET /manifests/{id}`) via main process. */
export function useManifest(manifestUrl: string | undefined) {
  return useQuery({
    queryKey: ["manifest", manifestUrl],
    queryFn: () => invoke<ManifestJson>(IpcChannel.MANIFEST_FETCH, { url: manifestUrl! }),
    enabled: !!manifestUrl,
    staleTime: 60_000,
  });
}
