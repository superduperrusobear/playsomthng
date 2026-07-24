import { create } from "zustand";
import type { UserPublic } from "@shared/schemas";

interface AuthState {
  user: UserPublic | null;
  token: string | null;
  isAuthenticated: boolean;
  /** Server revoked this account. User stays signed in but is denied downloads/catalog. */
  accessRevoked: boolean;
  setAuth: (user: UserPublic, token: string) => void;
  clearAuth: () => void;
  setAccessRevoked: (revoked: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  accessRevoked: false,
  setAuth: (user, token) => set({ user, token, isAuthenticated: true, accessRevoked: false }),
  clearAuth: () => set({ user: null, token: null, isAuthenticated: false, accessRevoked: false }),
  setAccessRevoked: (revoked) => set({ accessRevoked: revoked }),
}));
