import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../store/auth.store";
import { SettingsBackLink } from "./SettingsBackLink";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { usePlaytime } from "../../hooks/usePlaytime";
import { useLibrary } from "../../hooks/useLibrary";
import { invoke } from "../../lib/ipc";
import { IpcChannel, type StoredUserSession } from "@shared/schemas";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function shortHw(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function AccountSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const patchUser = useAuthStore((s) => s.patchUser);
  const { data: playtime } = usePlaytime();
  const { data: library } = useLibrary();

  const { data: devicesData, error: devicesError } = useQuery({
    queryKey: ["authDevices"],
    queryFn: () =>
      invoke<{ devices: { hwHash: string; hostname: string; enrolledAt: string }[] }>(
        IpcChannel.AUTH_DEVICES_GET,
      ),
    staleTime: 60_000,
    retry: 1,
  });

  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of library?.games ?? []) m.set(g.id, g.title);
    return m;
  }, [library]);

  const topPlayed = useMemo(() => {
    const entries = [...(playtime ?? [])].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 5);
    const max = Math.max(1, ...entries.map((e) => e.totalMinutes));
    return entries.map((e) => ({
      ...e,
      title: titleById.get(e.gameId) ?? "Unknown game",
      pct: e.totalMinutes / max,
    }));
  }, [playtime, titleById]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imgTick, setImgTick] = useState(0);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;
    setUploading(true);
    setUploadError(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const contentType = file.type || "image/jpeg";
      const { avatarUrl } = await invoke<{ avatarUrl: string }>(IpcChannel.AUTH_AVATAR_UPLOAD, {
        imageBase64,
        contentType,
      });
      patchUser({ avatarUrl });
      setImgTick((t) => t + 1);

      const session = await invoke<StoredUserSession | null>(IpcChannel.AUTH_SESSION_GET);
      if (session) {
        await invoke(IpcChannel.AUTH_SESSION_SET, { ...session, avatarUrl });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const avatarSrc =
    user?.avatarUrl != null && user.avatarUrl !== ""
      ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}t=${imgTick}`
      : null;

  const devices = devicesData?.devices ?? [];

  return (
    <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection>
          <h1 className="font-title text-[clamp(1.5rem,3vw,2rem)] tracking-[0.12em] text-white/95 uppercase">
            Account
          </h1>

          <div className="mt-10 flex flex-col gap-14 lg:flex-row lg:items-start lg:gap-16">
            <div className="flex flex-col items-start gap-4">
              <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#141414] shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
                {avatarSrc ? (
                  <img
                    key={`${avatarSrc}-${imgTick}`}
                    src={avatarSrc}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-title text-[3rem] leading-none text-white/20">
                    {(user?.username ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
              <button
                type="button"
                disabled={uploading || !token}
                onClick={() => fileRef.current?.click()}
                className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8a8a] transition hover:text-white disabled:opacity-40"
              >
                {uploading ? "Uploading…" : "Change photo"}
              </button>
              {uploadError && <p className="max-w-[16rem] text-[11px] text-[#a07070]">{uploadError}</p>}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#555]">Username</p>
              <p className="font-title text-[clamp(1.25rem,2.5vw,1.75rem)] tracking-[0.08em] text-white/90">
                {user?.username ?? "—"}
              </p>
            </div>
          </div>

          <div className="mt-14 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#555]">Logged in on</p>
            <p className="text-[11px] leading-relaxed text-[#6a6a6a]">
              Machines enrolled for your account (hardware identity from the server).
            </p>
            {devicesError != null && (
              <p className="text-[11px] text-[#8a5a5a]">
                {devicesError instanceof Error ? devicesError.message : "Could not load devices."}
              </p>
            )}
            {devicesError == null && devices.length === 0 && (
              <p className="text-[12px] text-[#666]">No enrolled devices listed yet — sign in from a PC to add one.</p>
            )}
            {devices.length > 0 && (
              <ul className="space-y-2">
                {devices.map((d) => (
                  <li
                    key={d.hwHash}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] py-2 text-[12px] text-[#b0b0b0] last:border-0"
                  >
                    <span className="text-[12px] text-[#c0c0c0]">{d.hostname || "unknown device"}</span>
                    <span className="font-mono text-[10px] text-[#5a5a5a]">{shortHw(d.hwHash)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-14 space-y-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#555]">Most played</p>
            {topPlayed.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-[#666]">Play some games — your top titles show up here.</p>
            ) : (
              <ul className="space-y-4">
                {topPlayed.map((row) => (
                  <li key={row.gameId} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[12px] text-[#b0b0b0]">{row.title}</span>
                      <span className="shrink-0 tabular-nums text-[11px] text-[#666]">{row.totalMinutes} min</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#355a35] via-[#4a7a4a] to-[#5fa060]"
                        style={{ width: `${Math.round(row.pct * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
