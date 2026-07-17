import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@/lib/ipc";
import { IpcChannel } from "@shared/schemas";
import { WINETRICKS_DONE_CHANNEL, WINETRICKS_LOG_CHANNEL } from "@shared/compatChannels";
import type { PlatformFamily } from "@shared/schemas";
import { GameDetailSidePanel } from "./GameDetailSidePanel";
import { cn } from "@/lib/cn";

const WINETRICKS_GROUPS: { title: string; verbs: string[] }[] = [
  { title: "Runtimes", verbs: ["vcrun2022", "vcrun2019", "dotnet48", "dotnet6", "xna40"] },
  { title: "DirectX", verbs: ["d3dx11", "d3dx9", "dxvk"] },
  { title: "Audio", verbs: ["openal"] },
  { title: "Fonts", verbs: ["corefonts"] },
];

const TIER_STYLES: Record<string, string> = {
  platinum: "bg-cyan-950/80 text-cyan-200 border-cyan-700/50",
  gold: "bg-amber-950/80 text-amber-200 border-amber-700/50",
  silver: "bg-slate-700/80 text-slate-200 border-slate-500/50",
  bronze: "bg-orange-950/80 text-orange-200 border-orange-800/50",
  borked: "bg-red-950/80 text-red-200 border-red-800/50",
  pending: "bg-zinc-800/80 text-zinc-300 border-zinc-600/50",
  unknown: "bg-zinc-800/80 text-zinc-400 border-zinc-600/50",
};

function tierBadgeClass(tier: string | null): string {
  if (!tier) return "bg-zinc-800/80 text-zinc-500 border-zinc-600/50";
  return TIER_STYLES[tier] ?? TIER_STYLES.unknown;
}

export function CompatibilityPanel({
  onClose,
  platformFamily,
  canPersist,
  steamAppId,
  protonVersion,
  onPatch,
}: {
  onClose: () => void;
  platformFamily: PlatformFamily;
  canPersist: boolean;
  steamAppId: string | null | undefined;
  protonVersion: string | null | undefined;
  onPatch: (patch: { steamAppId?: string | null; protonVersion?: string | null }) => void;
}) {
  const [search, setSearch] = useState("");
  const [appIdInput, setAppIdInput] = useState(steamAppId?.trim() ?? "");
  const [logByVerb, setLogByVerb] = useState<Record<string, string>>({});
  const [runningVerb, setRunningVerb] = useState<string | null>(null);
  const [doneSession, setDoneSession] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setAppIdInput(steamAppId?.trim() ?? "");
  }, [steamAppId]);

  const { data: protonList } = useQuery({
    queryKey: ["compat", "proton", "list"],
    queryFn: () => invoke<{ versions: string[] }>(IpcChannel.COMPAT_PROTON_LIST),
    staleTime: 60_000,
  });

  const appIdDigits = useMemo(() => (steamAppId ?? "").replace(/\D/g, ""), [steamAppId]);

  const { data: protonDb, isFetching: protonDbLoading } = useQuery({
    queryKey: ["compat", "protondb", appIdDigits],
    queryFn: () => invoke<{ tier: string | null; raw?: string }>(IpcChannel.COMPAT_PROTONDB_GET, { appId: appIdDigits }),
    enabled: appIdDigits.length > 0,
    staleTime: 300_000,
    retry: false,
  });

  useEffect(() => {
    const offLog = window.api.on(WINETRICKS_LOG_CHANNEL, (payload: unknown) => {
      const p = payload as { verb?: string; line?: string };
      if (!p.verb || p.line == null) return;
      setLogByVerb((prev) => ({ ...prev, [p.verb]: (prev[p.verb] ?? "") + p.line }));
    });
    const offDone = window.api.on(WINETRICKS_DONE_CHANNEL, (payload: unknown) => {
      const p = payload as { verb?: string; ok?: boolean };
      if (!p.verb) return;
      setRunningVerb(null);
      if (p.ok) setDoneSession((s) => new Set(s).add(p.verb!));
    });
    return () => {
      offLog();
      offDone();
    };
  }, []);

  const runVerb = useCallback(async (verb: string) => {
    setRunningVerb(verb);
    setLogByVerb((prev) => ({ ...prev, [verb]: "" }));
    try {
      const r = await invoke<{ ok: boolean; error?: string }>(IpcChannel.COMPAT_WINETRICKS_RUN, { verb });
      if (!r.ok) setRunningVerb(null);
    } catch {
      setRunningVerb(null);
    }
  }, []);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return WINETRICKS_GROUPS;
    return WINETRICKS_GROUPS.map((g) => ({
      ...g,
      verbs: g.verbs.filter((v) => v.toLowerCase().includes(q)),
    })).filter((g) => g.verbs.length > 0);
  }, [search]);

  const showLinux = platformFamily === "linux";
  const showWinetricks = showLinux;

  return (
    <GameDetailSidePanel title="Compatibility" onClose={onClose}>
      {!canPersist && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200/90">
          Add this game to your library to save compatibility settings.
        </p>
      )}

      {showLinux && (
        <section className="mb-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#666]">Proton version</h3>
          <select
            value={protonVersion ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onPatch({ protonVersion: v.length ? v : null });
            }}
            disabled={!canPersist}
            className="w-full rounded-lg border border-[#2a2a2a] bg-[#111] px-3 py-2 text-[12px] text-[#ddd] outline-none focus:border-[#3a67f0]"
          >
            <option value="">System default</option>
            {(protonList?.versions ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[10px] leading-relaxed text-[#555]">
            Detected from ~/.steam/steam/compatibilitytools.d and steamapps/common (folders starting with Proton).
          </p>
        </section>
      )}

      <section className="mb-6">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#666]">ProtonDB</h3>
        {appIdDigits ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {protonDbLoading ? (
                <span className="text-[11px] text-[#666]">Loading…</span>
              ) : protonDb?.tier ? (
                <span
                  className={cn(
                    "inline-flex rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                    tierBadgeClass(protonDb.tier),
                  )}
                >
                  {protonDb.tier}
                </span>
              ) : (
                <span className="text-[11px] text-[#666]">No data</span>
              )}
              <span className="text-[10px] text-[#555]">App ID: {appIdDigits}</span>
            </div>
            <div className="flex gap-2">
              <input
                value={appIdInput}
                onChange={(e) => setAppIdInput(e.target.value)}
                placeholder="Change app ID"
                className="min-w-0 flex-1 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 font-mono text-[11px] text-white outline-none focus:border-[#3a67f0]"
              />
              <button
                type="button"
                disabled={!canPersist}
                onClick={() => onPatch({ steamAppId: appIdInput.replace(/\D/g, "") || null })}
                className="shrink-0 rounded bg-[#2a2a2a] px-2 py-1 text-[10px] text-[#ccc] hover:bg-[#3a3a3a] disabled:opacity-50"
              >
                Update
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-[#777]">Set a Steam app ID to load the community tier.</p>
            <div className="flex gap-2">
              <input
                value={appIdInput}
                onChange={(e) => setAppIdInput(e.target.value)}
                placeholder="e.g. 1091500"
                className="min-w-0 flex-1 rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 font-mono text-[12px] text-white outline-none focus:border-[#3a67f0]"
              />
              <button
                type="button"
                disabled={!canPersist}
                onClick={() => onPatch({ steamAppId: appIdInput.replace(/\D/g, "") || null })}
                className="shrink-0 rounded bg-[#2563eb] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        )}
        {appIdDigits ? (
          <button
            type="button"
            disabled={!canPersist}
            onClick={() => {
              setAppIdInput("");
              onPatch({ steamAppId: null });
            }}
            className="mt-2 text-[11px] text-[#3a67f0] hover:text-white disabled:opacity-50"
          >
            Clear app ID
          </button>
        ) : null}
      </section>

      {showWinetricks && (
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#666]">Winetricks</h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search verbs…"
            className="mb-3 w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1.5 text-[12px] text-white outline-none focus:border-[#3a67f0]"
          />
          <div className="space-y-4">
            {filteredGroups.map((g) => (
              <div key={g.title}>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-[#555]">{g.title}</p>
                <ul className="space-y-2">
                  {g.verbs.map((verb) => (
                    <li
                      key={verb}
                      className="flex flex-col gap-1 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-[11px] text-[#aaa]">{verb}</code>
                        <div className="flex items-center gap-2">
                          {doneSession.has(verb) && (
                            <span className="text-[10px] font-medium text-emerald-500" title="Completed this session">
                              Done
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={runningVerb !== null}
                            onClick={() => runVerb(verb)}
                            className="rounded bg-[#2a2a2a] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#3a3a3a] disabled:opacity-50"
                          >
                            {runningVerb === verb ? "Running…" : "Run"}
                          </button>
                        </div>
                      </div>
                      {(logByVerb[verb] ?? "").length > 0 && (
                        <pre className="max-h-24 overflow-auto rounded bg-black/40 p-2 font-mono text-[9px] leading-relaxed text-[#888]">
                          {logByVerb[verb]}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {!showLinux && (
        <p className="text-[11px] leading-relaxed text-[#666]">
          Proton and winetricks tools are listed when the app runs on Linux. On this system, use Launch options for
          environment and arguments only.
        </p>
      )}
    </GameDetailSidePanel>
  );
}
