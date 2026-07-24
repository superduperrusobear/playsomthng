import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { SettingsBackLink } from "./SettingsBackLink";
import { useAdminCatalog } from "../../hooks/useLibrary";
import { useSaveCatalogMeta } from "../../hooks/useCatalogMeta";
import { useAdminUsers, useAudit, useAdminActions, type AdminUser, type AuditEntry } from "../../hooks/useAdmin";
import { invoke } from "../../lib/ipc";
import { IpcChannel, type CatalogMeta, type GameListItem } from "@shared/schemas";
import { cn } from "../../lib/cn";
import { useAuthStore } from "../../store/auth.store";

type Tab = "library" | "users" | "logs";

const TABS: { id: Tab; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "users", label: "Users" },
  { id: "logs", label: "Logs" },
];

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("library");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection className="py-7">
          <h1 className="font-title text-[clamp(1.5rem,3vw,2rem)] uppercase tracking-[0.12em] text-white/95">
            Admin
          </h1>

          <div className="mt-4 flex gap-1 border-b border-white/[0.07]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
                  tab === t.id ? "text-white" : "text-[#666] hover:text-[#aaa]",
                )}
              >
                {t.label}
                {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-white/80" />}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {tab === "library" && <LibraryTab />}
            {tab === "users" && <UsersTab />}
            {tab === "logs" && <LogsTab />}
          </div>
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}

// ── Library ───────────────────────────────────────────────────────────────────

function LibraryTab() {
  const navigate = useNavigate();
  const { data: library, isLoading, isError } = useAdminCatalog();
  const saveMeta = useSaveCatalogMeta();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "published" | "drafts">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const games = (library?.games as GameListItem[]) ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return games.filter((g) => {
      if (filter === "published" && g.publishState !== "published") return false;
      if (filter === "drafts" && g.publishState === "published") return false;
      return !q || g.title.toLowerCase().includes(q);
    });
  }, [games, search, filter]);

  async function setPublished(game: GameListItem, published: boolean) {
    setBusyId(game.id);
    try {
      const meta = await invoke<CatalogMeta>(IpcChannel.CATALOG_META_GET, { id: game.slug });
      await saveMeta.mutateAsync({ ...meta, publishState: published ? "published" : "draft" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search games…"
          className="h-9 flex-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 text-[12px] text-[#ddd] placeholder-[#555] outline-none focus:border-[#444]"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="h-9 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#aaa] outline-none focus:border-[#444]"
        >
          <option value="all">All</option>
          <option value="published">Published</option>
          <option value="drafts">Drafts</option>
        </select>
      </div>

      {isLoading && <p className="text-[12px] text-[#555]">Loading catalog…</p>}
      {isError && <p className="text-[12px] text-red-400/80">Couldn&apos;t load catalog.</p>}

      <div className="max-h-[52vh] space-y-0.5 overflow-y-auto pr-1">
        {filtered.map((g) => {
          const published = g.publishState === "published";
          return (
            <div
              key={g.id}
              className="group flex items-center gap-3 border-b border-white/[0.05] py-3 last:border-b-0"
            >
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", published ? "bg-emerald-500" : "bg-[#444]")}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[#d0d0d0]">{g.title}</span>
              <button
                type="button"
                onClick={() => navigate(`/settings/admin/import/${g.slug}`)}
                className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#666] transition hover:text-[#aaa]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void setPublished(g, !published)}
                disabled={busyId === g.id}
                className={cn(
                  "w-24 shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-40",
                  published
                    ? "text-[#a76f6f] hover:text-[#d89595]"
                    : "text-[#668c69] hover:text-[#91bb95]",
                )}
              >
                {busyId === g.id ? "…" : published ? "Unpublish" : "Publish"}
              </button>
            </div>
          );
        })}
        {!isLoading && filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-[#555]">No games match.</p>
        )}
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersTab() {
  const { data: users, isLoading } = useAdminUsers();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { createUser, deleteUser, revokeUser, issueKey, revokeKey, revokeDevice } = useAdminActions();
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [code, setCode] = useState<{ username: string; key: string } | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    const res = await createUser.mutateAsync({ username: name.trim(), role });
    setCode({ username: res.username, key: res.setupKey });
    setName("");
  }

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (users ?? []).filter((user) =>
      !query || user.username.toLowerCase().includes(query) ||
      user.devices.some((device) => device.hostname.toLowerCase().includes(query)),
    );
  }, [search, users]);

  return (
    <div className="space-y-4">
      <div className="border-b border-white/[0.06] pb-5">
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
            placeholder="username"
            className="h-9 flex-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 text-[12px] text-[#ddd] placeholder-[#555] outline-none focus:border-[#444]"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="h-9 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#aaa] outline-none focus:border-[#444]"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || createUser.isPending}
            className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6f9973] transition hover:text-[#9bc69f] disabled:opacity-40"
          >
            {createUser.isPending ? "…" : "Create"}
          </button>
        </div>
        {createUser.isError && (
          <p className="mt-2 text-[11px] text-red-400/80">
            {createUser.error instanceof Error ? createUser.error.message : "Could not create user."}
          </p>
        )}
        {code && <InviteCallout username={code.username} code={code.key} onClose={() => setCode(null)} />}
      </div>

      {/* List */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a user or machine"
          className="h-9 flex-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 text-[12px] text-[#ddd] placeholder-[#555] outline-none focus:border-[#444]"
        />
      </div>
      {isLoading && <p className="text-[12px] text-[#555]">Loading users…</p>}
      <div>
        {filteredUsers.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUserId}
            onRevoke={() => revokeUser.mutate(u.id)}
            onDelete={() => {
              if (window.confirm(`Delete ${u.username} and every recognized machine? This cannot be undone.`)) {
                deleteUser.mutate(u.id);
              }
            }}
            onRevokeDevice={(hash) => {
              if (window.confirm(`Revoke this machine for ${u.username}?`)) {
                revokeDevice.mutate({ id: u.id, hash });
              }
            }}
            onRevokeKey={() => revokeKey.mutate(u.id)}
            onNewCode={async () => {
              const res = await issueKey.mutateAsync(u.id);
              setCode({ username: u.username, key: res.setupKey });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onRevoke,
  onDelete,
  onRevokeDevice,
  onRevokeKey,
  onNewCode,
}: {
  user: AdminUser;
  isSelf: boolean;
  onRevoke: () => void;
  onDelete: () => void;
  onRevokeDevice: (hash: string) => void;
  onRevokeKey: () => void;
  onNewCode: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = user.devices.length;
  const stateText = user.blocked
    ? "Revoked"
    : `${count} machine${count === 1 ? "" : "s"}`;

  return (
    <div className="border-b border-white/[0.055] last:border-b-0">
      <div className="flex items-center gap-3 py-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={count === 0}
          className={cn("shrink-0 text-[10px] text-[#555] transition-transform disabled:opacity-0", open && "rotate-90")}
          title={count ? "Show machines" : "No machines"}
        >
          ▶
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[#d0d0d0]">{user.username}</span>
          {user.createdAt && <span className="block text-[9px] text-[#4f4f4f]">Created {fmtActivity(user.createdAt)}</span>}
        </span>
        <span className={cn(
          "shrink-0 text-[9px] font-semibold uppercase tracking-wide",
          user.blocked ? "text-[#b67878]" : "text-[#666]",
        )}>
          {stateText}
        </span>
        <span className={cn(
          "shrink-0 text-[9px] font-semibold uppercase tracking-wide",
          user.role === "admin" ? "text-[#7899b2]" : "text-[#555]",
        )}>
          {user.role}
        </span>
        {isSelf && (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[#888]">
            You
          </span>
        )}
        {user.hasPendingKey && (
          <button
            type="button"
            onClick={onRevokeKey}
            className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-400/75 hover:text-amber-300"
            title="Cancel the unused invite code"
          >
            Invite ready ×
          </button>
        )}
        <button
          type="button"
          onClick={onNewCode}
          className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#666] transition hover:text-[#aaa]"
        >
          New code
        </button>
        {!isSelf && !user.blocked && (
          <button
            type="button"
            onClick={onRevoke}
            className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#a76] transition hover:text-[#c98]"
            title="Block this account (keeps their app open, denies downloads)"
          >
            Revoke
          </button>
        )}
        {!isSelf && (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#853] transition hover:text-[#c55]"
          >
            Delete
          </button>
        )}
      </div>

      {open && count > 0 && (
        <div className="pb-4 pl-7">
          <div className="mb-2 grid grid-cols-[minmax(9rem,1fr)_8rem_8rem_8rem_auto] gap-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#4f4f4f]">
            <span>Machine</span><span>Recognized</span><span>Last seen</span><span>Last download</span><span />
          </div>
          {user.devices.map((d) => (
            <div key={d.hwHash} className="grid grid-cols-[minmax(9rem,1fr)_8rem_8rem_8rem_auto] items-center gap-3 border-t border-white/[0.035] py-2 text-[11px] first:border-0">
              <span className="min-w-0">
                <span className="block truncate text-[#bbb]">{d.hostname || "Unknown machine"}</span>
                <span className="block font-mono text-[9px] text-[#4f4f4f]">{d.hwHash.slice(0, 12)}</span>
              </span>
              <span className="text-[10px] text-[#666]">{fmtActivity(d.enrolledAt)}</span>
              <span className="text-[10px] text-[#777]">{fmtActivity(d.lastSeenAt)}</span>
              <span className="text-[10px] text-[#777]">{fmtActivity(d.lastDownloadAt)}</span>
              {isSelf ? (
                <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#555]">Your device</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRevokeDevice(d.hwHash)}
                  className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#a76] transition hover:text-[#c98]"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtActivity(ts: string | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function InviteCallout({ username, code, onClose }: { username: string; code: string; onClose: () => void }) {
  return (
    <div className="mt-4 border-y border-emerald-500/20 py-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-emerald-400/80">
        Invite code for {username}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 select-all font-mono text-[15px] tracking-wide text-white">{code}</code>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(code)}
          className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#888] hover:text-white"
        >
          Copy
        </button>
        <button type="button" onClick={onClose} className="text-[#666] hover:text-[#aaa]">✕</button>
      </div>
    </div>
  );
}

// ── Logs ──────────────────────────────────────────────────────────────────────

const LOG_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "revocations", label: "Revocations" },
  { id: "login,login_denied", label: "Logins" },
  { id: "download,download_denied,access_denied", label: "Downloads" },
  { id: "user_created,user_deleted,key_issued,game_added,game_updated", label: "Changes" },
];

const EVENT_COLOR: Record<string, string> = {
  login: "text-emerald-400",
  login_denied: "text-[#c88]",
  download: "text-[#8ab4d4]",
  download_denied: "text-amber-400",
  access_denied: "text-[#c88]",
  user_revoked: "text-[#c88]",
  device_revoked: "text-[#c88]",
  user_deleted: "text-[#c55]",
  user_created: "text-emerald-400",
  key_issued: "text-amber-400",
  key_revoked: "text-[#a76]",
  game_added: "text-emerald-400",
  game_updated: "text-[#8ab4d4]",
  audit_cleared: "text-[#c88]",
};

function LogsTab() {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const { data: entries, isLoading, isError } = useAudit(filter, search);
  const { clearAudit } = useAdminActions();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {LOG_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "border-b px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                filter === f.id ? "border-white/70 text-white" : "border-transparent text-[#666] hover:text-[#aaa]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search user, game, machine, IP, reason"
          className="h-8 min-w-[15rem] flex-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-3 text-[11px] text-[#ddd] placeholder-[#555] outline-none focus:border-[#444]"
        />
        <button
          type="button"
          disabled={clearAudit.isPending || isLoading}
          onClick={() => {
            if (window.confirm("Clear the audit log? A record of this action will remain.")) {
              clearAudit.mutate();
            }
          }}
          className="h-8 rounded-lg border border-[#3b2929] px-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#a76] hover:border-[#684040] hover:text-[#c98] disabled:opacity-30"
        >
          {clearAudit.isPending ? "Clearing…" : "Clear logs"}
        </button>
      </div>

      {isLoading && <p className="text-[12px] text-[#555]">Loading…</p>}
      {isError && <p className="text-[12px] text-red-400/80">Couldn&apos;t load logs.</p>}

      <div className="max-h-[54vh] space-y-1 overflow-y-auto pr-1 font-mono">
        {(entries ?? []).map((e, i) => (
          <details key={`${e.ts}-${e.event}-${i}`} className="group border-b border-white/[0.045] py-2 last:border-b-0">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 text-[11px] marker:hidden">
              <span className="w-3 shrink-0 text-[8px] text-[#444] transition-transform group-open:rotate-90">▶</span>
              <span className="w-36 shrink-0 text-[#555]">{fmtTime(e.ts)}</span>
              <span className={cn("w-32 shrink-0 font-semibold", EVENT_COLOR[e.event] ?? "text-[#999]")}>
                {e.event}
              </span>
              <span className="min-w-0 flex-1 truncate text-[#888]">{summarize(e)}</span>
            </summary>
            <div className="ml-[18.25rem] mt-2 flex flex-wrap gap-x-4 gap-y-1 pb-1 text-[10px]">
              {auditFields(e).map(([key, value]) => (
                <span key={key} className="text-[#666]"><span className="text-[#444]">{key}</span> {value}</span>
              ))}
            </div>
          </details>
        ))}
        {!isLoading && (entries ?? []).length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-[#555]">Nothing logged yet.</p>
        )}
      </div>
    </div>
  );
}

function fmtTime(ts: unknown): string {
  if (typeof ts !== "string") return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function summarize(e: Record<string, unknown>): string {
  const parts: string[] = [];
  const s = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : undefined);
  if (s("user")) parts.push(s("user")!);
  if (s("game")) parts.push(`→ ${s("game")}`);
  if (s("hostname")) parts.push(`(${s("hostname")})`);
  if (s("reason")) parts.push(`· ${s("reason")}`);
  if (s("by")) parts.push(`by ${s("by")}`);
  if (s("ip")) parts.push(`· ${s("ip")}`);
  return parts.join(" ");
}

function auditFields(entry: AuditEntry): [string, string][] {
  return Object.entries(entry)
    .filter(([key]) => key !== "ts" && key !== "event")
    .map(([key, value]): [string, string] => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
}
