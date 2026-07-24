import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStoreGames } from "../hooks/useStoreGames";
import { useServerStatus } from "../hooks/useServerStatus";
import { useGamePreviewStore } from "../store/gamePreview.store";
import { PageShell } from "../components/layout/PageShell";
import { UnknownErrorPanel } from "../components/errors/UnknownErrorPanel";
import { HoloStoreCard } from "../components/store/HoloStoreCard";
import { StoreSearch } from "../components/store/StoreSearch";
import { resolveStoreCoverImage } from "../lib/storeGame";
import { platformLabel } from "../lib/platformIcons";
import { cn } from "../lib/cn";
import type { Platform } from "@shared/schemas";
import {
  STORE_CARD_GAP_PX,
  STORE_CARD_WIDTH_PX,
} from "../components/store/storeCarouselLayout";
import { IpcChannel, type AppErrorCode, type Game } from "@shared/schemas";
import { useAuthStore } from "../store/auth.store";
import { send } from "../lib/ipc";
import arrowPrev from "../assets/icons/arrow-prev-svgrepo-com.svg";
import arrowNext from "../assets/icons/arrow-forward-svgrepo-com.svg";
import { useStoreUpdateStore } from "../store/storeUpdate.store";

const CARD_W = STORE_CARD_WIDTH_PX;
const CARD_GAP = STORE_CARD_GAP_PX;
const HALF_TRACK = `calc(50% - ${CARD_W / 2}px)`;
/** Ignore scroll-sync while arrow-driven smooth scroll finishes */
const PROGRAMMATIC_SCROLL_MS = 850;
/** Let the pick pulse land before route change (double-click open). */
const NAVIGATE_AFTER_CENTER_MS = 280;

function inferErrorCode(err: unknown): AppErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed"))
    return "NETWORK";
  return "STORE_UNAVAILABLE";
}

function ArrowBtn({ src, onClick }: { src: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all hover:bg-white/8 active:scale-90"
    >
      <img
        src={src}
        alt=""
        className="h-8 w-8 object-contain invert opacity-55 transition-opacity hover:opacity-90"
        draggable={false}
      />
    </button>
  );
}

function StoreServerDown({
  mode,
  errorDetails,
  onRetry,
  retrying,
}: {
  mode: "offline" | "maintenance";
  errorDetails?: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const headline =
    mode === "maintenance" ? "Server under maintenance" : "Can't reach the server";
  const sub =
    mode === "maintenance"
      ? "Check back soon. Installed games still work."
      : "Your installed games still work. The store will reload automatically when the server is back.";
  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#c8c4bc]">{headline}</p>
      <p className="text-[12px] text-[#6a6a6a]">{sub}</p>
      {errorDetails && (
        <p className="text-[10px] text-[#5a4a4a]">{errorDetails}</p>
      )}
      <div className="flex items-center gap-4 mt-1">
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#a09080] hover:text-white transition-colors disabled:opacity-50"
        >
          {retrying ? "Checking…" : "Try again"}
        </button>
        <span className="text-[#333]">|</span>
        <button
          type="button"
          onClick={() => send(IpcChannel.APP_OPEN_LOGS)}
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6a6a6a] hover:text-white transition-colors"
        >
          Open Logs
        </button>
      </div>
    </div>
  );
}

function StoreEmpty() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <p className="text-[13px] leading-relaxed text-[#8a8a8a]">
        {isAdmin ? (
          <>
            Nothing published to the store yet. In{" "}
            <span className="text-[#b0b0b0]">Settings → Admin</span>, import catalog titles to
            <span className="text-[#b0b0b0]"> publish them here</span> (that is not your personal
            library; use <span className="text-[#b0b0b0]">Add to library</span> on a game for that).
          </>
        ) : (
          <>
            Nothing published to the store yet. Only an administrator can import catalog titles and
            publish them here. Your personal library is separate — use{" "}
            <span className="text-[#b0b0b0]">Add to library</span> on a game for that.
          </>
        )}
      </p>
      {isAdmin && (
        <Link
          to="/settings/admin"
          className="rounded-lg bg-white/8 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ccc] transition-colors hover:bg-white/12"
        >
          Open admin
        </Link>
      )}
    </div>
  );
}

function Carousel({ games, controls }: { games: Game[]; controls?: ReactNode }) {
  const N = games.length;
  const navigate = useNavigate();
  const setPreviewGame = useGamePreviewStore((s) => s.set);
  const outerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntilRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const normalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only wrap when there are 2+ games
  const infinite = N > 1;

  // Triple the list so we can scroll left AND right without hitting a wall.
  // We start in the middle copy (index N) so there are N cards of runway each direction.
  const displayGames = useMemo(
    () => (infinite ? [...games, ...games, ...games] : games),
    [games, infinite],
  );

  // virtualIdx is a position in displayGames. realIdx maps it back to 0..N-1.
  const [virtualIdx, setVirtualIdx] = useState(() => (infinite ? N : 0));
  const realIdx = N > 0 ? ((virtualIdx % N) + N) % N : 0;

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (normalizeTimerRef.current) clearTimeout(normalizeTimerRef.current);
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    },
    [],
  );

  // When N changes (e.g. initial load), jump to the middle copy with no animation
  useEffect(() => {
    const vi = infinite ? N : 0;
    setVirtualIdx(vi);
    const scroller = outerRef.current;
    if (scroller) scroller.scrollLeft = vi * (CARD_W + CARD_GAP);
  }, [N, infinite]);

  /**
   * Card i's center aligns with the viewport center at scrollLeft = i*(CARD_W+CARD_GAP).
   * Math proof: paddingInline = calc(50% - CARD_W/2), so card i center = 50%·W + i*(W+G).
   * Setting scrollLeft = i*(CARD_W+CARD_GAP) gives viewport center = scrollLeft + 50%·W = same. ✓
   */
  const scrollToVirtual = useCallback((vi: number, behavior: ScrollBehavior = "smooth") => {
    const scroller = outerRef.current;
    if (!scroller) return;
    if (behavior === "instant") {
      scroller.scrollLeft = vi * (CARD_W + CARD_GAP);
    } else {
      scroller.scrollTo({ left: vi * (CARD_W + CARD_GAP), behavior });
    }
  }, []);

  // After a wrap, silently teleport back to the middle copy (same visual position)
  const normalizeToMiddle = useCallback(() => {
    if (!infinite) return;
    setVirtualIdx((prev) => {
      const mid = ((prev % N) + N) % N + N;
      if (mid !== prev) {
        // Block the scroll listener briefly so it doesn't overwrite the state we just set
        programmaticScrollUntilRef.current = Date.now() + 300;
        const scroller = outerRef.current;
        if (scroller) scroller.scrollLeft = mid * (CARD_W + CARD_GAP);
        return mid;
      }
      return prev;
    });
  }, [N, infinite]);

  const scheduleNormalize = useCallback(() => {
    if (normalizeTimerRef.current) clearTimeout(normalizeTimerRef.current);
    normalizeTimerRef.current = setTimeout(normalizeToMiddle, PROGRAMMATIC_SCROLL_MS + 200);
  }, [normalizeToMiddle]);

  // Track manual user scrolling
  const onScroll = useCallback(() => {
    if (Date.now() < programmaticScrollUntilRef.current) return;
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const scroller = outerRef.current;
      if (!scroller) return;
      const total = displayGames.length;
      const vi = Math.max(0, Math.min(total - 1, Math.round(scroller.scrollLeft / (CARD_W + CARD_GAP))));
      setVirtualIdx((prev) => (vi !== prev ? vi : prev));
      scheduleNormalize();
    });
  }, [displayGames.length, scheduleNormalize]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [onScroll]);

  const scrollDir = useCallback(
    (dir: -1 | 1) => {
      programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_MS;
      setVirtualIdx((prev) => {
        const next = infinite ? prev + dir : Math.max(0, Math.min(N - 1, prev + dir));
        requestAnimationFrame(() => scrollToVirtual(next));
        scheduleNormalize();
        return next;
      });
    },
    [N, infinite, scrollToVirtual, scheduleNormalize],
  );

  /** Scroll so the card at this display index is centered (single-click or programmatic). */
  const centerToVirtual = useCallback(
    (vi: number) => {
      programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_MS;
      setVirtualIdx(vi);
      requestAnimationFrame(() => scrollToVirtual(vi));
      scheduleNormalize();
    },
    [scrollToVirtual, scheduleNormalize],
  );

  const centered = games[realIdx];
  const title = centered?.title ?? "";
  const backdrop = centered ? resolveStoreCoverImage(centered) : undefined;

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Header: filter dropdown left, title center, search right */}
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="justify-self-start">{controls}</div>
        <div className="flex min-h-[2.75rem] min-w-0 items-center justify-center">
          <h2
            key={realIdx}
            title={title}
            className="font-title max-w-[46vw] select-none truncate px-2 text-center text-[clamp(1.6rem,3.5vw,2.8rem)] leading-none tracking-[0.1em] text-white/95"
            style={{
              animation: "storeTitleIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
              textShadow: "0 1px 0 rgba(0,0,0,0.45), 0 8px 28px rgba(0,0,0,0.35)",
            }}
          >
            {title}
          </h2>
        </div>
        <div className="justify-self-end">
          <StoreSearch games={games} />
        </div>
      </div>

      <div className="relative flex w-full items-center gap-4">
        {/* Ambient art glow — anchored behind the card row only, masked so it has no edges */}
        {backdrop && (
          <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <img
              key={centered?.id}
              src={backdrop}
              alt=""
              aria-hidden
              draggable={false}
              className="store-backdrop h-[115%] w-[640px] max-w-none rounded-full object-cover"
            />
          </div>
        )}
        <ArrowBtn src={arrowPrev} onClick={() => scrollDir(-1)} />

        {/* One perspective on the scroller = one shared vanishing point for every card.
            The mask fades edge cards out instead of hard-clipping them at the boundary. */}
        <div
          ref={outerRef}
          className="store-track-mask min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            scrollSnapType: "x proximity",
            scrollPaddingInline: HALF_TRACK,
            perspective: "1200px",
            overscrollBehaviorX: "contain",
          }}
        >
          {/* Vertical padding: room for the lift/tilt above and the reflections below */}
          <div
            className="flex items-center pt-12 pb-28"
            style={{
              paddingInline: HALF_TRACK,
              gap: `${CARD_GAP}px`,
              transformStyle: "preserve-3d",
            }}
          >
            {displayGames.map((g, di) => {
              // Signed row position: side cards angle toward the center (cover-flow).
              const offset = Math.max(-2, Math.min(2, di - virtualIdx));
              return (
                <HoloStoreCard
                  key={di}
                  game={g}
                  offset={offset}
                  onCenter={() => centerToVirtual(di)}
                  onNavigate={(rect) => {
                    // Center the exact card that was double-clicked (display index), not a “nearest” duplicate
                    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_MS;
                    setVirtualIdx(di);
                    setPreviewGame(g, { x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                    requestAnimationFrame(() => scrollToVirtual(di));
                    if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
                    navigateTimerRef.current = setTimeout(() => {
                      navigateTimerRef.current = null;
                      navigate(`/game/${g.id}`);
                    }, NAVIGATE_AFTER_CENTER_MS);
                    scheduleNormalize();
                  }}
                />
              );
            })}
          </div>
        </div>

        <ArrowBtn src={arrowNext} onClick={() => scrollDir(1)} />
      </div>
    </div>
  );
}

type Selection = { kind: "all" } | { kind: "newest" } | { kind: "platform"; platform: Platform };

/** Compact filter menu: all games, recent catalog updates, or one platform. */
function StoreControls({
  selection,
  onSelect,
  platforms,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  platforms: Platform[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentLabel =
    selection.kind === "all"
      ? "All games"
      : selection.kind === "newest"
        ? "Recently added"
        : platformLabel(selection.platform);

  const options: { key: string; label: string; sel: Selection }[] = [
    { key: "all", label: "All games", sel: { kind: "all" } },
    { key: "newest", label: "Recently added", sel: { kind: "newest" } },
    ...platforms.map((p) => ({
      key: p,
      label: platformLabel(p),
      sel: { kind: "platform", platform: p } as Selection,
    })),
  ];

  const isActive = (o: Selection) =>
    o.kind === selection.kind &&
    (o.kind !== "platform" || o.platform === (selection as { platform?: Platform }).platform);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 border-b px-0 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
          open ? "border-white/60 text-white" : "border-white/10 text-[#909090] hover:border-white/30 hover:text-white",
        )}
      >
        {currentLabel}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={cn("shrink-0 transition-transform duration-200", open && "rotate-180")}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="store-menu absolute left-0 top-[calc(100%+6px)] z-[300] min-w-[176px] border-y border-white/[0.09] bg-[#0c0c11]/98 py-1">
          {options.map((o, i) => {
            const active = isActive(o.sel);
            return (
              <div key={o.key}>
                {i === 2 && <div className="my-1 h-px bg-white/[0.06]" />}
                <button
                  type="button"
                  onClick={() => {
                    onSelect(o.sel);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-white/[0.04] px-1 py-2 text-left text-[11px] uppercase tracking-[0.08em] transition-colors last:border-b-0",
                    active ? "text-white" : "text-[#777] hover:text-[#bbb]",
                  )}
                >
                  <span className="flex-1">{o.label}</span>
                  {active && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/80" aria-hidden />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StorePage() {
  const server = useServerStatus();
  const { games, isLoading, isError, error, isEmpty, refetch: refetchGames } = useStoreGames();
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  const hasStoreUpdate = useStoreUpdateStore((state) => state.hasUpdate);
  const clearStoreUpdate = useStoreUpdateStore((state) => state.clearUpdate);

  useEffect(() => {
    if (hasStoreUpdate) clearStoreUpdate();
  }, [hasStoreUpdate, clearStoreUpdate]);

  // Platforms present in the catalog, biggest shelf first.
  const platforms = useMemo(() => {
    const counts = new Map<Platform, number>();
    for (const g of games) if (g.platform) counts.set(g.platform, (counts.get(g.platform) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [games]);

  useEffect(() => {
    if (
      selection.kind === "platform" &&
      !platforms.includes(selection.platform)
    ) {
      setSelection({ kind: "all" });
    }
  }, [platforms, selection]);

  const displayed = useMemo(() => {
    if (selection.kind === "platform") {
      return games.filter((g) => g.platform === selection.platform);
    }
    if (selection.kind === "newest") {
      const dated = games
        .map((game) => ({
          game,
          addedAt: game.dateAddedToLibrary
            ? new Date(game.dateAddedToLibrary).getTime()
            : Number.NaN,
        }))
        .filter((entry) => Number.isFinite(entry.addedAt))
        .sort((a, b) => b.addedAt - a.addedAt);
      if (dated.length === 0) return games;
      const recentCutoff = dated[0].addedAt - 30 * 24 * 60 * 60 * 1000;
      return dated
        .filter((entry) => entry.addedAt >= recentCutoff)
        .map((entry) => entry.game);
    }
    return [...games].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
    );
  }, [games, selection]);

  const selKey =
    selection.kind === "platform" ? `platform-${selection.platform}` : selection.kind;

  const serverDown = !server.isLoading && server.data != null && !server.data.online;
  const serverOnline = server.data?.online === true;
  const prevOnlineRef = useRef<boolean | undefined>(undefined);

  // When the server comes back online, reload the store if it has no data or errored
  useEffect(() => {
    if (prevOnlineRef.current === false && serverOnline) {
      void refetchGames();
    }
    prevOnlineRef.current = serverOnline;
  }, [serverOnline, refetchGames]);

  function handleRetry() {
    void server.refetch();
    void refetchGames();
  }

  if (serverDown) {
    const mode = server.data?.serverState === "maintenance" ? "maintenance" : "offline";
    return (
      <PageShell>
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center">
          <StoreServerDown
            mode={mode}
            errorDetails={server.data?.error}
            onRetry={handleRetry}
            retrying={server.isFetching}
          />
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <UnknownErrorPanel
          code={inferErrorCode(error)}
          message={error instanceof Error ? error.message : "Could not load the store."}
          detail="Check your connection and library source in settings."
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6">
        {isLoading ? (
          <p className="text-[12px] text-[#555]">Loading…</p>
        ) : isEmpty ? (
          <StoreEmpty />
        ) : (
          <Carousel
            key={selKey}
            games={displayed}
            controls={
              <StoreControls selection={selection} onSelect={setSelection} platforms={platforms} />
            }
          />
        )}
      </div>
    </PageShell>
  );
}
