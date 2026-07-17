import { useQuery } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, type ManifestJson } from "@shared/schemas";
import { useSettings } from "./useSettings";

/** 
 * Fetch a manifest via the admin endpoint (no auth required).
 * Used by the import editor to load file lists for launch target selection.
 */
export function useAdminManifest(gameId: string | undefined) {
  const settingsQuery = useSettings();
  
  return useQuery({
    queryKey: ["admin-manifest", gameId, settingsQuery.data?.sources[0]?.baseUrl],
    queryFn: async () => {
      if (!gameId) throw new Error("No game ID provided");
      if (!settingsQuery.data) throw new Error("Settings not loaded");
      
      // Get the base URL from settings (first enabled source)
      const enabledSource = settingsQuery.data.sources.find((s: any) => s.enabled);
      if (!enabledSource) throw new Error("No enabled library source found");
      
      // Construct full admin manifest URL
      const adminManifestUrl = `${enabledSource.baseUrl}/api/admin/manifests/${gameId}`;
      return invoke<ManifestJson>(IpcChannel.MANIFEST_FETCH, { url: adminManifestUrl });
    },
    enabled: !!gameId && !!settingsQuery.data && settingsQuery.data.sources.some((s: any) => s.enabled),
    staleTime: 60_000,
  });
}