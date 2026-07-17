import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, useUpdateSettings } from "./useSettings";
import { invoke } from "../lib/ipc";
import { IpcChannel, type LibraryMode, type ServerStatus } from "@shared/schemas";

interface LibraryModeApi {
  mode: LibraryMode | undefined;
  /** The only switch that matters: connected to a server, or not. */
  isRemote: boolean;
  /** Gate hasn't been answered yet. Controls the gate only — behaves as local everywhere else. */
  needsSetup: boolean;
  loading: boolean;
  /** Saved address, if any — prefills the gate. */
  serverUrl: string;
  useLocal: () => Promise<void>;
  /** Saves the (already probed) URL and switches to remote. */
  useRemote: (baseUrl: string) => Promise<void>;
  /** Back to the gate. Keeps the saved address so it prefills. */
  reopenGate: () => Promise<void>;
}

export function useLibraryMode(): LibraryModeApi {
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();

  const useLocal = useCallback(async () => {
    await update.mutateAsync({ mode: "local" });
    await qc.invalidateQueries({ queryKey: ["serverStatus"] });
  }, [update, qc]);

  const useRemote = useCallback(
    async (baseUrl: string) => {
      const trimmed = baseUrl.trim().replace(/\/+$/, "");
      const existing = settings?.sources ?? [];
      // Reuse the first source slot so switching modes doesn't stack duplicates.
      const sources =
        existing.length > 0
          ? existing.map((s, i) => (i === 0 ? { ...s, baseUrl: trimmed, enabled: true } : s))
          : [{ id: crypto.randomUUID(), name: "Server", baseUrl: trimmed, enabled: true }];
      await update.mutateAsync({ mode: "remote", sources });
      await qc.invalidateQueries({ queryKey: ["serverStatus"] });
    },
    [settings?.sources, update, qc],
  );

  const reopenGate = useCallback(async () => {
    await update.mutateAsync({ mode: "unset" });
    await qc.invalidateQueries({ queryKey: ["serverStatus"] });
  }, [update, qc]);

  return {
    mode: settings?.mode,
    isRemote: settings?.mode === "remote",
    needsSetup: settings != null && settings.mode === "unset",
    loading: isLoading,
    serverUrl:
      settings?.sources.find((s) => s.enabled)?.baseUrl ?? settings?.sources[0]?.baseUrl ?? "",
    useLocal,
    useRemote,
    reopenGate,
  };
}

/** Tests a URL without saving it. */
export function probeServerUrl(baseUrl: string): Promise<ServerStatus> {
  return invoke<ServerStatus>(IpcChannel.SERVER_STATUS_PROBE, { baseUrl });
}
