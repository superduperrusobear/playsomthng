import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel } from "@shared/schemas";
import { useAuthStore } from "../store/auth.store";
import type {
  DriveInfo,
  DiskSpaceResult,
  InstallOptions,
  InstallSession,
  InstallProgressEvent,
} from "@shared/schemas";

// ── Drive list ────────────────────────────────────────────────────────────────

export function useDrives() {
  return useQuery<DriveInfo[]>({
    queryKey: ["drives"],
    queryFn: () => invoke<DriveInfo[]>(IpcChannel.DRIVES_LIST),
    staleTime: 30_000,
    // Retry once quickly — sysinfo might still be collecting on first open
    retry: 2,
    retryDelay: 500,
  });
}

// ── Disk space check (mutation so it runs on demand) ─────────────────────────

export function useDiskSpaceCheck() {
  return useMutation<DiskSpaceResult, Error, { mount: string; requiredBytes: number }>({
    mutationFn: (args) => invoke<DiskSpaceResult>(IpcChannel.DISK_SPACE_FOR_GAME, args),
  });
}

// ── Preferred install mount ───────────────────────────────────────────────────

export function useInstallPref() {
  return useQuery<{ mount: string | null }>({
    queryKey: ["install-pref"],
    queryFn: () => invoke<{ mount: string | null }>(IpcChannel.INSTALL_PREF_GET),
    staleTime: Infinity,
  });
}

export function useSaveInstallPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mount: string) => invoke(IpcChannel.INSTALL_PREF_SET, { mount }),
    onSuccess: (_data, mount) => {
      qc.setQueryData(["install-pref"], { mount });
    },
  });
}

// ── Session for one game ──────────────────────────────────────────────────────

export function useInstallSession(gameId: string | null | undefined) {
  return useQuery<InstallSession | null>({
    queryKey: ["install-session", gameId],
    queryFn: () =>
      gameId ? invoke<InstallSession | null>(IpcChannel.INSTALL_GET, { gameId }) : null,
    enabled: !!gameId,
    staleTime: 30_000,
  });
}

// ── All sessions (for resume on startup) ─────────────────────────────────────

export function useInstallList() {
  return useQuery<InstallSession[]>({
    queryKey: ["install-list"],
    queryFn: () => invoke<InstallSession[]>(IpcChannel.INSTALL_LIST),
    staleTime: 5_000,
  });
}

export function useClearCompletedDownloads() {
  const qc = useQueryClient();
  return useMutation<{ removed: number; sessions: InstallSession[] }, Error>({
    mutationFn: () => invoke<{ removed: number; sessions: InstallSession[] }>(IpcChannel.INSTALL_CLEAR_COMPLETED),
    onSuccess: (res) => {
      qc.setQueryData(["install-list"], res.sessions);
    },
  });
}

// ── Start install ─────────────────────────────────────────────────────────────

export function useStartInstall() {
  const qc = useQueryClient();
  return useMutation<InstallSession, Error, InstallOptions>({
    mutationFn: (opts) => invoke<InstallSession>(IpcChannel.INSTALL_START, opts),
    onSuccess: (session) => {
      qc.setQueryData(["install-session", session.gameId], session);
      void qc.invalidateQueries({ queryKey: ["install-list"] });
      void qc.invalidateQueries({ queryKey: ["local-library"] });
    },
  });
}

// ── Pause / Resume / Cancel ───────────────────────────────────────────────────

export function usePauseInstall() {
  const qc = useQueryClient();
  return useMutation<InstallSession | null, Error, string>({
    mutationFn: (gameId) => invoke<InstallSession | null>(IpcChannel.INSTALL_PAUSE, { gameId }),
    onSuccess: (session) => {
      if (session) qc.setQueryData(["install-session", session.gameId], session);
    },
  });
}

export function useResumeInstall() {
  const qc = useQueryClient();
  return useMutation<InstallSession | null, Error, string>({
    mutationFn: (gameId) => invoke<InstallSession | null>(IpcChannel.INSTALL_RESUME, { gameId }),
    onSuccess: (session) => {
      if (session) qc.setQueryData(["install-session", session.gameId], session);
    },
  });
}

export function useCancelInstall() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (gameId) => invoke<{ ok: boolean }>(IpcChannel.INSTALL_CANCEL, { gameId }),
    onSuccess: (_r, gameId) => {
      qc.setQueryData(["install-session", gameId], null);
      void qc.invalidateQueries({ queryKey: ["install-list"] });
      void qc.invalidateQueries({ queryKey: ["local-library"] });
    },
  });
}

// ── Launch ────────────────────────────────────────────────────────────────────

export function useLaunchGame() {
  return useMutation<
    { ok: boolean; pid?: number; error?: string },
    Error,
    | { gameId: string; installPath: string; launchTarget: string }
    | { gameId: string; absoluteExePath: string }
  >({
    mutationFn: (args) =>
      invoke<{ ok: boolean; pid?: number; error?: string }>(IpcChannel.GAME_LAUNCH, args),
  });
}

// ── Stop ───────────────────────────────────────────────────────────────────────
export function useStopGame() {
  return useMutation<{ ok: boolean; error?: string }, Error, string>({
    mutationFn: (gameId) => invoke<{ ok: boolean; error?: string }>(IpcChannel.GAME_STOP, { gameId }),
  });
}

// ── Uninstall ─────────────────────────────────────────────────────────────────

export function useUninstallGame() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; error?: string }, Error, string>({
    mutationFn: (gameId) =>
      invoke<{ ok: boolean; error?: string }>(IpcChannel.GAME_UNINSTALL, { gameId }),
    onSuccess: (_r, gameId) => {
      qc.setQueryData(["install-session", gameId], null);
      void qc.invalidateQueries({ queryKey: ["install-list"] });
      void qc.invalidateQueries({ queryKey: ["local-library"] });
      void qc.invalidateQueries({ queryKey: ["localLibraryFile"] });
      void qc.invalidateQueries({ queryKey: ["dir-size"] });
    },
  });
}

// ── Verify / Open folder ─────────────────────────────────────────────────────-

export function useVerifyInstall() {
  return useMutation<{ ok: boolean; missing: number; mismatched: number; error?: string }, Error, string>({
    mutationFn: (gameId) =>
      invoke<{ ok: boolean; missing: number; mismatched: number; error?: string }>(IpcChannel.INSTALL_VERIFY, {
        gameId,
      }),
  });
}

export function useOpenInstallFolder() {
  return useMutation<{ ok: boolean; error?: string }, Error, string>({
    mutationFn: (gameId) => invoke<{ ok: boolean; error?: string }>(IpcChannel.INSTALL_OPEN_FOLDER, { gameId }),
  });
}

export function useSetLaunchOverride() {
  return useMutation<{ ok: boolean; error?: string }, Error, { gameId: string; launchTarget: string | null }>({
    mutationFn: (args) =>
      invoke<{ ok: boolean; error?: string }>(IpcChannel.LAUNCH_OVERRIDE_SET, {
        gameId: args.gameId,
        launchTarget: args.launchTarget,
      }),
  });
}

/** Scans `installPath` on disk for launchable files (relative paths). Used when editing launch target for installed games. */
export function useLaunchCandidatesList(installPath: string | null | undefined, enabled: boolean) {
  return useQuery<{ relativePaths: string[]; error?: string }>({
    queryKey: ["launch-candidates", installPath],
    queryFn: () =>
      invoke<{ relativePaths: string[]; error?: string }>(IpcChannel.INSTALL_LAUNCH_CANDIDATES_LIST, {
        installPath: installPath!.trim(),
      }),
    enabled: Boolean(enabled && installPath?.trim()),
    staleTime: 30_000,
  });
}

// ── Progress listener (IPC push) ──────────────────────────────────────────────
// One ipcRenderer listener for the whole app. Each `useInstallProgress` registers
// a callback keyed by gameId — avoids MaxListenersExceeded when many cards mount.

const progressListenersByGame = new Map<string, Set<(e: InstallProgressEvent) => void>>();
let installProgressIpcOff: (() => void) | null = null;

function ensureInstallProgressIpc(): void {
  if (installProgressIpcOff) return;
  installProgressIpcOff = window.api.on(IpcChannel.INSTALL_PROGRESS, (...args: unknown[]) => {
    const data = args[0] as InstallProgressEvent;
    // A revoked account still sees the app; a denied download flips the global banner.
    if (data.error && data.error.includes("ACCOUNT_REVOKED")) {
      useAuthStore.getState().setAccessRevoked(true);
    }
    const set = progressListenersByGame.get(data.gameId);
    if (!set || set.size === 0) return;
    set.forEach((fn) => {
      try {
        fn(data);
      } catch {
        /* ignore subscriber errors */
      }
    });
  });
}

export function useInstallProgress(
  gameId: string | null | undefined,
  onProgress: (e: InstallProgressEvent) => void,
) {
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    if (!gameId) return;

    const handler = (e: InstallProgressEvent) => {
      onProgressRef.current(e);
    };

    let set = progressListenersByGame.get(gameId);
    if (!set) {
      set = new Set();
      progressListenersByGame.set(gameId, set);
    }
    set.add(handler);
    ensureInstallProgressIpc();

    return () => {
      const s = progressListenersByGame.get(gameId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) progressListenersByGame.delete(gameId);
    };
  }, [gameId]);
}
