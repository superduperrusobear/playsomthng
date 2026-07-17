import { useState } from "react";
import { Server, CheckCircle, XCircle, Edit2, Save, X } from "lucide-react";
import { SettingsBackLink } from "./SettingsBackLink";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import type { LibrarySource } from "@shared/schemas";

function SourceRow({
  source,
  onSave,
  saving,
}: {
  source: LibrarySource;
  onSave: (updated: LibrarySource) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source.baseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);

  function validateUrl(value: string): string | null {
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "Must be http or https";
      return null;
    } catch {
      return "Enter a valid URL (e.g. http://192.168.1.10:3000)";
    }
  }

  function handleEdit() {
    setDraft(source.baseUrl);
    setUrlError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setUrlError(null);
  }

  function handleSave() {
    const trimmed = draft.trim().replace(/\/$/, "");
    const err = validateUrl(trimmed);
    if (err) {
      setUrlError(err);
      return;
    }
    setUrlError(null);
    onSave({ ...source, baseUrl: trimmed });
    setEditing(false);
  }

  function handleToggleEnabled() {
    onSave({ ...source, enabled: !source.enabled });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-[#0f0f0f] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-[#5a5a5a]" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="font-title text-[13px] tracking-[0.06em] text-white/90">{source.name}</p>
            {!editing && (
              <p className="mt-0.5 break-all font-mono text-[10px] text-[#6a6a6a]">{source.baseUrl}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleToggleEnabled}
            disabled={saving}
            title={source.enabled ? "Disable this source" : "Enable this source"}
            className="text-[#5a5a5a] transition hover:text-[#aaa] disabled:opacity-40"
          >
            {source.enabled ? (
              <CheckCircle className="h-4 w-4 text-[#4a8a4a]" strokeWidth={1.75} />
            ) : (
              <XCircle className="h-4 w-4 text-[#7a4a4a]" strokeWidth={1.75} />
            )}
          </button>

          {!editing && (
            <button
              type="button"
              onClick={handleEdit}
              disabled={saving}
              title="Edit URL"
              className="rounded p-1 text-[#5a5a5a] transition hover:bg-white/5 hover:text-[#aaa] disabled:opacity-40"
            >
              <Edit2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-2 pl-7">
          <input
            type="url"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (urlError) setUrlError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            placeholder="http://192.168.1.10:3000"
            autoFocus
            className="w-full rounded-lg border border-white/[0.1] bg-[#181818] px-3 py-2 font-mono text-[12px] text-white/90 placeholder-[#444] outline-none focus:border-white/[0.2]"
          />
          {urlError && (
            <p className="text-[10px] text-red-400/80">{urlError}</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#666] transition hover:text-[#aaa]"
            >
              <X className="h-3 w-3" strokeWidth={2} />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a9a6a] transition hover:text-[#8cbc8c] disabled:opacity-50"
            >
              <Save className="h-3 w-3" strokeWidth={2} />
              Save
            </button>
          </div>
        </div>
      )}

      <div className="pl-7">
        <span
          className={`text-[9px] font-semibold uppercase tracking-[0.14em] ${
            source.enabled ? "text-[#4a8a4a]" : "text-[#7a4a4a]"
          }`}
        >
          {source.enabled ? "Active" : "Disabled"}
        </span>
      </div>
    </div>
  );
}

export function ServerSettingsPage() {
  const { data: settings, isLoading, isError } = useSettings();
  const update = useUpdateSettings();

  function handleSaveSource(updated: LibrarySource) {
    if (!settings) return;
    const sources = settings.sources.map((s) => (s.id === updated.id ? updated : s));
    update.mutate({ sources });
  }

  return (
    <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection>
          <h1 className="font-title text-[clamp(1.5rem,3vw,2rem)] tracking-[0.12em] text-white/95 uppercase">
            Server
          </h1>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[#6a6a6a]">
            Library server connection. Point this at your Proxmox machine&apos;s IP and port (e.g.{" "}
            <span className="font-mono text-[#7a7a7a]">http://192.168.1.10:3000</span>).
          </p>
        </SettingsSection>

        <SettingsSection>
          <p className="mb-3 font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">
            Library sources
          </p>

          {isLoading && (
            <p className="text-[12px] text-[#555]">Loading settings…</p>
          )}

          {isError && (
            <p className="text-[12px] text-red-400/80">Could not load settings.</p>
          )}

          {settings && settings.sources.length === 0 && (
            <p className="text-[12px] text-[#666]">No sources configured.</p>
          )}

          {settings && settings.sources.length > 0 && (
            <div className="flex flex-col gap-3">
              {settings.sources.map((src) => (
                <SourceRow
                  key={src.id}
                  source={src}
                  onSave={handleSaveSource}
                  saving={update.isPending}
                />
              ))}
            </div>
          )}

          {update.isError && (
            <p className="mt-3 text-[11px] text-red-400/80">
              Save failed — check the URL is reachable.
            </p>
          )}
        </SettingsSection>

        <SettingsSection>
          <p className="font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">Tips</p>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[#555]">
            <li>
              The server must be running on your Proxmox machine:{" "}
              <span className="font-mono text-[#6a6a6a]">cd server &amp;&amp; cargo run</span>
            </li>
            <li>
              Make sure <span className="font-mono text-[#6a6a6a]">server/config.json</span> has{" "}
              <span className="font-mono text-[#6a6a6a]">&quot;bind&quot;: &quot;0.0.0.0:3000&quot;</span>{" "}
              so it listens on all network interfaces, not just localhost.
            </li>
            <li>
              Set <span className="font-mono text-[#6a6a6a]">publicBaseUrl</span> in{" "}
              <span className="font-mono text-[#6a6a6a]">server/config.json</span> to{" "}
              <span className="font-mono text-[#6a6a6a]">http://&lt;your-ip&gt;:3000</span> so manifest
              and CDN links resolve correctly on client machines.
            </li>
          </ul>
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
