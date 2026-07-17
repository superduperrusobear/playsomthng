import { useMemo } from "react";
import type { LaunchFlags, PlatformFamily } from "@shared/schemas";
import {
  DEFAULT_GAMESCOPE_H,
  DEFAULT_GAMESCOPE_W,
  formatLaunchCommandPreview,
} from "@shared/launchCommand";
import { GameDetailSidePanel } from "./GameDetailSidePanel";
import { cn } from "@/lib/cn";

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 transition hover:bg-white/[0.04]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#444] bg-[#111] accent-[#3a67f0]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>
        <span className="block text-[13px] font-medium text-[#ddd]">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-snug text-[#666]">{description}</span>}
      </span>
    </label>
  );
}

export function LaunchOptionsPanel({
  onClose,
  launchFlags,
  onPatchFlags,
  execPathPreview,
  platformFamily,
  canPersist,
}: {
  onClose: () => void;
  launchFlags: LaunchFlags | null | undefined;
  onPatchFlags: (patch: Partial<LaunchFlags>) => void;
  execPathPreview: string;
  platformFamily: PlatformFamily;
  canPersist: boolean;
}) {
  const f = launchFlags ?? {};

  const preview = useMemo(() => {
    if (!execPathPreview.trim()) {
      return "— Install path and launch target required to preview —";
    }
    return formatLaunchCommandPreview({
      execPath: execPathPreview,
      launchFlags: f,
      platformFamily,
    });
  }, [execPathPreview, f, platformFamily]);

  return (
    <GameDetailSidePanel title="Launch options" onClose={onClose}>
      {!canPersist && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200/90">
          Add this game to your library to save launch options.
        </p>
      )}

      <div className="space-y-2">
        {platformFamily === "linux" && (
          <>
            <ToggleRow label="GameMode" description="Prepends gamemoderun" checked={!!f.gameMode} onChange={(v) => onPatchFlags({ gameMode: v })} disabled={!canPersist} />
            <ToggleRow label="MangoHud" description="Prepends mangohud" checked={!!f.mangoHud} onChange={(v) => onPatchFlags({ mangoHud: v })} disabled={!canPersist} />
            <ToggleRow label="Gamescope" description="Nested compositor wrapper" checked={!!f.gamescope} onChange={(v) => onPatchFlags({ gamescope: v })} disabled={!canPersist} />
            {f.gamescope && (
              <div className="ml-1 space-y-2 rounded-lg border border-white/5 bg-black/30 px-3 py-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[10px] uppercase tracking-wider text-[#555]">
                    Width
                    <input
                      type="number"
                      min={320}
                      max={7680}
                      value={f.gamescopeWidth ?? DEFAULT_GAMESCOPE_W}
                      onChange={(e) => onPatchFlags({ gamescopeWidth: Number(e.target.value) || DEFAULT_GAMESCOPE_W })}
                      disabled={!canPersist}
                      className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[12px] text-white outline-none focus:border-[#3a67f0]"
                    />
                  </label>
                  <label className="block text-[10px] uppercase tracking-wider text-[#555]">
                    Height
                    <input
                      type="number"
                      min={240}
                      max={4320}
                      value={f.gamescopeHeight ?? DEFAULT_GAMESCOPE_H}
                      onChange={(e) => onPatchFlags({ gamescopeHeight: Number(e.target.value) || DEFAULT_GAMESCOPE_H })}
                      disabled={!canPersist}
                      className="mt-1 w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[12px] text-white outline-none focus:border-[#3a67f0]"
                    />
                  </label>
                </div>
                <ToggleRow
                  label="Fullscreen (-f)"
                  checked={f.gamescopeFullscreen !== false}
                  onChange={(v) => onPatchFlags({ gamescopeFullscreen: v })}
                  disabled={!canPersist}
                />
              </div>
            )}
          </>
        )}
        <ToggleRow
          label="Skip intro videos"
          description="Sets SKIP_INTRO=1"
          checked={!!f.skipIntro}
          onChange={(v) => onPatchFlags({ skipIntro: v })}
          disabled={!canPersist}
        />
        <ToggleRow label="Force windowed" description="Adds -windowed" checked={!!f.windowed} onChange={(v) => onPatchFlags({ windowed: v })} disabled={!canPersist} />
      </div>

      <label className="mt-4 block text-[10px] uppercase tracking-wider text-[#555]">
        Custom flags
        <textarea
          value={f.customFlags ?? ""}
          onChange={(e) => onPatchFlags({ customFlags: e.target.value })}
          disabled={!canPersist}
          placeholder="Appended raw to the command…"
          rows={2}
          className="mt-1.5 w-full resize-y rounded border border-[#2a2a2a] bg-[#111] px-2 py-2 font-mono text-[11px] text-[#ccc] outline-none focus:border-[#3a67f0]"
        />
      </label>

      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="text-[10px] uppercase tracking-wider text-[#555]">Command preview</p>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/5 bg-black/50 p-3 font-mono text-[10px] leading-relaxed text-[#9a9a9a]">
          {preview}
        </pre>
      </div>
    </GameDetailSidePanel>
  );
}
