import { useState } from "react";
import { SettingsBackLink } from "./SettingsBackLink";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerStatus } from "../../hooks/useServerStatus";
import { useAuthStore } from "../../store/auth.store";
import { cn } from "../../lib/cn";
import type { ServerState } from "@shared/schemas";

type Status = { label: string; dot: string; text: string };

function statusFor(state: ServerState | undefined, loading: boolean, revoked: boolean): Status {
  if (revoked) return { label: "Access revoked", dot: "bg-[#b45]", text: "text-[#c88]" };
  if (loading) return { label: "Checking…", dot: "bg-[#555]", text: "text-[#777]" };
  switch (state) {
    case "online":
      return { label: "Live", dot: "bg-emerald-500", text: "text-emerald-400" };
    case "maintenance":
      return { label: "Under maintenance", dot: "bg-amber-500", text: "text-amber-400" };
    case "offline":
      return { label: "Offline", dot: "bg-[#b45]", text: "text-[#c88]" };
    default:
      return { label: "Not connected", dot: "bg-[#555]", text: "text-[#888]" };
  }
}

export function ServerSettingsPage() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const server = useServerStatus();
  const revoked = useAuthStore((s) => s.accessRevoked);

  const savedUrl = settings?.sources.find((s) => s.enabled)?.baseUrl ?? settings?.sources[0]?.baseUrl ?? "";
  const [draft, setDraft] = useState(savedUrl);
  const dirty = draft.trim().replace(/\/+$/, "") !== savedUrl.replace(/\/+$/, "");

  const status = statusFor(server.data?.serverState, server.isLoading || server.isFetching, revoked);

  function save() {
    const trimmed = draft.trim().replace(/\/+$/, "");
    if (!trimmed || !settings) return;
    const sources =
      settings.sources.length > 0
        ? settings.sources.map((s, i) => (i === 0 ? { ...s, baseUrl: trimmed, enabled: true } : s))
        : [{ id: crypto.randomUUID(), name: "Server", baseUrl: trimmed, enabled: true }];
    update.mutate({ sources }, { onSuccess: () => void server.refetch() });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection>
          <h1 className="font-title text-[clamp(1.5rem,3vw,2rem)] uppercase tracking-[0.12em] text-white/95">
            Server
          </h1>

          {/* Status */}
          <div className="mt-5 flex items-center gap-2.5">
            <span className={cn("h-2 w-2 rounded-full", status.dot)} />
            <span className={cn("text-[12px] font-semibold uppercase tracking-[0.14em]", status.text)}>
              {status.label}
            </span>
          </div>
          {revoked && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#a88]">
              Your access to this server was revoked. Contact your administrator.
            </p>
          )}

          {/* Server address */}
          <div className="mt-6 max-w-md">
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6a6a6a]">
              Server address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                spellCheck={false}
                placeholder="https://your-server.com"
                className="h-10 flex-1 rounded-lg border border-[#333] bg-[#181818] px-3 font-mono text-[12px] text-white/90 placeholder-[#444] outline-none transition-colors focus:border-[#555]"
              />
              <button
                type="button"
                onClick={save}
                disabled={!dirty || !draft.trim() || update.isPending}
                className="rounded-lg border border-[#333] bg-[#1a1a1a] px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#bbb] transition-colors hover:border-[#555] hover:text-white disabled:opacity-30"
              >
                {update.isPending ? "…" : "Save"}
              </button>
            </div>
            {update.isError && (
              <p className="mt-2 text-[11px] text-red-400/80">Couldn&apos;t save — check the address.</p>
            )}
          </div>
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
