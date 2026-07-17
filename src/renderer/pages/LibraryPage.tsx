import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserLibraryGames } from "../hooks/useUserLibraryGames";
import { LibraryCard } from "../components/library/LibraryCard";
import { ResumeBanner } from "../components/install/ResumeBanner";
import { PageShell } from "../components/layout/PageShell";
import { useLocalLibraryFile, useSaveLocalLibraryFile } from "../hooks/useLocalLibraryFile";
import { usePlaytime } from "../hooks/usePlaytime";
import { useLibraryMode } from "../hooks/useLibraryMode";
import { IpcChannel, type GameListItem, type LocalLibraryGameEntry } from "@shared/schemas";
import { invoke } from "../lib/ipc";
import arrowPrev from "../assets/icons/arrow-prev-svgrepo-com.svg";
import arrowNext from "../assets/icons/arrow-forward-svgrepo-com.svg";
import { useIgdbSearch, useIgdbFetchGame } from "../hooks/useIgdb";

export function LibraryPage() {
  const { importedListItems, isLoading, isError } = useUserLibraryGames();
  const { isRemote } = useLibraryMode();
  const { data: libraryFile } = useLocalLibraryFile();
  const saveLocal = useSaveLocalLibraryFile();
  const { data: playtime } = usePlaytime();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("alpha");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addPlatform, setAddPlatform] = useState("");
  /** From IGDB only when user picks a search result — not typed by user. */
  const [addIgdbCoverUrl, setAddIgdbCoverUrl] = useState("");
  const [addIgdbScreenshotUrls, setAddIgdbScreenshotUrls] = useState<string[]>([]);
  const [addIgdbDescription, setAddIgdbDescription] = useState("");
  const [addIgdbDeveloper, setAddIgdbDeveloper] = useState("");
  const [addIgdbPublisher, setAddIgdbPublisher] = useState("");
  const [addIgdbReleaseDate, setAddIgdbReleaseDate] = useState("");
  const [addPath, setAddPath] = useState("");
  const [igdbQuery, setIgdbQuery] = useState("");
  const [igdbResults, setIgdbResults] = useState<IgdbResultDisplay[]>([]);
  const igdbSearch = useIgdbSearch();
  const igdbFetch = useIgdbFetchGame();
  const [browseExecutableBusy, setBrowseExecutableBusy] = useState(false);

  const pickExecutablePath = useCallback(async () => {
    setBrowseExecutableBusy(true);
    try {
      const r = await invoke<{ path: string | null }>(IpcChannel.DIALOG_PICK_EXECUTABLE);
      if (r.path) setAddPath(r.path);
    } finally {
      setBrowseExecutableBusy(false);
    }
  }, []);

  const resetAddForm = () => {
    setAddTitle("");
    setAddPlatform("");
    setAddIgdbCoverUrl("");
    setAddIgdbScreenshotUrls([]);
    setAddIgdbDescription("");
    setAddIgdbDeveloper("");
    setAddIgdbPublisher("");
    setAddIgdbReleaseDate("");
    setAddPath("");
    setIgdbQuery("");
    setIgdbResults([]);
  };

  useEffect(() => {
    if (!showAddModal) resetAddForm();
  }, [showAddModal]);

  const addGame = useMutation({
    mutationFn: async () => {
      const file = libraryFile;
      if (!file) return;
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const next = {
        ...file,
        games: [
          ...file.games,
          {
            gameId: id,
            installed: true,
            installPath: addPath || null,
            installedVersion: null,
            downloadState: "completed" as const,
            launchOverride: null,
            lastPlayedAt: null,
            pinned: false,
            source: "own" as const,
            customTitle: addTitle || id,
            customPlatform: addPlatform || "custom",
            customCoverImage: addIgdbCoverUrl || undefined,
            customScreenshotUrls:
              addIgdbScreenshotUrls.length > 0 ? addIgdbScreenshotUrls : undefined,
            customDescription: addIgdbDescription.trim() || undefined,
            customDeveloper: addIgdbDeveloper.trim() || undefined,
            customPublisher: addIgdbPublisher.trim() || undefined,
            customReleaseDate: addIgdbReleaseDate.trim() || undefined,
            customLaunchPath: addPath || undefined,
            customAddedAt: now,
          },
        ],
      };
      await saveLocal.mutateAsync(next);
      qc.invalidateQueries({ queryKey: ["library"] });
    },
    onSuccess: () => {
      setShowAddModal(false);
      resetAddForm();
    },
  });

  const decorated = useMemo(() => {
    const playtimeMap = new Map<string, { total: number; lastPlayedIso?: string }>();
    (playtime ?? []).forEach((p) => {
      playtimeMap.set(p.gameId, { total: p.totalMinutes, lastPlayedIso: p.lastPlayedAt });
    });

    return importedListItems.map((g) => {
      const entry = libraryFile?.games.find((e) => e.gameId === g.id);
      const pt = playtimeMap.get(g.id);
      return {
        game: g,
        installed: entry?.installed === true,
        lastPlayedMs: lastPlayedSortMs(entry, pt?.lastPlayedIso),
        totalMinutes: pt?.total ?? 0,
        dateAddedMs: dateAddedSortMs(g, entry),
        platform: g.platform ?? "unknown",
        sizeBytes: g.sizeBytes ?? 0,
        sourceOwn: entry?.source === "own",
      };
    });
  }, [importedListItems, libraryFile?.games, playtime]);

  const filtered = useMemo(() => {
    const filteredBySearch = decorated.filter((g) =>
      g.game.title.toLowerCase().includes(search.toLowerCase()),
    );

    const applySort = (arr: typeof filteredBySearch) => {
      return arr.slice().sort((a, b) => {
        switch (sort) {
          case "alpha":
            return a.game.title.localeCompare(b.game.title);
          case "dateAdded":
            return b.dateAddedMs - a.dateAddedMs;
          case "size":
            return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
          default:
            return 0;
        }
      });
    };

    const all = applySort(filteredBySearch);
    const installed = applySort(all.filter((g) => g.installed));
    const uninstalled = applySort(all.filter((g) => !g.installed));
    const lastPlayed = filteredBySearch
      .filter((g) => g.lastPlayedMs > 0)
      .sort((a, b) => b.lastPlayedMs - a.lastPlayedMs);

    return { all, installed, uninstalled, lastPlayed };
  }, [decorated, search, sort]);

  return (
    <PageShell>
      <ResumeBanner />

      {/* Top bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#444]"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your library…"
            className="w-full rounded-lg border border-[#1e1e1e] bg-[#111] py-2 pl-9 pr-3 text-[12px] text-[#ccc] placeholder-[#444] outline-none focus:border-[#333]"
          />
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] bg-[#111] px-3 py-2 text-[11px] font-semibold text-[#ddd] transition hover:border-[#333] hover:text-white"
          title="Add your own game"
        >
          <span className="text-[12px]">+ Add Game</span>
        </button>
      </div>

      {/* Only a real outage warrants a banner — no server means nothing to warn about. */}
      {isError && isRemote && !isLoading && (
        <div className="mb-3 rounded-lg border border-[#2a2a1e] bg-[#1a1a10]/60 px-3 py-2 text-[10px] text-[#7a7a4a]">
          Can&apos;t reach the server — showing cached library
        </div>
      )}

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <LibraryGridSkeleton />
        ) : isError && importedListItems.length === 0 ? (
          <LibraryOffline />
        ) : importedListItems.length === 0 ? (
          <EmptyLibrary hasGames={false} />
        ) : (
          <>
            <LibraryRow
              title="INSTALLED"
              games={filtered.installed}
              emptyLabel="Nothing installed yet"
              sort={sort}
              onSortChange={setSort}
            />
            <LibraryRow
              title="NOT INSTALLED"
              games={filtered.uninstalled}
              emptyLabel="No games here"
              sort={sort}
              onSortChange={setSort}
            />
            <LibraryRow
              title="ALL GAMES"
              games={filtered.all}
              emptyLabel="No games found"
              sort={sort}
              onSortChange={setSort}
            />
            {filtered.lastPlayed.length > 0 && (
              <LibraryRow
                title="LAST PLAYED"
                games={filtered.lastPlayed}
                emptyLabel="No play history"
                hideSort
              />
            )}
          </>
        )}
      </div>
      <AddGameModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={() => addGame.mutate()}
        title={addTitle}
        platform={addPlatform}
        path={addPath}
        setTitle={setAddTitle}
        setPlatform={setAddPlatform}
        setPath={setAddPath}
        pending={addGame.isPending}
        query={igdbQuery}
        setQuery={setIgdbQuery}
        igdbEnriched={
          !!(addIgdbDescription || addIgdbDeveloper || addIgdbPublisher || addIgdbReleaseDate)
        }
        igdbDescription={addIgdbDescription}
        igdbDeveloper={addIgdbDeveloper}
        igdbPublisher={addIgdbPublisher}
        igdbReleaseDate={addIgdbReleaseDate}
        onSearch={() => {
          const q = igdbQuery.trim();
          if (!q) return;
          igdbSearch.mutate(
            { q, limit: 8 },
            {
              onSuccess: (res) => {
                setIgdbResults(
                  res.results.map((r) => ({
                    id: r.igdbId,
                    name: r.name,
                    platform: r.platforms[0],
                    cover: r.coverUrl ?? undefined,
                    summary: r.summary ?? undefined,
                  })),
                );
              },
            },
          );
        }}
        results={igdbResults}
        onPick={(id) => {
          igdbFetch.mutate(
            { igdbId: id },
            {
              onSuccess: (meta) => {
                setAddTitle(meta.name ?? addTitle);
                setAddPlatform(meta.platforms[0] ?? addPlatform);
                setAddIgdbCoverUrl(meta.coverUrl ?? "");
                setAddIgdbScreenshotUrls(meta.screenshotUrls ?? []);
                setAddIgdbDescription(meta.summary?.trim() ?? "");
                setAddIgdbDeveloper(meta.developers?.length ? meta.developers.join(", ") : "");
                setAddIgdbPublisher(meta.publishers?.length ? meta.publishers.join(", ") : "");
                setAddIgdbReleaseDate(meta.releaseDateIso?.trim() ?? "");
                setIgdbResults([]);
              },
            },
          );
        }}
        onBrowseExecutable={pickExecutablePath}
        browseExecutableBusy={browseExecutableBusy}
      />
    </PageShell>
  );
}

type DecoratedGame = {
  game: GameListItem;
  installed: boolean;
  /** Milliseconds since epoch for sorting */
  lastPlayedMs: number;
  totalMinutes: number;
  /** Milliseconds since epoch for sorting */
  dateAddedMs: number;
  platform: string | null;
  sizeBytes: number;
  sourceOwn?: boolean;
};

function lastPlayedSortMs(
  entry: LocalLibraryGameEntry | undefined,
  playtimeIso?: string,
): number {
  if (entry?.lastPlayedAt != null) return entry.lastPlayedAt * 1000;
  if (playtimeIso) {
    const t = Date.parse(playtimeIso);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function dateAddedSortMs(
  g: GameListItem,
  entry: LocalLibraryGameEntry | undefined,
): number {
  if (g.dateAddedToLibrary) {
    const t = Date.parse(g.dateAddedToLibrary);
    return Number.isFinite(t) ? t : 0;
  }
  if (entry?.customAddedAt != null) return entry.customAddedAt * 1000;
  return 0;
}

type SortKey = "alpha" | "dateAdded" | "size";

type IgdbResultDisplay = {
  id: number;
  name: string;
  platform?: string;
  cover?: string;
  summary?: string;
};

function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="rounded border border-[#1e1e1e] bg-[#0f0f0f] px-2 py-1 text-[11px] text-[#ccc] outline-none focus:border-[#333]"
    >
      <option value="size">Size On Disk</option>
      <option value="dateAdded">Date Added</option>
      <option value="alpha">Alphabetical</option>
    </select>
  );
}

function LibraryRow({
  title,
  games,
  emptyLabel,
  sort,
  onSortChange,
  hideSort = false,
}: {
  title: string;
  games: DecoratedGame[];
  emptyLabel: string;
  sort?: SortKey;
  onSortChange?: (v: SortKey) => void;
  hideSort?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = dir === "left" ? -480 : 480;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  if (games.length === 0) {
    return (
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between pr-1">
          <h3 className="text-[12px] font-semibold text-[#aaa]">{title}</h3>
        </div>
        <p className="text-[11px] text-[#333]">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between pr-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-semibold text-[#aaa]">{title}</h3>
          {!hideSort && onSortChange && (
            <SortSelect value={sort ?? "alpha"} onChange={onSortChange} />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => scrollBy("left")}
            className="flex h-9 w-9 items-center justify-center text-white transition hover:scale-105"
            aria-label="Scroll left"
          >
            <img src={arrowPrev} alt="" className="h-5 w-5 invert opacity-90" />
          </button>
          <button
            onClick={() => scrollBy("right")}
            className="flex h-9 w-9 items-center justify-center text-white transition hover:scale-105"
            aria-label="Scroll right"
          >
            <img src={arrowNext} alt="" className="h-5 w-5 invert opacity-90" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {games.map((item) => (
          <div key={item.game.id} className="w-[172px] shrink-0 scroll-snap-start">
            <LibraryCard game={item.game} hideHoverOverlay />
          </div>
        ))}
      </div>
    </div>
  );
}

function AddGameModal({
  open,
  onClose,
  onSubmit,
  title,
  platform,
  path,
  setTitle,
  setPlatform,
  setPath,
  pending,
  query,
  setQuery,
  igdbEnriched,
  igdbDescription,
  igdbDeveloper,
  igdbPublisher,
  igdbReleaseDate,
  onSearch,
  results,
  onPick,
  onBrowseExecutable,
  browseExecutableBusy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  title: string;
  platform: string;
  path: string;
  setTitle: (v: string) => void;
  setPlatform: (v: string) => void;
  setPath: (v: string) => void;
  pending: boolean;
  query: string;
  setQuery: (v: string) => void;
  igdbEnriched: boolean;
  igdbDescription: string;
  igdbDeveloper: string;
  igdbPublisher: string;
  igdbReleaseDate: string;
  onSearch: (q: string) => void;
  results: IgdbResultDisplay[];
  onPick: (id: number) => void;
  onBrowseExecutable: () => void | Promise<void>;
  browseExecutableBusy: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#1e1e1e] bg-[#0f0f0f] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-white">Add Game</h3>
          <button
            onClick={onClose}
            className="text-[12px] text-[#777] hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-[#888]">
            Title *
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded border border-[#1e1e1e] bg-[#111] px-3 py-2 text-[12px] text-white outline-none focus:border-[#333]"
              placeholder="My Game"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[#888]">
            Quick search (IGDB)
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSearch(query);
                }
              }}
              className="w-full rounded border border-[#1e1e1e] bg-[#111] px-3 py-2 text-[12px] text-white outline-none focus:border-[#333]"
              placeholder="Type a title and press Enter"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => onSearch(query)}
                className="rounded border border-[#2563eb] bg-[#2563eb] px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-[#3b82f6]"
              >
                Search
              </button>
            </div>
            <span className="text-[10px] text-[#555]">
              Pick a result to load cover, screenshots, description, credits, and release date from IGDB.
            </span>
            {results.length > 0 && (
              <div className="mt-2 flex max-h-52 flex-col gap-2 overflow-y-auto rounded border border-[#1e1e1e] bg-[#0c0c0c] p-2">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onPick(r.id)}
                    className="flex gap-3 rounded border border-transparent px-2 py-2 text-left transition hover:border-[#2a2a2a] hover:bg-[#121212]"
                  >
                    {r.cover ? (
                      <img src={r.cover} alt="" className="h-12 w-9 rounded object-cover" />
                    ) : (
                      <div className="h-12 w-9 rounded bg-[#1a1a1a]" />
                    )}
                    <div className="flex flex-col">
                      <span className="text-[12px] font-semibold text-white">{r.name}</span>
                      <span className="text-[10px] text-[#777]">
                        {r.platform ?? "Platform unknown"}
                      </span>
                      {r.summary && <span className="line-clamp-2 text-[10px] text-[#555]">{r.summary}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </label>
          {igdbEnriched && (
            <div className="rounded-lg border border-[#1e2e1e] bg-[#0a120a]/80 px-3 py-2.5 text-[10px] leading-relaxed text-[#7a8a7a]">
              <p className="mb-1 font-semibold uppercase tracking-[0.12em] text-[#5a7a5a]">From IGDB</p>
              {igdbReleaseDate && (
                <p>
                  <span className="text-[#555]">Release · </span>
                  {igdbReleaseDate}
                </p>
              )}
              {igdbDeveloper && (
                <p>
                  <span className="text-[#555]">Developer · </span>
                  {igdbDeveloper}
                </p>
              )}
              {igdbPublisher && (
                <p>
                  <span className="text-[#555]">Publisher · </span>
                  {igdbPublisher}
                </p>
              )}
              {igdbDescription && (
                <p className="mt-1 line-clamp-4 text-[#888]">{igdbDescription}</p>
              )}
            </div>
          )}
          <label className="flex flex-col gap-1 text-[11px] text-[#888]">
            Platform
            <input
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded border border-[#1e1e1e] bg-[#111] px-3 py-2 text-[12px] text-white outline-none focus:border-[#333]"
              placeholder="PC, Steam, etc."
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[#888]">
            Executable
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[#1e1e1e] bg-[#111] px-3 py-2 text-[11px] text-[#ccc] outline-none focus:border-[#333]"
                placeholder="Browse or paste a path…"
                title={path || undefined}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => void onBrowseExecutable()}
                disabled={browseExecutableBusy || pending}
                className="shrink-0 rounded border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-[11px] font-semibold text-[#ddd] transition hover:border-[#3a3a3a] hover:bg-[#222] hover:text-white disabled:opacity-50"
              >
                {browseExecutableBusy ? "…" : "Browse…"}
              </button>
            </div>
            <span className="text-[10px] text-[#444]">
              Opens your system file picker (Windows, Linux, macOS).
            </span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-[#1e1e1e] px-3 py-2 text-[12px] text-[#888] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!title.trim() || pending}
            className="rounded border border-[#2563eb] bg-[#2563eb] px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-[#3b82f6] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[3/4] w-full animate-pulse rounded-xl bg-[#1a1a1a]"
        />
      ))}
    </div>
  );
}

function LibraryOffline() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[13px] font-semibold text-[#666]">Can't reach the server</p>
      <p className="mt-1 text-[11px] text-[#444]">
        Your library will appear once the server is back online.
        <br />
        Already installed games can still be launched from the Downloads tab.
      </p>
    </div>
  );
}

function EmptyLibrary({ hasGames }: { hasGames: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#111] text-3xl text-[#222]">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
      <p className="text-[13px] font-semibold text-[#555]">
        {hasGames ? "No results" : "Your library is empty"}
      </p>
      <p className="mt-1 text-[11px] text-[#333]">
        {hasGames ? "Try a different search" : "Head to the Store to add games"}
      </p>
    </div>
  );
}
