import { useEffect } from "react";
import { useLibrary } from "./useLibrary";
import { useStoreGames } from "./useStoreGames";
import { useAuthStore } from "../store/auth.store";

/** True when an error came from the server revoking this account. */
export function isRevokedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("ACCOUNT_REVOKED");
}

/**
 * Watches catalog fetches for a revocation signal and flips the global flag.
 * The user is never logged out — they see a banner and downloads are denied.
 */
export function useAccessRevokedWatcher() {
  const library = useLibrary();
  const store = useStoreGames();
  const setAccessRevoked = useAuthStore((s) => s.setAccessRevoked);

  useEffect(() => {
    const revoked = isRevokedError(library.error) || isRevokedError(store.error);
    if (revoked) setAccessRevoked(true);
  }, [library.error, store.error, setAccessRevoked]);
}
