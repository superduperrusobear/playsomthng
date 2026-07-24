/**
 * Import / Metadata Editor
 *
 * Opened by the Admin panel when the admin clicks "Import" on an unimported catalog item,
 * or "Edit" on an already-published item.
 *
 * Data flow:
 *   1. Load catalog-meta from Rust server (creates a draft stub if none exists yet)
 *   2. Load manifest details (launch target candidates, file count, size)
 *   3. Admin can search IGDB and apply candidate metadata
 *   4. Admin edits fields freely; nothing is overwritten without explicit action
 *   5. Save as draft OR publish → PUT /api/admin/catalog-meta/:id
 *   6. Publish state lives on the server — `publishState` decides Store visibility
 */

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useParams } from "react-router-dom";
import { SettingsBackLink } from "./SettingsBackLink";
import { useCatalogMeta, useSaveCatalogMeta } from "../../hooks/useCatalogMeta";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "../../lib/ipc";
import { IpcChannel, type ManifestJson } from "@shared/schemas";
import { useSettings } from "../../hooks/useSettings";
import { useIgdbSearch, useIgdbFetchGame } from "../../hooks/useIgdb";
import { useAdminCatalog } from "../../hooks/useLibrary";
import {
  PLATFORM_LABELS,
  type CatalogMeta,
  type PlatformTag,
  type IgdbSearchResult,
  type IgdbMeta,
} from "@shared/schemas";

// ── Utilities ─────────────────────────────────────────────────────────────────

const ALL_PLATFORMS: PlatformTag[] = [
  "windows", "ps3", "ps4", "ps5", "xbox", "xbox-360", "xbox-one",
  "nes", "snes", "n64", "game-cube", "wii", "wii-u", "switch",
  "gba", "nds", "3ds", "psp", "ps-vita", "ps1", "ps2", "arcade", "other",
];

const PACKAGE_TYPES = ["pc-game", "rom", "rom-bundle", "iso", "emulator"];

// ── Small reusable pieces ─────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7a7a7a]">
      {children}
    </label>
  );
}

function FieldInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg border border-white/[0.1] bg-black/35 px-3 py-2 text-[13px] text-[#e4e4e8] placeholder-[#555] outline-none transition-colors focus:border-white/20 ${mono ? "font-mono" : ""}`}
    />
  );
}

function FieldTextarea({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-y rounded-lg border border-white/[0.1] bg-black/35 px-3 py-2 text-[13px] leading-relaxed text-[#e4e4e8] placeholder-[#555] outline-none transition-colors focus:border-white/20 min-h-[4.5rem]"
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  sublabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between py-2 text-left"
    >
      <div>
        <p className="text-[12px] font-medium text-[#ccc]">{label}</p>
        {sublabel && <p className="mt-0.5 text-[10px] text-[#555]">{sublabel}</p>}
      </div>
      <div
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-[#2563eb]" : "bg-[#333]"}`}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </div>
    </button>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-title text-[12px] uppercase tracking-[0.16em] text-white/75">
      {children}
    </h3>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`border-b border-white/[0.06] pb-6 ${className}`}
    >
      {children}
    </section>
  );
}

// ── Platform picker ───────────────────────────────────────────────────────────

function PlatformPicker({
  selected,
  onChange,
}: {
  selected: PlatformTag[];
  onChange: (tags: PlatformTag[]) => void;
}) {
  function toggle(tag: PlatformTag) {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_PLATFORMS.map((p) => {
        const active = selected.includes(p);
        return (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "border-[#2563eb]/70 bg-[#2563eb]/20 text-[#60a5fa]"
                : "border-[#2c2c2c] bg-[#181818] text-[#666] hover:border-[#3a3a3a] hover:text-[#999]"
            }`}
          >
            {PLATFORM_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}

// ── Launch targets (multi) ─────────────────────────────────────────────────────

const EXE_RE = /\.(exe|bat|sh|rom|iso|bin|cue|img|nsp|xci|gb[ac]?|sfc|n64|z64|v64|nds|3ds|cso|pbp|msi|app|deb|rpm|dmg)$/i;

/**
 * Picks one or more launch targets from the manifest's executables.
 * The first is the default; the user chooses among the rest at launch.
 */
function LaunchTargets({
  files,
  targets,
  onChange,
}: {
  files: string[];
  targets: string[];
  onChange: (next: string[]) => void;
}) {
  const [manual, setManual] = useState("");
  const options = useMemo(() => files.filter((f) => EXE_RE.test(f) && !targets.includes(f)), [files, targets]);

  const add = (t: string) => {
    const v = t.trim();
    if (v && !targets.includes(v)) onChange([...targets, v]);
  };
  const remove = (t: string) => onChange(targets.filter((x) => x !== t));
  const makeDefault = (t: string) => onChange([t, ...targets.filter((x) => x !== t)]);

  return (
    <div className="space-y-2.5">
      {/* Selected targets */}
      {targets.length > 0 && (
        <div className="space-y-1">
          {targets.map((t, i) => (
            <div key={t} className="flex items-center gap-2 border-b border-white/[0.045] py-2 last:border-b-0">
              <span className="font-mono text-[11px] text-[#cbd5e1] flex-1 truncate">{t}</span>
              {i === 0 ? (
                <span className="text-[9px] font-semibold uppercase text-[#7095b7]">
                  Default
                </span>
              ) : (
                <button type="button" onClick={() => makeDefault(t)} className="text-[9px] uppercase tracking-wide text-[#666] hover:text-[#aaa]">
                  Set default
                </button>
              )}
              <button type="button" onClick={() => remove(t)} className="text-[#555] hover:text-[#c88]">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add from manifest executables */}
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {options.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => add(f)}
              className="rounded-md border border-[#2c2c2c] bg-[#181818] px-2 py-1 font-mono text-[10px] text-[#888] transition-colors hover:border-[#3a5a7a] hover:text-[#60a5fa]"
            >
              + {f}
            </button>
          ))}
        </div>
      )}

      {/* Manual entry */}
      <div className="flex gap-2">
        <FieldInput value={manual} onChange={setManual} placeholder="or type a path, e.g. bin/game.exe" mono />
        <button
          type="button"
          onClick={() => { add(manual); setManual(""); }}
          disabled={!manual.trim()}
          className="shrink-0 rounded-lg border border-[#2c2c2c] bg-[#1a1a1a] px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#aaa] hover:border-[#444] disabled:opacity-30"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── IGDB search panel ─────────────────────────────────────────────────────────

function IgdbPanel({
  defaultQuery,
  onApply,
  onDismiss,
}: {
  defaultQuery: string;
  onApply: (meta: IgdbMeta) => void;
  onDismiss: () => void;
}) {
  const [q, setQ] = useState(defaultQuery);
  const [candidates, setCandidates] = useState<IgdbSearchResult[]>([]);
  const igdbSearch = useIgdbSearch();
  const igdbFetch = useIgdbFetchGame();
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  async function doSearch() {
    if (!q.trim()) return;
    const res = await igdbSearch.mutateAsync({ q: q.trim(), limit: 8 });
    setCandidates(res.results);
  }

  async function applyCandidate(result: IgdbSearchResult) {
    setFetchingId(result.igdbId);
    try {
      const full = await igdbFetch.mutateAsync({ igdbId: result.igdbId });
      onApply(full);
    } finally {
      setFetchingId(null);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void doSearch(); }
  }

  const isSearching = igdbSearch.isPending;
  const searchError = igdbSearch.error as Error | null;

  return (
    <div className="border-b border-white/[0.06] pb-6">
      <div className="mb-3 flex items-center justify-between">
        <SectionHead>IGDB Lookup</SectionHead>
        <button type="button" onClick={onDismiss} className="text-[11px] text-[#555] hover:text-[#888]">
          Skip IGDB
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search IGDB…"
          className="flex-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 py-2 text-[12px] text-[#ccc] placeholder-[#444] outline-none focus:border-[#444]"
        />
        <button
          type="button"
          onClick={() => void doSearch()}
          disabled={isSearching || !q.trim()}
          className="shrink-0 rounded-lg bg-[#2563eb]/90 px-4 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-40"
        >
          {isSearching ? "Searching…" : "Search"}
        </button>
      </div>

      {searchError && (
        <p className="mt-2 text-[11px] text-red-400">
          {searchError.message.includes("503") || searchError.message.includes("unavailable")
            ? "IGDB is not configured on the server — set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET."
            : searchError.message}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {candidates.map((c) => (
            <div
              key={c.igdbId}
              className="flex items-start gap-3 border-b border-white/[0.05] py-3 last:border-b-0"
            >
              {c.coverUrl && (
                <img
                  src={c.coverUrl}
                  alt={c.name}
                  className="h-14 w-10 shrink-0 rounded object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-[#d0d0d0]">{c.name}</p>
                {c.releaseYear && (
                  <p className="text-[10px] text-[#666]">{c.releaseYear}</p>
                )}
                {c.platforms.length > 0 && (
                  <p className="mt-0.5 text-[10px] text-[#555]">{c.platforms.join(", ")}</p>
                )}
                {c.summary && (
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#666]">
                    {c.summary}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void applyCandidate(c)}
                disabled={fetchingId === c.igdbId}
                className="shrink-0 self-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6f9973] transition-colors hover:text-[#9bc69f] disabled:opacity-40"
              >
                {fetchingId === c.igdbId ? "Loading…" : "Use"}
              </button>
            </div>
          ))}
        </div>
      )}

      {!isSearching && candidates.length === 0 && igdbSearch.isSuccess && (
        <p className="mt-3 text-center text-[11px] text-[#555]">No results — try a different title.</p>
      )}
    </div>
  );
}

// ── Screenshot URL editor ─────────────────────────────────────────────────────

function ScreenshotEditor({
  urls,
  onChange,
}: {
  urls: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (trimmed && !urls.includes(trimmed)) {
      onChange([...urls, trimmed]);
      setDraft("");
    }
  }

  function remove(url: string) {
    onChange(urls.filter((u) => u !== url));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="https://…"
          className="flex-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 py-2 text-[12px] text-[#ccc] placeholder-[#444] outline-none focus:border-[#444]"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="shrink-0 rounded-lg border border-[#2c2c2c] bg-[#1e1e1e] px-3 py-2 text-[11px] text-[#888] transition-colors hover:border-[#3a3a3a] hover:text-[#bbb] disabled:opacity-30"
        >
          + Add
        </button>
      </div>

      {urls.length > 0 && (
        <div className="space-y-1">
          {urls.map((url) => (
            <div key={url} className="flex items-center gap-2 border-b border-white/[0.045] py-2 last:border-b-0">
              <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#777]">{url}</p>
              <button
                type="button"
                onClick={() => remove(url)}
                className="shrink-0 text-[10px] text-[#555] hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main editor page ──────────────────────────────────────────────────────────

export function ImportEditorPage() {
  const { id } = useParams<{ id: string }>();

  const { data: remoteMeta, isLoading: metaLoading } = useCatalogMeta(id);
  const { data: library } = useAdminCatalog();
  const saveMeta = useSaveCatalogMeta();

  // Catalog item (for manifest URL + display fallback)
  const catalogItem = useMemo(
    () => library?.games?.find((g) => g.id === id || g.slug === id),
    [library?.games, id],
  );

  // Admin manifest query - uses admin endpoint without auth
  const settingsQuery = useSettings();
  const { data: manifest } = useQuery({
    queryKey: ["admin-manifest", id, settingsQuery.data?.sources[0]?.baseUrl],
    queryFn: async () => {
      if (!id) throw new Error("No game ID provided");
      if (!settingsQuery.data) throw new Error("Settings not loaded");
      
      const enabledSource = settingsQuery.data.sources.find((s: any) => s.enabled);
      if (!enabledSource) throw new Error("No enabled library source found");
      
      const adminManifestUrl = `${enabledSource.baseUrl}/api/admin/manifests/${id}`;
      return invoke<ManifestJson>(IpcChannel.MANIFEST_FETCH, { url: adminManifestUrl });
    },
    enabled: !!id && !!settingsQuery.data && settingsQuery.data.sources.some((s: any) => s.enabled),
    staleTime: 60_000,
  });

  // ── Local form state (copy of remoteMeta, editable) ────────────────────────
  const [form, setForm] = useState<CatalogMeta | null>(null);
  const [showIgdb, setShowIgdb] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync form from server on first load
  useEffect(() => {
    if (remoteMeta && !form) {
      // Seed display name from catalog title if stub
      const seed = { ...remoteMeta };
      if (seed.displayName === seed.id && catalogItem?.title) {
        seed.displayName = catalogItem.title;
      }
      // Seed launch target from manifest if not yet set
      if (!seed.launchTarget && manifest?.launchTarget) {
        seed.launchTarget = manifest.launchTarget;
      }
      setForm(seed);
    }
  }, [remoteMeta, catalogItem, manifest, form]);

  // Also seed launchTarget once manifest arrives (only if form already set with no target)
  useEffect(() => {
    if (form && !form.launchTarget && manifest?.launchTarget) {
      setForm((f) => f ? { ...f, launchTarget: manifest.launchTarget ?? f.launchTarget } : f);
    }
  }, [manifest?.launchTarget, form]);

  const patch = useCallback((partial: Partial<CatalogMeta>) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, ...partial };
      // Re-derive emulator_required if platform_tags changed and no manual override
      if ("platformTags" in partial && !next.emulatorOverride) {
        next.emulatorRequired = next.platformTags.some((p) => p !== "windows");
      }
      return next;
    });
    setSaved(false);
  }, []);

  // ── Apply IGDB data into form ───────────────────────────────────────────────
  function applyIgdb(meta: IgdbMeta) {
    const devJoined = meta.developers?.length ? meta.developers.join(", ") : undefined;
    const pubJoined = meta.publishers?.length ? meta.publishers.join(", ") : undefined;
    const shortFromSummary = (() => {
      const s = meta.summary?.trim();
      if (!s) return undefined;
      const line = s.split("\n").map((x) => x.trim()).find(Boolean);
      if (!line) return undefined;
      return line.length > 240 ? `${line.slice(0, 237)}…` : line;
    })();

    patch({
      // Always adopt the IGDB name so the game is titled correctly.
      displayName: meta.name,
      description: meta.summary ?? form?.description,
      shortDescription: form?.shortDescription ?? shortFromSummary ?? undefined,
      developer: devJoined ?? form?.developer,
      publisher: pubJoined ?? form?.publisher,
      releaseDate: meta.releaseDateIso ?? form?.releaseDate,
      coverImageUrl: meta.coverUrl ?? form?.coverImageUrl,
      screenshotUrls:
        meta.screenshotUrls.length > 0
          ? [...meta.screenshotUrls, ...(form?.screenshotUrls ?? [])]
          : form?.screenshotUrls ?? [],
      igdbId: meta.igdbId,
      igdbSlug: meta.igdbSlug ?? undefined,
    });
    setShowIgdb(false);
  }

  // ── Save helpers ────────────────────────────────────────────────────────────
  /** `publishState` on the server is the only thing that decides Store visibility. */
  async function saveAs(state: "draft" | "published") {
    if (!form) return;
    const saved = await saveMeta.mutateAsync({ ...form, publishState: state });
    setForm(saved);
    setSaved(true);
  }

  async function unpublish() {
    if (!form) return;
    await saveAs("draft");
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const isPublished = form?.publishState === "published";
  const isBusy = saveMeta.isPending;
  const manifestFiles = manifest?.files.map((f) => f.path) ?? [];

  // Launch targets: prefer the list; fall back to the legacy single target.
  const launchTargets =
    form?.launchTargets && form.launchTargets.length > 0
      ? form.launchTargets
      : form?.launchTarget
        ? [form.launchTarget]
        : [];
  /** Keep the legacy `launchTarget` in sync with the first list entry. */
  const setLaunchTargets = (next: string[]) =>
    patch({ launchTargets: next, launchTarget: next[0] ?? null });

  const defaultIgdbQuery = form?.displayName && form.displayName !== form?.id
    ? form.displayName
    : catalogItem?.title ?? "";

  if (metaLoading || !form) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SettingsBackLink />
        <div className="flex flex-1 items-center justify-center py-20">
          <p className="text-[13px] text-[#555]">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SettingsBackLink />

      {/* ── Header ── */}
      <div className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-title text-[clamp(1.1rem,2vw,1.35rem)] tracking-[0.06em] text-white/95">
              {form.displayName || form.id}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[#5a5a5a]">slug · {form.id}</p>
          </div>

          <div className="flex items-center gap-2">
            {saved && !isBusy && (
              <span className="text-[11px] text-emerald-400/80">Saved</span>
            )}
            {saveMeta.isError && (
              <span className="text-[11px] text-red-400/90">Save failed</span>
            )}

            {isPublished ? (
              <>
                <button
                  type="button"
                  onClick={() => void unpublish()}
                  disabled={isBusy}
                  className="rounded-lg border border-[#3a3a3a] bg-[#1e1e1e] px-4 py-1.5 text-[11px] font-medium text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:opacity-40"
                >
                  Unpublish
                </button>
                <button
                  type="button"
                  onClick={() => void saveAs("published")}
                  disabled={isBusy}
                  className="rounded-lg bg-emerald-600/90 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                >
                  {isBusy ? "Saving…" : "Save changes"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void saveAs("draft")}
                  disabled={isBusy}
                  className="rounded-lg border border-[#2c2c2c] bg-[#1a1a1a] px-4 py-1.5 text-[11px] font-medium text-[#aaa] transition-colors hover:border-[#3a3a3a] hover:text-white disabled:opacity-40"
                >
                  {isBusy ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  onClick={() => void saveAs("published")}
                  disabled={isBusy}
                  className="rounded-lg bg-[#2563eb]/90 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-40"
                >
                  {isBusy ? "Publishing…" : "Publish to Store"}
                </button>
              </>
            )}
          </div>
        </div>

      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[1fr_340px]">
        {/* ── Left: main form ── */}
        <div className="space-y-4">

          {/* IGDB panel */}
          {showIgdb ? (
            <IgdbPanel
              defaultQuery={defaultIgdbQuery}
              onApply={applyIgdb}
              onDismiss={() => setShowIgdb(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowIgdb(true)}
              className="flex w-full items-baseline justify-between border-b border-white/[0.06] pb-4 text-left"
            >
              <span className="text-[11px] font-medium text-[#888]">
                {form.igdbId ? "Update from IGDB" : "Search IGDB"}
              </span>
              {form.igdbId && <span className="font-mono text-[9px] text-[#505050]">{form.igdbId}</span>}
            </button>
          )}

          {/* Display info */}
          <Card>
            <SectionHead>Identity</SectionHead>
            <div className="space-y-3">
              <div>
                <Label>Display name</Label>
                <FieldInput
                  value={form.displayName}
                  onChange={(v) => patch({ displayName: v })}
                  placeholder="Game title shown in Store"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Package type</Label>
                  <select
                    value={form.packageType}
                    onChange={(e) => patch({ packageType: e.target.value })}
                    className="w-full rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 py-2 text-[12px] text-[#ccc] outline-none focus:border-[#444]"
                  >
                    {PACKAGE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Version</Label>
                  <FieldInput
                    value={form.version ?? ""}
                    onChange={(v) => patch({ version: v || null })}
                    placeholder="1.0.0"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Descriptions */}
          <Card>
            <SectionHead>Descriptions</SectionHead>
            <div className="space-y-3">
              <div>
                <Label>Short description</Label>
                <FieldInput
                  value={form.shortDescription ?? ""}
                  onChange={(v) => patch({ shortDescription: v || null })}
                  placeholder="One-line teaser shown on Store cards"
                />
              </div>
              <div>
                <Label>Full description</Label>
                <FieldTextarea
                  value={form.description ?? ""}
                  onChange={(v) => patch({ description: v || null })}
                  rows={5}
                  placeholder="Game overview, story, gameplay…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Developer</Label>
                  <FieldInput
                    value={form.developer ?? ""}
                    onChange={(v) => patch({ developer: v || null })}
                    placeholder="Studio, from IGDB or manual"
                  />
                </div>
                <div>
                  <Label>Publisher</Label>
                  <FieldInput
                    value={form.publisher ?? ""}
                    onChange={(v) => patch({ publisher: v || null })}
                    placeholder="Publisher, from IGDB or manual"
                  />
                </div>
              </div>
              <div>
                <Label>Release date</Label>
                <FieldInput
                  value={form.releaseDate ?? ""}
                  onChange={(v) => patch({ releaseDate: v || null })}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>
          </Card>

          {/* Platforms */}
          <Card>
            <SectionHead>Platforms</SectionHead>
            <PlatformPicker
              selected={form.platformTags}
              onChange={(tags) => patch({ platformTags: tags })}
            />
            <div className="mt-3 space-y-2">
              <Toggle
                checked={form.emulatorRequired}
                onChange={(v) => {
                  // When toggled manually, set override flag
                  patch({ emulatorRequired: v, emulatorOverride: true });
                }}
                label="Emulator required"
                sublabel={
                  form.emulatorOverride
                    ? "Manually set — overrides platform detection"
                    : "Auto-derived from selected platforms"
                }
              />
              {form.emulatorOverride && (
                <button
                  type="button"
                  onClick={() => {
                    // Reset override: re-derive from platforms
                    const derived = form.platformTags.some((p) => p !== "windows");
                    patch({ emulatorOverride: false, emulatorRequired: derived });
                  }}
                  className="text-[10px] text-[#555] hover:text-[#888] underline"
                >
                  Reset to auto-detect
                </button>
              )}
            </div>
          </Card>

          {/* Launch targets */}
          <Card>
            <SectionHead>Launch targets</SectionHead>
            <LaunchTargets
              files={manifestFiles}
              targets={launchTargets}
              onChange={setLaunchTargets}
            />
          </Card>

          {/* Special instructions */}
          <Card>
            <SectionHead>Special instructions</SectionHead>
            <FieldTextarea
              value={form.specialInstructions ?? ""}
              onChange={(v) => patch({ specialInstructions: v || null })}
              rows={3}
              placeholder="Setup steps or warnings shown to the user before launch…"
            />
          </Card>
        </div>

        {/* ── Right: media ── */}
        <div className="space-y-4">
          {/* Cover image */}
          <Card>
            <SectionHead>Cover image</SectionHead>
            {form.coverImageUrl && (
              <div className="mb-3 overflow-hidden">
                <img
                  src={form.coverImageUrl}
                  alt="Cover"
                  className="w-full object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              </div>
            )}
            <FieldInput
              value={form.coverImageUrl ?? ""}
              onChange={(v) => patch({ coverImageUrl: v || null })}
              placeholder="https://images.igdb.com/…"
            />
          </Card>

          {/* Screenshots */}
          <Card>
            <SectionHead>Screenshots / Gallery</SectionHead>
            <ScreenshotEditor
              urls={form.screenshotUrls}
              onChange={(v) => patch({ screenshotUrls: v })}
            />
            {form.screenshotUrls.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {form.screenshotUrls.slice(0, 4).map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt="Screenshot"
                    className="h-20 w-full rounded object-cover"
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                ))}
              </div>
            )}
          </Card>

        </div>
      </div>
    </div>
  );
}
