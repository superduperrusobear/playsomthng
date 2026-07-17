/**
 * Library card — cover art fills the entire card.
 * Click opens the game hub (`/game/:id`) — same launcher flow as the Store grid.
 *
 * Download progress still shows on the card while active; full controls live on the detail page.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { GameListItem, InstallProgressEvent } from "@shared/schemas";
import { useInstallSession, useInstallProgress } from "../../hooks/useInstall";
import { useLocalLibraryFile } from "../../hooks/useLocalLibraryFile";
import { resolveStoreCoverImage, gameListItemToGame } from "../../lib/storeGame";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/cn";
import { useGamePreviewStore } from "../../store/gamePreview.store";

interface LibraryCardProps {
  game: GameListItem;
  hideHoverOverlay?: boolean;
}

export function LibraryCard({ game, hideHoverOverlay = false }: LibraryCardProps) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const setPreviewGame = useGamePreviewStore((s) => s.set);
  const { data: libraryFile } = useLocalLibraryFile();
  const libraryEntry = useMemo(
    () => libraryFile?.games.find((g) => g.gameId === game.id),
    [libraryFile?.games, game.id],
  );

  const { data: sessionData } = useInstallSession(game.id);
  const [session, setSession] = useState(sessionData ?? null);

  useEffect(() => { setSession(sessionData ?? null); }, [sessionData]);

  // Only subscribe to progress events when there is actually an active download.
  // Subscribing unconditionally means every card on the page holds an open listener,
  // and since games appear in multiple rows, listener count explodes.
  const isActiveDownload =
    sessionData != null &&
    (sessionData.state === "downloading" ||
      sessionData.state === "paused" ||
      sessionData.state === "error");

  useInstallProgress(
    isActiveDownload ? game.id : null,
    useCallback((e: InstallProgressEvent) => {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              state: e.state,
              downloadedBytes: e.downloadedBytes,
              totalBytes: e.totalBytes,
              error: e.error,
            }
          : prev,
      );
    }, []),
  );

  const cover = resolveStoreCoverImage(game);
  const isInstalled = libraryEntry?.installed === true || session?.state === "completed";
  const isDownloading = session?.state === "downloading";
  const isPaused = session?.state === "paused";
  const isError = session?.state === "error";
  const inProgress = isDownloading || isPaused || isError;

  const pct = session && session.totalBytes > 0
    ? (session.downloadedBytes / session.totalBytes) * 100
    : 0;

  const handleClick = () => {
    const rect = cardRef.current?.getBoundingClientRect();
    setPreviewGame(
      gameListItemToGame(game),
      rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
    );
    navigate(`/game/${game.id}`);
  };

  return (
    <>
      <div
        ref={cardRef}
        onClick={handleClick}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-xl bg-[#111] transition-all duration-200",
          "border border-[#1e1e1e]/90 hover:border-[#3a3a3a]/80",
          isInstalled && "hover:border-[#3a67f0]/45",
          "hover:-translate-y-0.5",
          "card-shadow-smudge",
        )}
      >
        {/* Cover fills entire card */}
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-t-xl">
          {cover ? (
            <img
              src={cover}
              alt={game.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1e1e1e] to-[#111]">
              <span className="text-3xl font-bold text-[#2a2a2a]">{game.title[0]}</span>
            </div>
          )}
          <div className="card-glimmer rounded-t-xl" aria-hidden />
        </div>

        {/* Hover overlay — shows action label */}
        {(!hideHoverOverlay || inProgress) && (
          <div
            className={cn(
              "absolute inset-0 z-[2] flex flex-col items-center justify-end px-3 pb-4",
              "bg-gradient-to-t from-black/90 via-black/20 to-transparent",
              "opacity-0 transition-opacity duration-200 group-hover:opacity-100",
              inProgress && "opacity-100",
            )}
          >
            {inProgress ? (
              <ProgressOverlay
                pct={pct}
                downloadedBytes={session?.downloadedBytes ?? 0}
                totalBytes={session?.totalBytes ?? 0}
                state={session?.state ?? "downloading"}
              />
            ) : hideHoverOverlay ? null : (
              <span className="text-[11px] font-semibold text-white drop-shadow">
                {isInstalled ? "Details · Play" : "Details · Install"}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Inline progress overlay ───────────────────────────────────────────────────

interface ProgressOverlayProps {
  pct: number;
  downloadedBytes: number;
  totalBytes: number;
  state: string;
}

function ProgressOverlay({ pct, downloadedBytes, totalBytes, state }: ProgressOverlayProps) {
  const isPaused = state === "paused";
  const isError = state === "error";
  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isError ? "bg-red-500" : isPaused ? "bg-white/40" : "bg-[#3a67f0]",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-[10px] text-white/70">
        {isError
          ? "Error — click to retry"
          : isPaused
            ? "Paused"
            : `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`}
      </span>
    </div>
  );
}
