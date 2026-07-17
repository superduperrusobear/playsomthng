/**
 * InstallModal — Steam-style install dialog.
 *
 * Shows:
 *  - Game cover + title + size
 *  - Drive picker with free-space bar per drive
 *  - Desktop / Start Menu shortcut toggles
 *  - Space check warning if drive is too small
 *  - Install / Cancel buttons
 */

import { useState, useEffect, useCallback } from "react";
import type { GameListItem } from "@shared/schemas";
import {
  useDrives,
  useInstallPref,
  useDiskSpaceCheck,
  useStartInstall,
} from "../../hooks/useInstall";
import { resolveStoreCoverImage } from "../../lib/storeGame";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/cn";
import { humanizeInstallInvokeError } from "../../lib/installErrors";

interface InstallModalProps {
  game: GameListItem;
  onClose: () => void;
  onInstallStarted?: () => void;
}

export function InstallModal({ game, onClose, onInstallStarted }: InstallModalProps) {
  const { data: drives = [], isLoading: drivesLoading } = useDrives();
  const { data: pref } = useInstallPref();
  const diskCheck = useDiskSpaceCheck();
  const startInstall = useStartInstall();

  const [selectedMount, setSelectedMount] = useState<string | null>(null);
  const [desktopShortcut, setDesktopShortcut] = useState(false);
  const [startMenuShortcut, setStartMenuShortcut] = useState(true);
  const [hasSufficientSpace, setHasSufficientSpace] = useState<boolean | null>(null);
  const [availableBytes, setAvailableBytes] = useState<number | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const requiredBytes = game.sizeBytes ?? 0;
  const cover = resolveStoreCoverImage(game);

  // Pick preferred or first drive on load
  useEffect(() => {
    if (drives.length === 0) return;
    if (selectedMount) return;
    const preferred = pref?.mount
      ? drives.find((d) => d.mount === pref.mount || d.mount.startsWith(pref.mount ?? ""))
      : null;
    setSelectedMount((preferred ?? drives[0]).mount);
  }, [drives, pref, selectedMount]);

  // Re-check space whenever selected drive changes
  const checkSpace = useCallback(
    async (mount: string) => {
      if (!requiredBytes) {
        setHasSufficientSpace(true);
        return;
      }
      try {
        const result = await diskCheck.mutateAsync({ mount, requiredBytes });
        setHasSufficientSpace(result.hasSufficient);
        setAvailableBytes(result.availableBytes);
      } catch {
        setHasSufficientSpace(null);
      }
    },
    [diskCheck, requiredBytes],
  );

  useEffect(() => {
    if (selectedMount) void checkSpace(selectedMount);
  }, [selectedMount, checkSpace]);

  /** All installs go under `<drive>\PSGAMES` (Windows) or `<mount>/PSGAMES`. */
  const installRoot = selectedMount
    ? selectedMount.replace(/[\\/]+$/, "") +
      (selectedMount.includes("\\") || /^[A-Za-z]:/.test(selectedMount) ? "\\PSGAMES" : "/PSGAMES")
    : null;

  const handleInstall = async () => {
    if (!installRoot) return;
    setInstallError(null);
    if (!game.manifestUrl?.trim() || !game.downloadBaseUrl?.trim()) {
      setInstallError(
        "This game is missing manifest URLs from the catalog. Sync your library or check the server connection.",
      );
      return;
    }
    try {
      await startInstall.mutateAsync({
        gameId: game.id,
        installRoot,
        desktopShortcut,
        startMenuShortcut,
        rememberDrive: true,
        // Same catalog data the library already loaded — avoids a second HTTP lookup that can 404.
        manifestUrl: game.manifestUrl,
        downloadBaseUrl: game.downloadBaseUrl,
        gameTitle: game.title,
      });
      onInstallStarted?.();
      onClose();
    } catch (e) {
      setInstallError(humanizeInstallInvokeError(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-[480px] rounded-xl border border-[#2a2a2a] bg-[#141414] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1f1f1f] px-5 py-4">
          <span className="text-[13px] font-semibold text-white">Install</span>
          <button
            onClick={onClose}
            className="text-[#555] transition hover:text-white"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Game info row */}
        <div className="flex items-center gap-4 border-b border-[#1a1a1a] px-5 py-4">
          <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-[#1e1e1e]">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#333]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-[14px] font-semibold text-white">{game.title}</p>
            {requiredBytes > 0 && (
              <p className="mt-0.5 text-[12px] text-[#777]">{formatBytes(requiredBytes)}</p>
            )}
          </div>
        </div>

        {/* Shortcut toggles */}
        <div className="flex gap-6 border-b border-[#1a1a1a] px-5 py-3">
          <Toggle
            checked={desktopShortcut}
            onChange={setDesktopShortcut}
            label="Create desktop shortcut"
          />
          <Toggle
            checked={startMenuShortcut}
            onChange={setStartMenuShortcut}
            label="Create start menu shortcut"
          />
        </div>

        {/* Drive picker */}
        <div className="px-5 py-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#555]">
            Install to
          </p>
          {drivesLoading ? (
            <p className="text-[12px] text-[#555]">Scanning drives…</p>
          ) : drives.length === 0 ? (
            <p className="text-[12px] text-[#e05252]">No drives detected.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {drives.map((d) => {
                const selected = d.mount === selectedMount;
                const pct = Math.min(100, d.usePercent);
                const willFit = requiredBytes === 0 || d.available >= requiredBytes;
                return (
                  <button
                    key={d.mount}
                    onClick={() => setSelectedMount(d.mount)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition",
                      selected
                        ? "border-[#3a67f0] bg-[#1d2a54]"
                        : "border-[#222] bg-[#1a1a1a] hover:border-[#333]",
                    )}
                  >
                    <DriveIcon />
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className={cn("text-[12px] font-medium", selected ? "text-white" : "text-[#bbb]")}>
                          {d.label}
                        </span>
                        <span className={cn("text-[11px]", willFit ? "text-[#aaa]" : "text-[#e05252]")}>
                          {formatBytes(d.available)} FREE
                          {!willFit && " ✗"}
                        </span>
                      </div>
                      {/* Bar */}
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#2a2a2a]">
                        <div
                          className={cn("h-full rounded-full transition-all", willFit ? "bg-[#3a67f0]" : "bg-[#e05252]")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Install path preview */}
          {installRoot && (
            <p className="mt-2.5 text-[10px] text-[#444]">
              Will install to:{" "}
              <span className="text-[#666]">
                {installRoot}
                {installRoot.includes("\\") ? "\\" : "/"}
                {game.slug}
              </span>
            </p>
          )}

          {installError && (
            <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {installError}
            </p>
          )}

          {/* Space warning */}
          {hasSufficientSpace === false && (
            <p className="mt-3 text-[11px] text-[#e05252]">
              Not enough space — need {formatBytes(requiredBytes)}, only{" "}
              {formatBytes(availableBytes ?? 0)} available.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[#1a1a1a] px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-5 py-2 text-[12px] font-medium text-[#888] transition hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleInstall()}
            disabled={
              !installRoot ||
              hasSufficientSpace === false ||
              startInstall.isPending
            }
            className="rounded-md bg-[#3a67f0] px-6 py-2 text-[12px] font-semibold text-white transition hover:bg-[#2a57e0] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {startInstall.isPending ? "Starting…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 select-none">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-4 w-4 rounded-sm border transition",
          checked
            ? "border-[#3a67f0] bg-[#3a67f0]"
            : "border-[#444] bg-[#1e1e1e]",
        )}
      >
        {checked && (
          <svg
            className="absolute inset-0 m-auto"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path d="M1.5 5l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span className="text-[11px] text-[#999]">{label}</span>
    </label>
  );
}

function DriveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-[#555]">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 15h.01M10 15h.01" />
    </svg>
  );
}
