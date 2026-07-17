/**
 * Downloads page — active installs with cover, elapsed time, and live speed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallProgressEvent, InstallSession } from "@shared/schemas";
import {
  useInstallList,
  usePauseInstall,
  useResumeInstall,
  useCancelInstall,
  useInstallProgress,
  useClearCompletedDownloads,
} from "../hooks/useInstall";
import { useGame } from "../hooks/useGame";
import { formatBytes } from "../lib/formatBytes";
import { resolveStoreCoverImage } from "../lib/storeGame";
import { PageShell } from "../components/layout/PageShell";
import { cn } from "../lib/cn";

export function DownloadsPage() {
  const { data: sessions = [], isLoading, refetch } = useInstallList();
  const clearCompleted = useClearCompletedDownloads();

  useEffect(() => {
    const hasActive = sessions.some((s) => s.state === "downloading");
    if (!hasActive) return;
    const t = setInterval(() => void refetch(), 2000);
    return () => clearInterval(t);
  }, [sessions, refetch]);

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-[#ececec] sm:text-[24px]">Downloads</h1>
            <p className="mt-1 text-[13px] text-[#7a7a7a]">Active and recent installs</p>
          </div>
          {sessions.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-[#8a8a8a]">
                {sessions.filter((s) => s.state === "downloading").length} active
                {sessions.some((s) => s.state === "completed") && (
                  <>
                    {" "}
                    · {sessions.filter((s) => s.state === "completed").length} done
                  </>
                )}
              </span>
              {sessions.some((s) => s.state === "completed") && (
                <button
                  type="button"
                  onClick={() => clearCompleted.mutate()}
                  disabled={clearCompleted.isPending}
                  className="rounded-lg border border-[#333] px-3 py-1.5 text-[13px] font-medium text-[#c0c0c0] transition hover:border-[#4a4a4a] hover:text-white disabled:opacity-50"
                >
                  Clear completed
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col gap-4 pt-1">
              {[1, 2].map((i) => (
                <div key={i} className="h-[112px] animate-pulse rounded-xl bg-white/[0.04]" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <EmptyDownloads />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
              <div className="flex flex-col">
                {sessions
                  .slice()
                  .sort((a, b) => stateOrder(a.state) - stateOrder(b.state))
                  .map((session) => (
                    <DownloadRow key={session.gameId} initialSession={session} />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function DownloadRow({ initialSession }: { initialSession: InstallSession }) {
  const [session, setSession] = useState(initialSession);
  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();

  const { data: game } = useGame(session.gameId);
  const coverUrl = game ? resolveStoreCoverImage(game) : undefined;

  const [speedMib, setSpeedMib] = useState<number | null>(null);
  const lastSampleRef = useRef<{ t: number; bytes: number } | null>(null);

  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);

  const needsProgressListener =
    session.state === "downloading" || session.state === "paused" || session.state === "error";

  useInstallProgress(
    needsProgressListener ? session.gameId : null,
    useCallback((e: InstallProgressEvent) => {
      setSession((prev) => ({
        ...prev,
        state: e.state,
        downloadedBytes: e.downloadedBytes,
        totalBytes: e.totalBytes,
        error: e.error,
      }));
    }, []),
  );

  useEffect(() => {
    if (session.state !== "downloading") {
      setSpeedMib(null);
      lastSampleRef.current = null;
      return;
    }
    const now = Date.now();
    const last = lastSampleRef.current;
    if (!last) {
      lastSampleRef.current = { t: now, bytes: session.downloadedBytes };
      return;
    }
    const dt = (now - last.t) / 1000;
    if (dt >= 0.35) {
      const delta = session.downloadedBytes - last.bytes;
      if (delta >= 0 && dt > 0) {
        const bytesPerSec = delta / dt;
        setSpeedMib(bytesPerSec / (1024 * 1024));
      }
      lastSampleRef.current = { t: now, bytes: session.downloadedBytes };
    }
  }, [session.downloadedBytes, session.state]);

  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (session.state !== "downloading" && session.state !== "paused" && session.state !== "error") {
      return;
    }
    const start = session.createdAt;
    const tick = () => setElapsedSec(Math.max(0, Math.floor(Date.now() / 1000) - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session.state, session.createdAt]);

  const pct = session.totalBytes > 0 ? (session.downloadedBytes / session.totalBytes) * 100 : 0;
  const isActive = session.state === "downloading";
  const isPaused = session.state === "paused";
  const isError = session.state === "error";
  const isDone = session.state === "completed";

  const speedLabel =
    isActive && speedMib != null && speedMib >= 0.01 ? `${speedMib.toFixed(1)} MB/s` : isActive ? "…" : "—";

  return (
    <div
      className={cn(
        "flex items-center gap-6 border-b border-[#1c1c1c] py-7 last:border-b-0 sm:gap-8 sm:py-8",
        isDone && "opacity-90",
      )}
    >
      <div className="relative h-[96px] w-[68px] shrink-0 overflow-hidden rounded-lg bg-[#141414] ring-1 ring-white/[0.08] sm:h-[104px] sm:w-[74px]">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-[#4a4a4a]">
            {session.gameTitle.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-medium text-[#ececec] sm:text-[18px]">{session.gameTitle}</p>

        {isDone ? (
          <p className="mt-1.5 text-[14px] text-[#5faa6a]">Installed · {formatBytes(session.totalBytes)}</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-[14px] tabular-nums text-[#a0a0a0] sm:text-[15px]">
                {formatElapsed(elapsedSec)}
              </span>
              <span className="text-[14px] tabular-nums text-[#8aa6f0] sm:text-[15px]">{speedLabel}</span>
            </div>
            <div className="mt-3 h-1.5 w-full max-w-3xl overflow-hidden rounded-full bg-[#1a1a1a] sm:max-w-none">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  isError ? "bg-red-500/90" : isPaused ? "bg-[#3a3a3a]" : "bg-[#3a67f0]",
                )}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-[#6a6a6a] sm:text-[13px]">
              {formatBytes(session.downloadedBytes)} / {formatBytes(session.totalBytes)}
              {isPaused && <span className="ml-2 text-[#999]">Paused</span>}
              {isError && session.error && (
                <span className="ml-2 text-red-400/90">{session.error}</span>
              )}
            </p>
          </>
        )}
      </div>

      {!isDone && (
        <div className="flex shrink-0 flex-col items-end gap-2">
          {isActive && (
            <button
              type="button"
              onClick={() => pause.mutate(session.gameId)}
              className="text-[13px] font-medium text-[#949494] transition hover:text-white"
            >
              Pause
            </button>
          )}
          {(isPaused || isError) && (
            <button
              type="button"
              onClick={() => resume.mutate(session.gameId)}
              className="text-[13px] font-medium text-[#6a9cf0] transition hover:text-[#a8c4ff]"
            >
              {isError ? "Retry" : "Resume"}
            </button>
          )}
          <button
            type="button"
            onClick={() => cancel.mutate(session.gameId)}
            className="text-[13px] text-[#666] transition hover:text-red-400"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function EmptyDownloads() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="max-w-lg text-center">
        <p className="text-[22px] font-semibold tracking-tight text-[#e4e4e4] sm:text-[24px]">No downloads</p>
        <p className="mt-4 text-[15px] leading-relaxed text-[#949494] sm:text-[16px]">
          Install a game from your library to start. Active downloads show live speed and time here.
        </p>
      </div>
    </div>
  );
}

function formatElapsed(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s elapsed`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s}s elapsed`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m elapsed`;
}

function stateOrder(state: string): number {
  return { downloading: 0, paused: 1, error: 2, preflight: 3, completed: 4 }[state] ?? 5;
}
