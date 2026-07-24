import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Download, Laptop, LogOut, Monitor, Trash2 } from "lucide-react";
import { IpcChannel, type AccountSecurity } from "@shared/schemas";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { useLibrary } from "../../hooks/useLibrary";
import { usePlaytime } from "../../hooks/usePlaytime";
import { invoke } from "../../lib/ipc";
import { useAuthStore } from "../../store/auth.store";
import { SettingsBackLink } from "./SettingsBackLink";

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatWhen(value: string | number | null | undefined): string {
  if (value == null || value === "" || value === 0) return "Never";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-title text-[13px] uppercase tracking-[0.16em] text-white/80">{children}</h2>
      {count != null && <span className="text-[10px] tabular-nums text-[#555]">{count}</span>}
    </div>
  );
}

function TextAction({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[#a96868] outline-none transition hover:text-[#e29a9a] focus-visible:text-[#e29a9a] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function AccountSettingsPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: playtime } = usePlaytime();
  const { data: library } = useLibrary();

  const security = useQuery({
    queryKey: ["accountSecurity"],
    queryFn: () => invoke<AccountSecurity>(IpcChannel.AUTH_SECURITY_GET),
    staleTime: 30_000,
    retry: 1,
  });

  const refreshSecurity = () =>
    queryClient.invalidateQueries({ queryKey: ["accountSecurity"] });

  const removeDevice = useMutation({
    mutationFn: (hwHash: string) => invoke(IpcChannel.AUTH_DEVICE_REVOKE, { hwHash }),
    onSuccess: () => {
      setActionError(null);
      void refreshSecurity();
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "Could not remove device."),
  });

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) =>
      invoke(IpcChannel.AUTH_SESSION_REVOKE, { sessionId }),
    onSuccess: () => {
      setActionError(null);
      void refreshSecurity();
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : "Could not sign out session."),
  });

  const titleById = useMemo(() => {
    const titles = new Map<string, string>();
    for (const game of library?.games ?? []) titles.set(game.id, game.title);
    return titles;
  }, [library]);

  const topPlayed = useMemo(() => {
    const entries = [...(playtime ?? [])]
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, 4);
    const max = Math.max(1, ...entries.map((entry) => entry.totalMinutes));
    return entries.map((entry) => ({
      ...entry,
      title: titleById.get(entry.gameId) ?? "Unknown game",
      percentage: entry.totalMinutes / max,
    }));
  }, [playtime, titleById]);

  const devices = security.data?.devices ?? [];
  const sessions = security.data?.sessions ?? [];

  const confirmRemoveDevice = (hostname: string, hwHash: string) => {
    setActionError(null);
    if (
      window.confirm(
        `Remove ${hostname || "this device"}? It will be signed out and will need a new setup key.`,
      )
    ) {
      removeDevice.mutate(hwHash);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface className="pb-10">
        <SettingsSection className="py-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#667b68]">Account</p>
          <h1 className="mt-2 font-title text-[clamp(1.8rem,4vw,2.7rem)] uppercase tracking-[0.1em] text-white/95">
            {user?.username ?? "Account"}
          </h1>
          <p className="mt-2 text-[11px] text-[#666]">Joined {formatWhen(user?.createdAt)}</p>
        </SettingsSection>

        <SettingsSection className="py-7">
          <SectionTitle count={sessions.length}>Signed-in sessions</SectionTitle>

          {security.isLoading && <p className="mt-5 text-[11px] text-[#666]">Loading…</p>}
          {security.error != null && (
            <p className="mt-5 text-[11px] text-[#a66f6f]">
              {security.error instanceof Error ? security.error.message : "Could not load sessions."}
            </p>
          )}
          {!security.isLoading && security.error == null && sessions.length === 0 && (
            <p className="mt-5 text-[11px] text-[#666]">No active sessions.</p>
          )}

          <div className="mt-4">
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                className="flex flex-col gap-3 border-b border-white/[0.055] py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Laptop size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#666]" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="truncate text-[12px] font-medium text-[#d4d4d4]">{session.hostname}</p>
                      {session.current && (
                        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#739276]">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[#5f5f5f]">
                      <span className="flex items-center gap-1">
                        <Clock3 size={10} /> {formatWhen(session.createdAt)}
                      </span>
                      <span>Expires {formatWhen(session.expiresAt)}</span>
                    </p>
                  </div>
                </div>
                {!session.current && (
                  <TextAction
                    disabled={revokeSession.isPending}
                    onClick={() => revokeSession.mutate(session.sessionId)}
                  >
                    <span className="flex items-center gap-1.5">
                      <LogOut size={11} />
                      {revokeSession.variables === session.sessionId ? "Signing out…" : "Sign out"}
                    </span>
                  </TextAction>
                )}
              </div>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection className="py-7">
          <SectionTitle count={devices.length}>Enrolled devices</SectionTitle>

          {!security.isLoading && devices.length === 0 && (
            <p className="mt-5 text-[11px] text-[#666]">No enrolled devices.</p>
          )}

          <div className="mt-4">
            {devices.map((device) => (
              <div
                key={device.hwHash}
                className="border-b border-white/[0.055] py-5 last:border-b-0"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <Monitor size={17} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#666]" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="truncate text-[12px] font-medium text-[#d7d7d7]">
                          {device.hostname || "Unknown device"}
                        </p>
                        {device.current && (
                          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#739276]">
                            Current machine
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-[9px] tracking-[0.05em] text-[#4f4f4f]">
                        {shortId(device.hwHash)}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-3 gap-x-6 md:min-w-[420px]">
                    <div>
                      <dt className="text-[8px] uppercase tracking-[0.13em] text-[#505050]">Enrolled</dt>
                      <dd className="mt-1 text-[9px] leading-snug text-[#777]">{formatWhen(device.enrolledAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-[8px] uppercase tracking-[0.13em] text-[#505050]">Last seen</dt>
                      <dd className="mt-1 text-[9px] leading-snug text-[#777]">{formatWhen(device.lastSeenAt)}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-[8px] uppercase tracking-[0.13em] text-[#505050]">
                        <Download size={9} /> Download
                      </dt>
                      <dd className="mt-1 text-[9px] leading-snug text-[#777]">{formatWhen(device.lastDownloadAt)}</dd>
                    </div>
                  </dl>
                </div>

                {!device.current && (
                  <div className="mt-3 flex justify-end">
                    <TextAction
                      disabled={removeDevice.isPending}
                      onClick={() => confirmRemoveDevice(device.hostname, device.hwHash)}
                    >
                      <span className="flex items-center gap-1.5">
                        <Trash2 size={11} />
                        {removeDevice.variables === device.hwHash ? "Removing…" : "Remove device"}
                      </span>
                    </TextAction>
                  </div>
                )}
              </div>
            ))}
          </div>

          {actionError && <p className="mt-3 text-[11px] text-[#b87575]">{actionError}</p>}
        </SettingsSection>

        <SettingsSection className="py-7">
          <SectionTitle>Most played</SectionTitle>
          {topPlayed.length === 0 ? (
            <p className="mt-5 text-[11px] text-[#666]">No playtime yet.</p>
          ) : (
            <ul className="mt-5 grid gap-x-10 gap-y-5 md:grid-cols-2">
              {topPlayed.map((row) => (
                <li key={row.gameId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[11px] text-[#aaa]">{row.title}</span>
                    <span className="shrink-0 tabular-nums text-[9px] text-[#5c5c5c]">
                      {row.totalMinutes} min
                    </span>
                  </div>
                  <div className="mt-2 h-px bg-white/[0.055]">
                    <div
                      className="h-px bg-[#6f8d72]"
                      style={{ width: `${Math.round(row.percentage * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
