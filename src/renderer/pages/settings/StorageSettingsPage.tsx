import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { invoke } from "../../lib/ipc";
import { IpcChannel } from "@shared/schemas";
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

export function StorageSettingsPage() {
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

  return (
    <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection>
          <h1 className="font-title text-[clamp(1.5rem,3vw,2rem)] tracking-[0.12em] text-white/95 uppercase">Storage</h1>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[#6a6a6a]">
            Free space on your drives and what each installed game is using.
          </p>
        </SettingsSection>

        {disks.length > 0 && (
          <SettingsSection>
            <p className="mb-4 font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">Drives</p>
            <StorageVolumesList disks={disks} preferredMount={installPref?.mount ?? null} highlightPreferred />
          </SettingsSection>
        )}

        <SettingsSection>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <p className="font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">Installed games</p>
            {installed.length > 0 && (
              <span className="text-[10px] uppercase tracking-[0.12em] text-[#555]">
                {installed.length} installed · <span className="text-[#9a9a9a]">{formatBytes(totalBytes)}</span>
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
