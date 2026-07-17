/**
 * Compact download progress bar shown inside a library card when a game
 * is actively being installed / paused / errored.
 */

import { useCallback } from "react";
import type { InstallSession } from "@shared/schemas";
import { usePauseInstall, useResumeInstall, useCancelInstall } from "../../hooks/useInstall";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/cn";

interface DownloadProgressProps {
  session: InstallSession;
  compact?: boolean;
}

export function DownloadProgress({ session, compact = false }: DownloadProgressProps) {
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();

  const pct = session.totalBytes > 0 ? (session.downloadedBytes / session.totalBytes) * 100 : 0;

  const handlePause = useCallback(() => pause.mutate(session.gameId), [pause, session.gameId]);
  const handleResume = useCallback(() => resume.mutate(session.gameId), [resume, session.gameId]);
  const handleCancel = useCallback(() => cancel.mutate(session.gameId), [cancel, session.gameId]);

  const isActive = session.state === "downloading";
  const isPaused = session.state === "paused";
  const isError = session.state === "error";
  const isDone = session.state === "completed";

  if (isDone) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", compact ? "" : "mt-2")}>
      {/* Bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#222]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            isError ? "bg-red-500" : isPaused ? "bg-[#555]" : "bg-[#3a67f0]",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>

      {/* Text row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#666]">
          {isError
            ? "Error"
            : isPaused
              ? `Paused — ${formatBytes(session.downloadedBytes)} / ${formatBytes(session.totalBytes)}`
              : isDone
                ? "Installed"
                : `${formatBytes(session.downloadedBytes)} / ${formatBytes(session.totalBytes)}`}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              onClick={handlePause}
              className="text-[10px] text-[#666] transition hover:text-white"
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={handleResume}
              className="text-[10px] text-[#3a67f0] transition hover:text-[#6090ff]"
            >
              Resume
            </button>
          )}
          {isError && (
            <button
              onClick={handleResume}
              className="text-[10px] text-[#e05252] transition hover:text-red-400"
            >
              Retry
            </button>
          )}
          <button
            onClick={handleCancel}
            className="text-[10px] text-[#555] transition hover:text-red-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
