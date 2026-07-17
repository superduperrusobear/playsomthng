import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { SettingsBackLink } from "./SettingsBackLink";
import { useSettings } from "../../hooks/useSettings";
import { useAdminCatalog } from "../../hooks/useLibrary";
import { useSaveCatalogMeta } from "../../hooks/useCatalogMeta";
import { invoke } from "../../lib/ipc";
import { IpcChannel, type CatalogMeta, type GameListItem, type LibrarySource, type ManifestJson } from "@shared/schemas";

function formatBytes(bytes: number | undefined): string {
  if (bytes == null || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function SourcesSection({ sources }: { sources: LibrarySource[] }) {
  if (sources.length === 0) {
    return (
      <div className="rounded-lg border border-[#2c2c2c] bg-[#1a1a1a] px-4 py-5 text-center">
        <p className="text-[12px] text-[#666]">No sources configured.</p>
        <p className="mt-1 text-[11px] text-[#555]">
          Add a library source in settings (JSON). Set <span className="text-[#888]">baseUrl</span> to
          your Rust API root (same host as <span className="text-[#888]">publicBaseUrl</span> in
          server config), e.g. <span className="text-[#888]">http://127.0.0.1:3000</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sources.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 rounded-lg border border-[#2c2c2c] bg-[#1a1a1a] px-4 py-3"
        >
          <div
            className={`h-2 w-2 shrink-0 rounded-full ${s.enabled ? "bg-emerald-500" : "bg-[#555]"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-[#d0d0d0]">{s.name}</p>
            <p className="truncate font-mono text-[11px] text-[#666]">{s.baseUrl}</p>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              s.enabled
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-[#333] text-[#777]"
            }`}
          >
            {s.enabled ? "Active" : "Off"}
          </span>
        </div>
      ))}
      <p className="text-[10px] leading-relaxed text-[#555]">
        Catalog comes from <span className="text-[#777]">GET /api/games</span>. Each game&apos;s
        manifest is at <span className="text-[#777]">manifestUrl</span> (Rust{" "}
        <span className="text-[#777]">/manifests/&#123;id&#125;</span>) and is loaded below for import
        details.
      </p>
    </div>
  );
}

function ManifestMeta({
  q,
  catalogSizeBytes,
}: {
  q: { isLoading: boolean; isError: boolean; error: Error | null; data: ManifestJson | undefined };
  catalogSizeBytes?: number;
}) {
  if (q.isLoading) {
    return <span className="text-[10px] text-[#555]">Manifest…</span>;
  }
  if (q.isError) {
    return (
      <span className="text-[10px] text-red-400/90" title={q.error?.message}>
        Manifest error
      </span>
    );
  }
  const m = q.data;
  if (!m) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#777]">
      <span title="totalBytes from manifest JSON">{formatBytes(m.totalBytes)}</span>
      <span className="text-[#444]">·</span>
      <span title="file count">{m.files.length} files</span>
      <span className="text-[#444]">·</span>
      <span
        className="rounded border border-[#3a5a7a]/60 bg-[#1e2a35] px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide text-[#8ab4d4]"
        title="packageType"
      >
        {m.packageType}
      </span>
      {m.launchTarget && (
        <>
          <span className="text-[#444]">·</span>
          <span className="truncate font-mono text-[#888]" title="launchTarget">
            {m.launchTarget}
          </span>
        </>
      )}
      {catalogSizeBytes != null && catalogSizeBytes !== m.totalBytes && (
        <span className="ml-1 text-[9px] text-amber-600/90" title="Catalog size vs manifest totalBytes">
          (catalog {formatBytes(catalogSizeBytes)})
        </span>
      )}
    </div>
  );
}

function ImportList({
  importable,
  apiBaseUrl,
}: {
  importable: GameListItem[];
  apiBaseUrl?: string;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const manifestQueries = useQueries({
    queries: importable.map((g) => ({
      queryKey: ["admin-manifest", apiBaseUrl, g.slug],
      queryFn: () =>
        invoke<ManifestJson>(IpcChannel.MANIFEST_FETCH, {
          url: `${apiBaseUrl}/api/admin/manifests/${g.slug}`,
        }),
      enabled: !!apiBaseUrl,
      staleTime: 60_000,
    })),
  });

  const queryBySlug = useMemo(() => {
    const map = new Map<string, (typeof manifestQueries)[number]>();
    importable.forEach((g, i) => {
      map.set(g.slug, manifestQueries[i]!);
    });
    return map;
  }, [importable, manifestQueries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return importable;
    const q = search.toLowerCase();
    return importable.filter((g) => g.title.toLowerCase().includes(q));
  }, [importable, search]);

  if (importable.length === 0) {
    return (
      <div className="rounded-lg border border-[#2c2c2c] bg-[#1a1a1a] px-4 py-5 text-center">
        <p className="text-[12px] text-[#666]">All catalog games have been imported.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search available games…"
        className="w-full rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 py-2 text-[12px] text-[#ccc] placeholder-[#555] outline-none transition-colors focus:border-[#444]"
      />

      <div className="max-h-[45vh] space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#333_transparent]">
        {filtered.map((g) => {
          const mq = queryBySlug.get(g.slug);
          return (
            <div
              key={g.id}
              className="group rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-[#2c2c2c] hover:bg-[#1a1a1a]"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[12px] font-medium text-[#d0d0d0]">{g.title}</p>
                    {!g.manifestUrl && (
                      <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0 text-[9px] font-medium uppercase text-amber-400">
                        No manifest URL
                      </span>
                    )}
                  </div>
                  {g.manifestUrl ? (
                    <div className="mt-1">
                      <ManifestMeta
                        q={{
                          isLoading: mq?.isLoading ?? false,
                          isError: mq?.isError ?? false,
                          error: (mq?.error as Error) ?? null,
                          data: mq?.data,
                        }}
                        catalogSizeBytes={g.sizeBytes}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-[10px] text-[#555]">
                      Re-fetch catalog from a playsomthng-server source to get manifest links.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/settings/admin/import/${g.slug}`)}
                  className="mt-0.5 shrink-0 rounded-md bg-[#2563eb]/90 px-3 py-1.5 text-[11px] font-medium text-white opacity-90 transition-all hover:bg-[#1d4ed8] hover:opacity-100"
                >
                  Import
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && search.trim() && (
          <p className="py-4 text-center text-[11px] text-[#555]">
            No matches for &ldquo;{search}&rdquo;
          </p>
        )}
      </div>

      <p className="text-[10px] text-[#555]">
        {importable.length} catalog title{importable.length !== 1 ? "s" : ""} not on the Store yet —
        manifest details from the Rust server.
      </p>
    </div>
  );
}

function ImportedList({
  importedGames,
  onRemove,
  unpublishingId,
  apiBaseUrl,
}: {
  importedGames: GameListItem[];
  onRemove: (game: GameListItem) => void;
  unpublishingId: string | null;
  apiBaseUrl?: string;
}) {
  const navigate = useNavigate();

  const manifestQueries = useQueries({
    queries: importedGames.map((g) => ({
      queryKey: ["admin-manifest", apiBaseUrl, g.slug],
      queryFn: () =>
        invoke<ManifestJson>(IpcChannel.MANIFEST_FETCH, {
          url: `${apiBaseUrl}/api/admin/manifests/${g.slug}`,
        }),
      enabled: !!apiBaseUrl,
      staleTime: 60_000,
    })),
  });

  const queryBySlug = useMemo(() => {
    const map = new Map<string, (typeof manifestQueries)[number]>();
    importedGames.forEach((g, i) => {
      map.set(g.slug, manifestQueries[i]!);
    });
    return map;
  }, [importedGames, manifestQueries]);

  if (importedGames.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="max-h-[30vh] space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#333_transparent]">
        {importedGames.map((g) => {
          const mq = queryBySlug.get(g.slug);
          return (
            <div
              key={g.id}
              className="group rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-[#2c2c2c] hover:bg-[#1a1a1a]"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[#d0d0d0]">{g.title}</p>
                  {g.manifestUrl && (
                    <div className="mt-1">
                      <ManifestMeta
                        q={{
                          isLoading: mq?.isLoading ?? false,
                          isError: mq?.isError ?? false,
                          error: (mq?.error as Error) ?? null,
                          data: mq?.data,
                        }}
                        catalogSizeBytes={g.sizeBytes}
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/settings/admin/import/${g.slug}`)}
                    className="rounded-md border border-[#2c2c2c] bg-[#1a1a1a] px-3 py-1.5 text-[11px] font-medium text-[#aaa] transition-all hover:border-[#3a3a3a] hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(g)}
                    disabled={unpublishingId != null}
                    className="rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30"
                  >
                    {unpublishingId === g.id ? "…" : "Remove"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#555]">
        {importedGames.length} game{importedGames.length !== 1 ? "s" : ""} in store
      </p>
    </div>
  );
}

export function AdminPage() {
  const { data: settings } = useSettings();
  const { data: library, isLoading: libLoading, isError: libError, error: libErr } = useAdminCatalog();
  const saveMeta = useSaveCatalogMeta();
  const [unpublishing, setUnpublishing] = useState<string | null>(null);

  const sources: LibrarySource[] = settings?.sources ?? [];
  const activeSourceBaseUrl = useMemo(
    () => sources.find((s) => s.enabled)?.baseUrl,
    [sources],
  );
  const catalogGames: GameListItem[] = (library?.games as GameListItem[]) ?? [];

  // Publish state comes from the server, so it's the same on every admin machine.
  const importable = useMemo(
    () => catalogGames.filter((g) => g.publishState !== "published"),
    [catalogGames],
  );
  const importedGames = useMemo(
    () => catalogGames.filter((g) => g.publishState === "published"),
    [catalogGames],
  );

  /** Unpublish = flip the server's publishState back to draft. */
  const handleRemove = useCallback(
    async (game: GameListItem) => {
      setUnpublishing(game.id);
      try {
        const meta = await invoke<CatalogMeta>(IpcChannel.CATALOG_META_GET, { id: game.slug });
        await saveMeta.mutateAsync({ ...meta, publishState: "draft" });
      } finally {
        setUnpublishing(null);
      }
    },
    [saveMeta],
  );

  return (
    <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        {/* Sources */}
        <SettingsSection>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#888]">
            Sources
          </h2>
          <SourcesSection sources={sources} />
        </SettingsSection>

        {/* Import games */}
        <SettingsSection>
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#888]">
            Publish to store
          </h2>
          <p className="mb-3 text-[10px] leading-relaxed text-[#555]">
            Adds titles to the public Store only. The user&apos;s Library is separate — they add games
            there with &ldquo;Add to library&rdquo; on the Store.
          </p>
          {libLoading ? (
            <p className="text-[12px] text-[#555]">Loading catalog from API…</p>
          ) : libError ? (
            <p className="text-[12px] text-red-400/90">
              {libErr instanceof Error ? libErr.message : "Could not load catalog."}
            </p>
          ) : (
            <ImportList importable={importable} apiBaseUrl={activeSourceBaseUrl} />
          )}
        </SettingsSection>

        {/* Imported / store games */}
        <SettingsSection>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#888]">
            Store Games
          </h2>
          {!libLoading && !libError && (
            <ImportedList
              importedGames={importedGames}
              onRemove={handleRemove}
              unpublishingId={unpublishing}
              apiBaseUrl={activeSourceBaseUrl}
            />
          )}
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
