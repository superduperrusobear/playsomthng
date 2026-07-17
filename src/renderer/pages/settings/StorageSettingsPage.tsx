import { useCallback, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Package, Copy, RefreshCw } from "lucide-react";
import { invoke } from "../../lib/ipc";
import { IpcChannel, type LocalStorageBucket } from "@shared/schemas";
import { SettingsBackLink } from "./SettingsBackLink";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { useLibrary } from "../../hooks/useLibrary";
import { useLocalLibraryFile } from "../../hooks/useLocalLibraryFile";
import { useInstallPref, useOpenInstallFolder, useUninstallGame } from "../../hooks/useInstall";
import { useSysinfo } from "../../hooks/useSysinfo";
import { formatBytes } from "../../lib/formatBytes";
import {
  prepareStorageVolumes,
  StorageVolumesList,
  type StorageVolumeDisk,
} from "../../components/settings/StorageVolumesList";
import { useLocalStorageBreakdown } from "../../hooks/useLocalStorageBreakdown";

function bucketShort(b: LocalStorageBucket): string {
  switch (b) {
    case "cache":
      return "Cache";
    case "data":
      return "Data";
    case "config":
      return "Config";
    case "userData":
      return "Settings";
    default:
      return b;
  }
}

export function StorageSettingsPage() {
  const localBreakdown = useLocalStorageBreakdown();
  const { data: localLib } = useLocalLibraryFile();
  const { data: library } = useLibrary();
  const { data: sysinfo } = useSysinfo();
  const { data: installPref } = useInstallPref();
  const openFolder = useOpenInstallFolder();
  const uninstall = useUninstallGame();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { disks } = useMemo(() => {
    const raw = (sysinfo as { disks?: StorageVolumeDisk[] } | undefined)?.disks ?? [];
    return prepareStorageVolumes(raw);
  }, [sysinfo]);

  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of library?.games ?? []) m.set(g.id, g.title);
    return m;
  }, [library]);

  const installed = useMemo(
    () => (localLib?.games ?? []).filter((g) => g.installed && g.installPath),
    [localLib],
  );

  const sizeQueries = useQueries({
    queries: installed.map((g) => ({
      queryKey: ["dir-size", g.installPath],
      queryFn: () =>
        invoke<{ bytes: number; error?: string }>(IpcChannel.FS_DIR_SIZE_BYTES, { path: g.installPath! }),
      enabled: Boolean(g.installPath),
      staleTime: 60_000,
    })),
  });

  const totalBytes = useMemo(() => {
    let t = 0;
    for (const q of sizeQueries) {
      if (q.data && !q.data.error) t += q.data.bytes;
    }
    return t;
  }, [sizeQueries]);

  const rows = installed.map((g, i) => ({
    entry: g,
    title: titleById.get(g.gameId) ?? g.customTitle ?? g.gameId,
    size: sizeQueries[i]?.data,
    loading: sizeQueries[i]?.isLoading,
  }));

  const copyPath = useCallback(async (p: string) => {
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection>
          <h1 className="font-title text-[clamp(1.5rem,3vw,2rem)] tracking-[0.12em] text-white/95 uppercase">Storage</h1>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[#6a6a6a]">
            Disk space on your volumes and what your installs are using.
          </p>
        </SettingsSection>

        <SettingsSection>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">Local app data</h2>
              <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-[#555]">
                Somthng keeps small JSON files under your OS app folder (Electron{" "}
                <span className="text-[#7a7a7a]">userData</span>). The catalog cache is{" "}
                <span className="text-[#7a7a7a]">library-cache.json</span> — it grows with your server catalog size and
                refreshes when the catalog revision changes (not on a timer). Nothing here is your installed game
                files; those are listed below per install path.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void localBreakdown.refetch()}
              disabled={localBreakdown.isFetching}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#2c2c2c] bg-[#141414] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#888] transition hover:border-[#444] hover:text-[#bbb] disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${localBreakdown.isFetching ? "animate-spin" : ""}`} strokeWidth={2} />
              Refresh sizes
            </button>
          </div>

          {localBreakdown.data && (
            <div className="mb-3 rounded-lg border border-white/[0.06] bg-[#0f0f0f] px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#555]">App folder root</p>
              <div className="mt-1 flex items-start gap-2">
                <p className="min-w-0 flex-1 break-all font-mono text-[10px] leading-snug text-[#8a8a8a]">
                  {localBreakdown.data.userDataRoot}
                </p>
                <button
                  type="button"
                  title="Copy path"
                  onClick={() => void copyPath(localBreakdown.data!.userDataRoot)}
                  className="shrink-0 rounded p-1 text-[#555] hover:bg-white/5 hover:text-[#aaa]"
                >
                  <Copy className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
              <p className="mt-2 text-[10px] text-[#4a4a4a]">
                Total tracked files ·{" "}
                <span className="text-[#7a7a7a]">{formatBytes(localBreakdown.data.totalBytes)}</span>
                <span className="mx-2 text-[#333]">·</span>
                Scanned {new Date(localBreakdown.data.scannedAtIso).toLocaleString()}
              </p>
            </div>
          )}

          {localBreakdown.isLoading && !localBreakdown.data ? (
            <p className="text-[12px] text-[#555]">Loading local paths…</p>
          ) : localBreakdown.isError ? (
            <p className="text-[12px] text-red-400/80">Could not read local storage breakdown.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[9px] font-semibold uppercase tracking-[0.12em] text-[#555]">
                    <th className="py-2 pr-3">Folder</th>
                    <th className="py-2 pr-3">What</th>
                    <th className="whitespace-nowrap py-2 pr-3">Size</th>
                    <th className="py-2">Path</th>
                  </tr>
                </thead>
                <tbody>
                  {(localBreakdown.data?.entries ?? []).map((e) => (
                    <tr key={e.absolutePath} className="border-b border-white/[0.04] last:border-b-0">
                      <td className="py-2.5 pr-3 align-top text-[#7a7a7a]">{bucketShort(e.bucket)}</td>
                      <td className="max-w-[200px] py-2.5 pr-3 align-top text-[#9a9a9a]">{e.role}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 align-top font-mono text-[10px] text-[#888]">
                        {!e.exists ? "—" : formatBytes(e.bytes)}
                      </td>
                      <td className="py-2.5 align-top">
                        <div className="flex items-start gap-1.5">
                          <p className="min-w-0 flex-1 break-all font-mono text-[9px] leading-snug text-[#4a4a4a]">
                            {e.relativePath}
                          </p>
                          <button
                            type="button"
                            title="Copy full path"
                            onClick={() => void copyPath(e.absolutePath)}
                            className="shrink-0 rounded p-0.5 text-[#3a3a3a] hover:bg-white/5 hover:text-[#777]"
                          >
                            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsSection>

        {disks.length > 0 && (
          <SettingsSection>
            <StorageVolumesList disks={disks} preferredMount={installPref?.mount ?? null} highlightPreferred />
          </SettingsSection>
        )}

        <SettingsSection>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <p className="font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">Installed games</p>
            {installed.length > 0 && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#555]">
                Total install data · <span className="text-[#9a9a9a]">{formatBytes(totalBytes)}</span>
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="text-[13px] text-[#777]">Nothing installed yet.</p>
          ) : (
            <ul className="space-y-0">
              {rows.map(({ entry, title, size, loading }) => {
                let metric: string;
                if (loading) metric = "…";
                else if (!size || size.error) metric = "—";
                else metric = `${formatBytes(size.bytes)} used`.toUpperCase();
                return (
                  <li
                    key={entry.gameId}
                    className="flex flex-col gap-2 border-b border-white/[0.05] py-3.5 last:border-b-0"
                  >
                    <div className="flex items-start gap-4">
                      <Package className="mt-0.5 h-5 w-5 shrink-0 text-[#5c5c5c]" strokeWidth={1.75} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <p className="font-title text-[14px] tracking-[0.06em] text-white/90">{title}</p>
                          <p className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-[#9a9a9a] sm:text-[11px]">
                            {metric}
                          </p>
                        </div>
                        <p
                          className="mt-1 truncate font-mono text-[10px] text-[#4a4a4a]"
                          title={entry.installPath ?? ""}
                        >
                          {entry.installPath}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-6 pl-9">
                      <button
                        type="button"
                        onClick={() => openFolder.mutate(entry.gameId)}
                        disabled={openFolder.isPending}
                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6a9a6a] transition hover:text-[#8cbc8c] disabled:opacity-50"
                      >
                        Open folder
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(entry.gameId)}
                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9a5a5a] transition hover:text-[#c07070]"
                      >
                        Uninstall
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsSection>
      </SettingsSurface>

      {confirmId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-uninstall-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161616] p-6 shadow-2xl">
            <p id="storage-uninstall-title" className="font-title text-[17px] tracking-[0.1em] text-white/95 uppercase">
              Uninstall game?
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-[#888]">
              Installed files are removed from this folder. The game can stay in your library as not installed.
            </p>
            <div className="mt-8 flex justify-end gap-4">
              <button
                type="button"
                onClick={() => setConfirmId(null)}
                className="text-[12px] text-[#888] transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={uninstall.isPending}
                onClick={async () => {
                  await uninstall.mutateAsync(confirmId);
                  setConfirmId(null);
                }}
                className="text-[12px] font-medium text-red-400 transition hover:text-red-300 disabled:opacity-50"
              >
                {uninstall.isPending ? "Working…" : "Uninstall"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
