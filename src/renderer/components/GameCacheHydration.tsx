import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLibrary } from "../hooks/useLibrary";
import { hydrateGameQueriesFromList } from "../lib/gameQueryCache";

/**
 * When the catalog list loads, copy each row into the per-game query cache so
 * `/game/:id` and prefetch paths hit memory instead of the API every time.
 */
export function GameCacheHydration() {
  const qc = useQueryClient();
  const { data } = useLibrary();

  useEffect(() => {
    const games = data?.games;
    if (!games?.length) return;
    hydrateGameQueriesFromList(qc, games);
  }, [data, qc]);

  return null;
}
