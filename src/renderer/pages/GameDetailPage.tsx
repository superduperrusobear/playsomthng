import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { useResolvedGame } from "../hooks/useResolvedGame";
import { useGamePreviewStore } from "../store/gamePreview.store";
import type { CardOrigin } from "../store/gamePreview.store";
import { useLocalLibraryFile, useSaveLocalLibraryFile } from "../hooks/useLocalLibraryFile";
import {
  useInstallSession,
  useLaunchGame,
  useStopGame,
  useUninstallGame,
  useVerifyInstall,
  useOpenInstallFolder,
  useSetLaunchOverride,
  useInstallProgress,
  usePauseInstall,
  useResumeInstall,
  useCancelInstall,
  useLaunchCandidatesList,
} from "../hooks/useInstall";
import { useCatalogMeta } from "../hooks/useCatalogMeta";
import { usePlaytime } from "../hooks/usePlaytime";
import { InstallModal } from "../components/install/InstallModal";
import { GameScreenshotsSection } from "../components/game/GameScreenshotsSection";
import { formatBytes } from "../lib/formatBytes";
import { platformLabel, emulatorLabel } from "../lib/platformIcons";
import { preferHigherResImageUrl, resolveStoreCoverImage } from "../lib/storeGame";
import { cn } from "../lib/cn";
import { IpcChannel, type SystemSpec, type InstallProgressEvent, type LocalLibraryFile, type LocalLibraryGameEntry } from "@shared/schemas";
import { useSessionContext } from "../hooks/useSessionContext";
import { LaunchOptionsPanel } from "../components/game/detail/LaunchOptionsPanel";
import { CompatibilityPanel } from "../components/game/detail/CompatibilityPanel";
import { invoke } from "../lib/ipc";

import arrowPrev from "../assets/icons/arrow-prev-svgrepo-com.svg";

export function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const storeState = useGamePreviewStore();
  const { data: resolvedGame, isLoading, isOwnGame } = useResolvedGame(id);

  const frozenOriginRef = useRef(storeState.origin);

  const game =
    resolvedGame ?? (storeState.game?.id === id ? storeState.game : undefined);
  /** Store-seeded preview is never an “own” install until resolved data arrives. */
  const isOwnGameEffective =
    resolvedGame != null ? isOwnGame : storeState.game?.id === id ? false : isOwnGame;

  useEffect(() => {
    if (resolvedGame?.id === id) {
      useGamePreviewStore.getState().clear();
    }
  }, [resolvedGame, id]);

  if (isLoading && !game) {
    return (
      <div className="flex h-full items-center justify-center bg-transparent">
        <p className="text-[12px] text-[#555]">Loading…</p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-transparent">
        <p className="text-[13px] text-[#666]">Game not found</p>
        <button onClick={() => navigate(-1)} className="text-[12px] text-[#888] transition-colors hover:text-white">
          Go back
        </button>
      </div>
    );
  }


  return (
    <GameDetailContent
      game={game}
      isOwnGame={isOwnGameEffective}
      onBack={() => navigate(-1)}
      origin={frozenOriginRef.current}
    />
  );
}

function GameDetailContent({
  game,
  isOwnGame,
  onBack,
  origin,
}: {
  game: NonNullable<ReturnType<typeof useResolvedGame>["data"]>;
  isOwnGame: boolean;
  onBack: () => void;
  origin: CardOrigin | null;
}) {
  // ── Library State ──
  const { data: libraryFile } = useLocalLibraryFile();
  const saveLibrary = useSaveLocalLibraryFile();
  const libraryEntry = useMemo(
    () => libraryFile?.games.find((g) => g.gameId === game.id),
    [libraryFile, game.id]
  );
  const inLibrary = !!libraryEntry;

  const { data: sessionContext } = useSessionContext();
  const platformFamily = sessionContext?.paths.platformFamily ?? "other";
  const [sidePanel, setSidePanel] = useState<null | "launch" | "compat">(null);

  const updateLibraryGame = useCallback(
    async (patch: Partial<LocalLibraryGameEntry>) => {
      const current = libraryFile ?? { version: 1, games: [] };
      const idx = current.games.findIndex((g) => g.gameId === game.id);
      if (idx < 0) return;
      const games = [...current.games];
      games[idx] = { ...games[idx], ...patch };
      await saveLibrary.mutateAsync({ ...current, games });
    },
    [libraryFile, game.id, saveLibrary]
  );

  const patchLaunchFlags = useCallback(
    (patch: Partial<NonNullable<LocalLibraryGameEntry["launchFlags"]>>) => {
      const prev = libraryEntry?.launchFlags ?? {};
      void updateLibraryGame({ launchFlags: { ...prev, ...patch } });
    },
    [libraryEntry?.launchFlags, updateLibraryGame]
  );

  const patchCompat = useCallback(
    (patch: { steamAppId?: string | null; protonVersion?: string | null }) => {
      void updateLibraryGame(patch);
    },
    [updateLibraryGame]
  );

  const toggleLibrary = async () => {
    const current: LocalLibraryFile = libraryFile ?? { version: 1, games: [] };
    if (inLibrary) {
      // Remove from library
      await saveLibrary.mutateAsync({
        ...current,
        games: current.games.filter((g) => g.gameId !== game.id),
      });
    } else {
      // Add to library
      await saveLibrary.mutateAsync({
        ...current,
        games: [
          ...current.games,
          {
            gameId: game.id,
            installed: false,
            installPath: null,
            installedVersion: null,
            downloadState: "not_installed",
              launchOverride: null,
            lastPlayedAt: null,
            pinned: false,
            source: "server",
          },
        ],
      });
    }
  };

  // ── Catalog metadata (server games only) ──
  const { data: catalogMeta } = useCatalogMeta(isOwnGame ? undefined : game.slug);

  const execPathPreview = useMemo(
    () => resolveExecPathPreview(isOwnGame, libraryEntry, catalogMeta?.launchTarget ?? null),
    [isOwnGame, libraryEntry, catalogMeta?.launchTarget]
  );

  // ── Install / Download State ──
  const { data: sessionData } = useInstallSession(game.id);
  const [session, setSession] = useState(sessionData ?? null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchStatus, setLaunchStatus] = useState<"launching" | "launched" | null>(null);
  const [lastPlayedOverride, setLastPlayedOverride] = useState<Date | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const launch = useLaunchGame();
  const stopGame = useStopGame();
  const verify = useVerifyInstall();
  const openFolder = useOpenInstallFolder();
  const setLaunchOverride = useSetLaunchOverride();
  const [verifying, setVerifying] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideValue, setOverrideValue] = useState<string>("");
  const [showOwnExeModal, setShowOwnExeModal] = useState(false);
  const [ownExeValue, setOwnExeValue] = useState<string>("");
  const [ownBrowseBusy, setOwnBrowseBusy] = useState(false);
  const currentLaunchTarget = libraryEntry?.launchOverride ?? catalogMeta?.launchTarget ?? "";

  const serverInstallPathForScan = !isOwnGame ? libraryEntry?.installPath?.trim() ?? null : null;
  const { data: launchCandidates, isFetching: launchCandidatesLoading } = useLaunchCandidatesList(
    serverInstallPathForScan,
    showOverrideModal && !isOwnGame,
  );
  const launchCandidatePaths = launchCandidates?.relativePaths ?? [];

  const handlePlay = () => {
    setLaunchError(null);
    setLaunchStatus("launching");
    setSettingsMessage(null);

    if (isOwnGame || libraryEntry?.source === "own") {
      const exe =
        libraryEntry?.customLaunchPath ??
        libraryEntry?.installPath ??
        null;
      if (!exe?.trim()) {
        setLaunchError("No executable path set. Add a path when adding the game, or edit user-library.json.");
        setLaunchStatus(null);
        return;
      }
      launch.mutate(
        { gameId: game.id, absoluteExePath: exe.trim() },
        {
          onSuccess: (res) => {
            if (!res.ok && res.error) {
              setLaunchError(res.error);
              setLaunchStatus(null);
            } else {
              setLaunchStatus("launched");
              setIsRunning(true);
              setLastPlayedOverride(new Date());
              setTimeout(() => setLaunchStatus(null), 1500);
            }
          },
          onError: (err) => {
            setLaunchError(err.message);
            setLaunchStatus(null);
          },
        },
      );
      return;
    }

    const installPath = libraryEntry?.installPath ?? null;
    const launchTarget = libraryEntry?.launchOverride ?? catalogMeta?.launchTarget ?? null;
    if (!installPath) {
      setLaunchError("Install path not found in library. Re-install the game.");
      setLaunchStatus(null);
      return;
    }
    if (!launchTarget) {
      setLaunchError("No launch target set. Open the admin editor for this game and set the executable.");
      setLaunchStatus(null);
      return;
    }
    launch.mutate(
      { gameId: game.id, installPath, launchTarget },
      {
        onSuccess: (res) => {
          if (!res.ok && res.error) {
            setLaunchError(res.error);
            setLaunchStatus(null);
          } else {
            setLaunchStatus("launched");
            setIsRunning(true);
            setLastPlayedOverride(new Date());
            setTimeout(() => setLaunchStatus(null), 1500);
          }
        },
        onError: (err) => {
          setLaunchError(err.message);
          setLaunchStatus(null);
        },
      },
    );
  };

  const handleOpenFolder = () => {
    setSettingsMessage(null);
    openFolder.mutate(game.id, {
      onSuccess: (res) => {
        if (!res.ok && res.error) setSettingsMessage(res.error);
      },
      onError: (err) => setSettingsMessage(err.message),
    });
    setShowSettings(false);
  };

  const handleVerify = () => {
    setSettingsMessage(null);
    setVerifying(true);
    verify.mutate(game.id, {
      onSuccess: (res) => {
        if (!res.ok) {
          setSettingsMessage(res.error ?? "Verification failed");
        } else if (res.missing === 0 && res.mismatched === 0) {
          setSettingsMessage("All files verified");
        } else {
          setSettingsMessage(`Verify: missing ${res.missing}, mismatched ${res.mismatched}`);
        }
        setVerifying(false);
      },
      onError: (err) => {
        setSettingsMessage(err.message);
        setVerifying(false);
      },
    });
    setShowSettings(false);
  };

  const handleRemoveFromLibrary = async () => {
    if (!inLibrary) return;
    await toggleLibrary();
    setShowSettings(false);
  };

  const handleSaveOverride = () => {
    setSettingsMessage(null);
    setLaunchStatus(null);
    setShowOverrideModal(false);
    const trimmed = overrideValue.trim();
    setLaunchOverride.mutate(
      { gameId: game.id, launchTarget: trimmed.length ? trimmed : null },
      {
        onSuccess: (res) => {
          if (!res.ok && res.error) setSettingsMessage(res.error);
        },
        onError: (err) => setSettingsMessage(err.message),
      },
    );
  };

  const handleBrowseOwnExecutable = async () => {
    setOwnBrowseBusy(true);
    try {
      const r = await invoke<{ path: string | null }>(IpcChannel.DIALOG_PICK_EXECUTABLE);
      if (r.path) setOwnExeValue(r.path);
    } finally {
      setOwnBrowseBusy(false);
    }
  };

  const handleSaveOwnExecutable = () => {
    const trimmed = ownExeValue.trim();
    void updateLibraryGame({ customLaunchPath: trimmed.length ? trimmed : undefined });
    setShowOwnExeModal(false);
  };

  useEffect(() => {
    setSession(sessionData ?? null);
  }, [sessionData]);

  const isActiveDownloadDetail =
    sessionData != null &&
    (sessionData.state === "downloading" ||
      sessionData.state === "paused" ||
      sessionData.state === "error");

  useInstallProgress(
    isActiveDownloadDetail ? game.id : null,
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
          : prev
      );
    }, [])
  );

  useEffect(() => {
    const off = window.api.on("game:exit", (payload: any) => {
      if ((payload as any)?.gameId === game.id) {
        setIsRunning(false);
      }
    });
    return off;
  }, [game.id]);

  const pause = usePauseInstall();
  const resume = useResumeInstall();
  const cancel = useCancelInstall();
  const uninstall = useUninstallGame();
  const [uninstallConfirm, setUninstallConfirm] = useState(false);

  const isInstalled = libraryEntry?.installed || session?.state === "completed";
  const isDownloading = session?.state === "downloading";
  const isPaused = session?.state === "paused";
  const isError = session?.state === "error";
  const inProgress = isDownloading || isPaused || isError;

  const pct = session && session.totalBytes > 0 ? (session.downloadedBytes / session.totalBytes) * 100 : 0;

  // ── Playtime State ──
  const { data: playtimeData } = usePlaytime();
  const playtimeEntry = playtimeData?.find((p) => p.gameId === game.id);
  const playHours = playtimeEntry ? (playtimeEntry.totalMinutes / 60).toFixed(1) : "0.0";
  const lastPlayedDate = lastPlayedOverride
    ? lastPlayedOverride
    : playtimeEntry?.lastPlayedAt
      ? new Date(playtimeEntry.lastPlayedAt)
      : null;
  const lastPlayed = lastPlayedDate
    ? lastPlayedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Never";

  // ── Rendering Data ──
  const banner = preferHigherResImageUrl(game.bannerImage);
  const cover = resolveStoreCoverImage(game);
  const screenshots = game.screenshots ?? [];

  // ── Cover art FLIP: travels from card position → left column ──
  const coverWrapRef = useRef<HTMLDivElement>(null);
  // Freeze origin at mount so re-renders don't affect the animation
  const frozenCardOriginRef = useRef(origin);

  useLayoutEffect(() => {
    const el = coverWrapRef.current;
    const o  = frozenCardOriginRef.current;
    if (!o || !el) return;
    const cr = el.getBoundingClientRect();
    if (!cr.width || !cr.height) return;
    const dx = o.x - cr.left;
    const dy = o.y - cr.top;
    const sx = o.w / cr.width;
    const sy = o.h / cr.height;
    // Jump the cover to where the card was (no transition)
    el.style.transition = "none";
    el.style.transformOrigin = "top left";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    // Force browser to register the initial position before animating
    void el.offsetWidth;
    // Animate cover to its natural position in the layout
    el.style.transition = "transform 0.52s cubic-bezier(0.22, 1, 0.36, 1)";
    el.style.transform = "translate(0,0) scale(1,1)";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="-mt-8 flex h-full min-h-0 flex-col bg-transparent">
      {/* Bleed hero under the frameless chrome (matches App.tsx h-8 spacer + WindowChrome) */}

      {/* ── Banner - blends into page with soft edges ── */}
      <div
        className="relative w-full shrink-0 overflow-hidden"
        style={{
          height: "clamp(180px, 28vh, 260px)",
          animation: "gdFadeIn 0.5s ease-out both",
          maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
        }}
      >
        {banner ? (
          <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" draggable={false} />
        ) : cover ? (
          <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-15 blur-md scale-105" draggable={false} />
        ) : null}
        {/* Soft multi-gradient blend */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-black/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0a0a]/80" />

        {/* Back button — pt aligns with window drag region (h-8) */}
        <div className="absolute top-0 left-0 z-10 p-5 pt-8">
          <button
            onClick={onBack}
            className="flex items-center justify-center h-8 w-8 rounded-full bg-black/40 backdrop-blur-md text-white transition hover:bg-black/60"
            aria-label="Go back"
          >
            <img src={arrowPrev} alt="" className="h-4 w-4 invert opacity-80" draggable={false} />
          </button>
        </div>

        {/* Title — aligned to content max-width */}
        <div className="absolute bottom-6 inset-x-0 z-10">
          <div className="mx-auto px-6" style={{ maxWidth: 1280 }}>
            <h1
              className="font-title text-[clamp(2rem,5vw,4rem)] leading-none tracking-wider text-white drop-shadow-[0_4px_32px_rgba(0,0,0,0.9)]"
              style={{ animation: "storeTitleIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.08s both" }}
            >
              {game.title}
            </h1>
          </div>
        </div>
      </div>

      {/* ── Scroll + details sidebar + optional slide-in panel ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div
            className="mx-auto flex items-start gap-6 px-6 pt-5 pb-8"
            style={{ maxWidth: 1280 }}
          >
            {/* LEFT: Cover art — the store card, landed. Same border, glass, reflection,
                and ambient glow so the click reads as the object arriving, not a page swap. */}
            <div className="relative shrink-0" style={{ width: "clamp(160px, 20vw, 260px)" }}>
              {/* Ambient light fades in after the card lands (glow stays put during the flight) */}
              {cover && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-8"
                  style={{ animation: "gdFadeIn 0.7s 0.45s both" }}
                >
                  <img
                    src={cover}
                    alt=""
                    draggable={false}
                    className="h-full w-full rounded-[36px] object-cover"
                    style={{
                      filter: "blur(44px) saturate(1.6) brightness(0.8)",
                      opacity: 0.45,
                      WebkitMaskImage:
                        "radial-gradient(ellipse 65% 65% at center, #000 30%, transparent 75%)",
                      maskImage:
                        "radial-gradient(ellipse 65% 65% at center, #000 30%, transparent 75%)",
                    }}
                  />
                </div>
              )}

              <div
                ref={coverWrapRef}
                className="relative overflow-hidden rounded-xl border border-white/15 bg-[#101010] card-shadow-store-selected"
                style={
                  {
                    aspectRatio: "3 / 4",
                    transformOrigin: "top left",
                    WebkitBoxReflect:
                      "below 12px linear-gradient(to bottom, transparent 78%, rgba(0,0,0,0.28) 100%)",
                  } as React.CSSProperties
                }
              >
                {cover ? (
                  <img
                    src={cover}
                    alt={game.title}
                    className="block h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="h-full w-full bg-[#1a1a1a]" />
                )}
                {/* Glass edge — same finish as the store card */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl"
                  style={{
                    background:
                      "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 28%, transparent 55%, rgba(0,0,0,0.12) 100%)",
                    mixBlendMode: "overlay",
                  }}
                />
              </div>
            </div>

            {/* CENTER: description + screenshots + sysreqs */}
            <div className="flex-1 min-w-0 space-y-6" style={{ animation: "gdFadeIn 0.5s 0.16s both" }}>
              {game.description && (
                <section>
                  <Label>About this game</Label>
                  <p className="mt-3 text-[14px] leading-[1.8] text-[#a8a8b8] whitespace-pre-wrap">{game.description}</p>
                </section>
              )}

              {game.specialInstructions && (
                <section>
                  <Label>Before you play</Label>
                  <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
                    <p className="text-[13px] leading-[1.7] text-amber-100/80 whitespace-pre-wrap">
                      {game.specialInstructions}
                    </p>
                  </div>
                </section>
              )}

              <GameScreenshotsSection screenshots={screenshots} gameTitle={game.title} />

              {(game.systemRequirements?.minimum || game.systemRequirements?.recommended) && (
                <section>
                  <Label>System Requirements</Label>
                  <div className="grid grid-cols-2 gap-6 mt-4">
                    {game.systemRequirements.minimum && <SpecBlock title="Minimum" spec={game.systemRequirements.minimum} />}
                    {game.systemRequirements.recommended && <SpecBlock title="Recommended" spec={game.systemRequirements.recommended} />}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Details column (pushed when side panel opens) */}
        <div
          className="shrink-0 space-y-6 border-l border-white/5 px-4 pt-5 pb-8 text-right"
          style={{ width: "clamp(140px, 13vw, 200px)", animation: "gdFadeIn 0.5s 0.22s both" }}
        >
          <section>
            <LabelRight>Details</LabelRight>
            <div className="space-y-4 mt-4">
              <RowRight label="Developer" value={game.developer || "Unknown"} />
              <RowRight label="Publisher" value={game.publisher || "Unknown"} />
              <RowRight label="Release" value={game.releaseDate || "Unknown"} />
              <RowRight label="Platform" value={platformLabel(game.platform)} />
              {typeof game.sizeBytes === "number" && (
                <RowRight label="Size" value={formatBytes(game.sizeBytes)} />
              )}
            </div>
          </section>

          {game.emulator.required && (
            <section>
              <LabelRight>Emulator</LabelRight>
              <p className="mt-3 text-[13px] text-[#d0d0d0]">
                {emulatorLabel(game.emulator.emulator)}
                {game.emulator.emulatorVersion && <span className="text-[#777]"> · v{game.emulator.emulatorVersion}</span>}
              </p>
              {game.emulator.setupNotes && (
                <p className="mt-2 text-[12px] leading-relaxed text-[#888]">{game.emulator.setupNotes}</p>
              )}
            </section>
          )}

          {game.tags.length > 0 && (
            <section>
              <LabelRight>Tags</LabelRight>
              <div className="mt-3 flex flex-wrap justify-end gap-x-1 gap-y-1.5">
                {game.tags.map((tag, i) => (
                  <span key={tag} className="text-[11px] text-[#888]">
                    {tag}{i < game.tags.length - 1 && <span className="text-[#444] ml-1">·</span>}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        <div
          className={cn(
            "shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
            sidePanel ? "w-[min(380px,92vw)]" : "w-0"
          )}
        >
          {sidePanel === "launch" && (
            <LaunchOptionsPanel
              onClose={() => setSidePanel(null)}
              launchFlags={libraryEntry?.launchFlags}
              onPatchFlags={patchLaunchFlags}
              execPathPreview={execPathPreview}
              platformFamily={platformFamily}
              canPersist={inLibrary}
            />
          )}
          {sidePanel === "compat" && (
            <CompatibilityPanel
              onClose={() => setSidePanel(null)}
              platformFamily={platformFamily}
              canPersist={inLibrary}
              steamAppId={libraryEntry?.steamAppId}
              protonVersion={libraryEntry?.protonVersion}
              onPatch={patchCompat}
            />
          )}
        </div>
      </div>

      {/* ── Bottom action bar — same max-width as content ── */}
      <div
        className="relative z-20 shrink-0 border-t border-white/5"
        style={{ animation: "gdSlideUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.2s both" }}
      >
      <div className="mx-auto flex items-center gap-8 px-6 py-4" style={{ maxWidth: 1280 }}>
        {/* Main action group */}
        <div className="flex items-center gap-6">
          {isInstalled ? (
            isRunning ? (
              <button
                onClick={() => stopGame.mutate(game.id, { onSuccess: () => setIsRunning(false) })}
                disabled={stopGame.isPending}
                className="flex items-center gap-2 text-[15px] font-bold tracking-wider text-red-400 transition hover:text-red-300 disabled:opacity-60 uppercase"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" /></svg>
                Stop
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={launch.isPending || launchStatus === "launching"}
                className="flex items-center gap-2 text-[16px] font-bold tracking-wider text-[#4c9b45] transition hover:text-[#5cb854] disabled:opacity-60 uppercase"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 3l14 9-14 9V3z" />
                </svg>
                {launch.isPending || launchStatus === "launching" ? "Launching…" : "Play"}
              </button>
            )
          ) : inProgress ? (
            <div className="flex items-center gap-5">
              <span className="text-[13px] font-medium text-[#a0a0a0] uppercase tracking-wide">
                {isDownloading ? "Downloading" : isPaused ? "Paused" : isError ? "Error" : "Preparing"}
              </span>
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[#222]">
                <div
                  className={cn("h-full rounded-full transition-all duration-300", isError ? "bg-red-500" : isPaused ? "bg-[#777]" : "bg-[#4c9b45]")}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="flex gap-4">
                {isDownloading && <button onClick={() => pause.mutate(game.id)} className="text-[12px] text-[#888] hover:text-white transition">Pause</button>}
                {(isPaused || isError) && <button onClick={() => resume.mutate(game.id)} className="text-[12px] text-[#3a67f0] hover:text-[#6090ff] transition">Resume</button>}
                <button onClick={() => cancel.mutate(game.id)} className="text-[12px] text-[#888] hover:text-red-400 transition">Cancel</button>
              </div>
            </div>
          ) : inLibrary ? (
            <button
              onClick={() => setShowInstallModal(true)}
              className="flex items-center gap-2 text-[16px] font-bold tracking-wider text-[#4c9b45] transition hover:text-[#5cb854] uppercase"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v13M7 11l5 5 5-5" />
                <path d="M4 20h16" />
              </svg>
              Install
            </button>
          ) : (
            <button
              onClick={toggleLibrary}
              disabled={saveLibrary.isPending}
              className="text-[15px] font-medium tracking-wide text-[#999] transition hover:text-white disabled:opacity-50"
            >
              + Add to Library
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-white/10" />

        {/* Stats group */}
        <div className="flex gap-8">
          <div className="flex flex-col items-start">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555]">Last Played</span>
            <span className="text-[14px] text-[#aaa] mt-0.5">{lastPlayed}</span>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555]">Play Time</span>
            <span className="text-[14px] text-[#aaa] mt-0.5">{playHours} hrs</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Settings gear - floating */}
        <div className="relative">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] transition hover:bg-white/8 hover:text-white"
            title="More options"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {showSettings && (
            <div className="absolute right-0 bottom-full mb-2 w-52 rounded-xl bg-[#1a1a1a]/95 backdrop-blur-md shadow-2xl z-30 overflow-hidden">
              <button
                onClick={() => {
                  setShowSettings(false);
                  setSidePanel("launch");
                }}
                className="w-full px-4 py-2.5 text-left text-[12px] text-[#ddd] hover:bg-white/5 transition"
              >
                Launch options
              </button>
              <button
                onClick={() => {
                  setShowSettings(false);
                  setSidePanel("compat");
                }}
                className="w-full px-4 py-2.5 text-left text-[12px] text-[#ddd] hover:bg-white/5 transition"
              >
                Compatibility
              </button>
              <div className="h-px bg-white/10 mx-3" />
              <button onClick={handleOpenFolder} className="w-full px-4 py-2.5 text-left text-[12px] text-[#ddd] hover:bg-white/5 transition">
                Browse local files
              </button>
              {!isOwnGame && (
                <button onClick={handleVerify} disabled={verifying} className="w-full px-4 py-2.5 text-left text-[12px] text-[#ddd] hover:bg-white/5 transition disabled:opacity-50">
                  {verifying ? "Verifying…" : "Verify game files"}
                </button>
              )}
              {!isOwnGame && (
                <>
                  <div className="h-px bg-white/10 mx-3" />
                  <div className="px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[#777]">Launch executable</div>
                  <div className="px-4 pb-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="launchTarget"
                        checked={!libraryEntry?.launchOverride}
                        onChange={() => setLaunchOverride.mutate({ gameId: game.id, launchTarget: null })}
                      />
                      <div className="text-[11px] text-[#bbb] truncate" title={catalogMeta?.launchTarget ?? "Not set"}>
                        {catalogMeta?.launchTarget ?? "Catalog default (not set)"}
                      </div>
                    </div>
                    {libraryEntry?.launchOverride && (
                      <div className="flex items-center gap-2">
                        <input type="radio" name="launchTarget" checked={!!libraryEntry.launchOverride} onChange={() => {}} />
                        <div className="text-[11px] text-[#bbb] truncate" title={libraryEntry.launchOverride ?? ""}>
                          {libraryEntry.launchOverride}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => { setOverrideValue(currentLaunchTarget); setShowOverrideModal(true); setShowSettings(false); }}
                      className="flex items-center gap-1 text-[11px] text-[#3a67f0] hover:text-white transition"
                    >
                      <span>+</span> Add / edit
                    </button>
                  </div>
                </>
              )}
              {isOwnGame && (libraryEntry?.customLaunchPath || libraryEntry?.installPath) && (
                <>
                  <div className="h-px bg-white/10 mx-3" />
                  <div className="px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[#777]">Executable</div>
                  <div className="px-4 text-[11px] text-[#888] break-all" title={libraryEntry?.customLaunchPath ?? libraryEntry?.installPath ?? ""}>
                    {libraryEntry?.customLaunchPath ?? libraryEntry?.installPath}
                  </div>
                  <div className="px-4 pb-3">
                    <button
                      onClick={() => {
                        setOwnExeValue((libraryEntry?.customLaunchPath ?? libraryEntry?.installPath ?? "").trim());
                        setShowOwnExeModal(true);
                        setShowSettings(false);
                      }}
                      className="flex items-center gap-1 text-[11px] text-[#3a67f0] hover:text-white transition"
                    >
                      <span>+</span> Add / edit
                    </button>
                  </div>
                </>
              )}
              {isInstalled && (
                <button onClick={() => setUninstallConfirm(true)} className="w-full px-4 py-2.5 text-left text-[12px] text-red-400 hover:bg-white/5 transition">
                  Uninstall
                </button>
              )}
              {inLibrary && (
                <button onClick={handleRemoveFromLibrary} className="w-full px-4 py-2.5 text-left text-[12px] text-[#ddd] hover:bg-white/5 transition">
                  Remove from library
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ── Status messages ── FLOATING, no borders */}
      {(launch.isPending || launchStatus === "launching") && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-blue-900/40 backdrop-blur-sm text-[11px] text-[#9bbcff]">Launching game…</div>
      )}
      {launchError && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-red-950/80 backdrop-blur-md shadow-lg flex items-center gap-3 max-w-md">
          <p className="text-[11px] text-red-300">{launchError}</p>
          <button onClick={() => setLaunchError(null)} className="text-[11px] text-red-400 hover:text-white">✕</button>
        </div>
      )}
      {settingsMessage && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-[#1a1a1a]/90 backdrop-blur-md shadow-lg flex items-center gap-3 max-w-md">
          <p className="text-[11px] text-[#ccc]">{settingsMessage}</p>
          <button onClick={() => setSettingsMessage(null)} className="text-[11px] text-[#888] hover:text-white">✕</button>
        </div>
      )}

      {/* ── Modals ── */}
      {showInstallModal && (
        <InstallModal game={{ ...game, coverImage: cover, bannerImage: banner, screenshots }} onClose={() => setShowInstallModal(false)} />
      )}

      {uninstallConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[320px] rounded-lg border border-[#2d2d2d] bg-[#111] p-5 shadow-2xl">
            <h3 className="text-[14px] font-semibold text-white mb-2">Uninstall this game?</h3>
            <p className="text-[12px] text-[#aaa] mb-4">This deletes installed files. You can re-download later.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setUninstallConfirm(false)} className="rounded bg-[#222] px-3 py-1.5 text-[12px] text-[#ccc] hover:bg-[#2e2e2e]">Cancel</button>
              <button
                onClick={async () => { await uninstall.mutateAsync(game.id); setUninstallConfirm(false); setIsRunning(false); }}
                disabled={uninstall.isPending}
                className="rounded bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {uninstall.isPending ? "Uninstalling…" : "Yes, uninstall"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[min(440px,92vw)] rounded-lg border border-[#2d2d2d] bg-[#111] p-5 shadow-2xl">
            <h3 className="text-[14px] font-semibold text-white mb-2">Set launch executable</h3>
            <p className="text-[12px] text-[#aaa] mb-3">
              Choose a file under your install folder, or type a relative path (e.g.{" "}
              <code className="text-[#ccc]">Game.exe</code> or <code className="text-[#ccc]">bin/Game.exe</code>). Leave blank
              to use the catalog default.
            </p>
            {serverInstallPathForScan ? (
              <div className="mb-3 space-y-1">
                <label className="block text-[11px] text-[#888]">Found in install folder</label>
                <select
                  value={
                    launchCandidatePaths.includes(overrideValue.trim().replace(/\\/g, "/"))
                      ? overrideValue.trim().replace(/\\/g, "/")
                      : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setOverrideValue(v);
                  }}
                  disabled={launchCandidatesLoading}
                  className="w-full rounded border border-[#2d2d2d] bg-[#0f0f0f] px-3 py-2 text-[12px] text-white outline-none focus:border-[#3a67f0] disabled:opacity-60"
                >
                  <option value="">
                    {launchCandidatesLoading ? "Scanning install folder…" : "Pick an executable…"}
                  </option>
                  {launchCandidatePaths.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {launchCandidates?.error && (
                  <p className="text-[10px] text-amber-500/90">{launchCandidates.error}</p>
                )}
                {!launchCandidatesLoading && launchCandidatePaths.length === 0 && !launchCandidates?.error && (
                  <p className="text-[10px] text-[#555]">No matching executables found — enter a path below.</p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-amber-600/90 mb-3">No install path on record. Re-install or verify the game first.</p>
            )}
            <label className="block text-[11px] text-[#888] mb-1">Relative path (manual)</label>
            <input
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              className="w-full rounded border border-[#2d2d2d] bg-[#0f0f0f] px-3 py-2 text-[12px] text-white outline-none focus:border-[#3a67f0]"
              autoFocus
              spellCheck={false}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowOverrideModal(false)} className="rounded bg-[#222] px-3 py-1.5 text-[12px] text-[#ccc] hover:bg-[#2e2e2e]">Cancel</button>
              <button onClick={handleSaveOverride} disabled={setLaunchOverride.isPending} className="rounded bg-[#2563eb] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-60">
                {setLaunchOverride.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOwnExeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[420px] rounded-lg border border-[#2d2d2d] bg-[#111] p-5 shadow-2xl">
            <h3 className="text-[14px] font-semibold text-white mb-2">Set executable path</h3>
            <p className="text-[12px] text-[#aaa] mb-3">
              Set the full executable path for this local game.
            </p>
            <div className="flex gap-2">
              <input
                value={ownExeValue}
                onChange={(e) => setOwnExeValue(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[#2d2d2d] bg-[#0f0f0f] px-3 py-2 text-[12px] text-white outline-none focus:border-[#3a67f0]"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleBrowseOwnExecutable()}
                disabled={ownBrowseBusy}
                className="shrink-0 rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-[11px] font-semibold text-[#ddd] transition hover:border-[#3a3a3a] hover:bg-[#222] hover:text-white disabled:opacity-50"
              >
                {ownBrowseBusy ? "…" : "Browse…"}
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowOwnExeModal(false)} className="rounded bg-[#222] px-3 py-1.5 text-[12px] text-[#ccc] hover:bg-[#2e2e2e]">Cancel</button>
              <button onClick={handleSaveOwnExecutable} className="rounded bg-[#2563eb] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#1d4ed8]">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function resolveExecPathPreview(
  isOwnGame: boolean,
  libraryEntry: LocalLibraryGameEntry | undefined,
  catalogLaunchTarget: string | null | undefined
): string {
  if (isOwnGame || libraryEntry?.source === "own") {
    return (libraryEntry?.customLaunchPath ?? libraryEntry?.installPath ?? "").trim();
  }
  const installPath = libraryEntry?.installPath?.trim();
  const lt = (libraryEntry?.launchOverride ?? catalogLaunchTarget ?? "").trim();
  if (!installPath || !lt) return "";
  const baseName = installPath.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  const segments = lt.replace(/\\/g, "/").split("/").filter(Boolean);
  const segs =
    segments.length > 0 && segments[0].toLowerCase() === baseName.toLowerCase() ? segments.slice(1) : segments;
  const ip = installPath.replace(/[/\\]+$/, "");
  const sep = installPath.includes("\\") ? "\\" : "/";
  return [ip, ...segs].join(sep);
}

// ── Shared Subcomponents ──

function Label({ children }: { children: string }) {
  return (
    <h3 className="font-title text-[16px] tracking-[0.18em] text-white/90 uppercase">
      {children}
    </h3>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[13px] leading-snug">
      <span className="text-[#666]">{label}</span>
      <span className="text-right font-medium text-[#ccc]">{value}</span>
    </div>
  );
}

// Right-aligned versions for the details panel
function LabelRight({ children }: { children: string }) {
  return (
    <h3 className="font-title text-[14px] tracking-[0.15em] text-white/80 text-right uppercase">
      {children}
    </h3>
  );
}

function RowRight({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <span className="text-[14px] text-[#bbb] block leading-tight">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-[#666] mt-1 block">{label}</span>
    </div>
  );
}

function SpecBlock({ title, spec }: { title: string; spec: SystemSpec }) {
  const hasContent = spec.os || spec.cpu || spec.gpu || spec.ram || spec.storage;
  if (!hasContent) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#666]">{title}</p>
      <div className="space-y-2">
        {spec.os && <Row label="OS" value={spec.os} />}
        {spec.cpu && <Row label="CPU" value={spec.cpu} />}
        {spec.gpu && <Row label="GPU" value={spec.gpu} />}
        {spec.ram && <Row label="RAM" value={spec.ram} />}
        {spec.storage && <Row label="Storage" value={spec.storage} />}
        {spec.notes && <p className="mt-3 text-[11px] italic text-[#555]">{spec.notes}</p>}
      </div>
    </div>
  );
}








