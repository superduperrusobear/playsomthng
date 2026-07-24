import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel, AuthResponse, type StoredUserSession } from "@shared/schemas";
import { useAuthStore } from "../store/auth.store";

const SECONDS_PER_DAY = 86400;

/** Persisted session file shape — used after login / onboarding completes. */
export function buildStoredSessionFromAuth(data: AuthResponse): StoredUserSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    userId: data.user.id,
    username: data.user.username,
    role: data.user.role,
    createdAt: data.user.createdAt,
    token: data.token,
    tokenExpiresAt: now + 30 * SECONDS_PER_DAY,
    lastAuthenticatedAt: now,
  };
}

/** Authenticate with the server; successful enrollment can be committed immediately. */
export function useLogin() {
  return useMutation({
    mutationFn: (payload: { username: string; scikde: string }) =>
      invoke<AuthResponse>(IpcChannel.AUTH_LOGIN, payload),
  });
}

export function useCommitLoginSession() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const qc = useQueryClient();

  return useCallback(
    async (data: AuthResponse) => {
      setAuth(data.user, data.token);
      await invoke(IpcChannel.AUTH_SESSION_SET, buildStoredSessionFromAuth(data));
      await qc.invalidateQueries({ queryKey: ["storedSession"] });
    },
    [setAuth, qc],
  );
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await invoke(IpcChannel.AUTH_LOGOUT);
      await invoke(IpcChannel.AUTH_SESSION_SET, null);
    },
    onSuccess: () => {
      clearAuth();
      void qc.invalidateQueries({ queryKey: ["storedSession"] });
    },
    onError: () => clearAuth(),
  });
}
