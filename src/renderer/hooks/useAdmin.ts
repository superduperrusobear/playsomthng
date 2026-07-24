import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../lib/ipc";
import { IpcChannel } from "@shared/schemas";

export interface AdminDevice {
  hwHash: string;
  hostname: string;
  enrolledAt: string;
  lastSeenAt: string;
  lastDownloadAt: string | null;
}
export interface AdminUser {
  id: string;
  username: string;
  role: "admin" | "user";
  createdAt: string;
  hasPendingKey: boolean;
  blocked: boolean;
  devices: AdminDevice[];
}
export interface AuditEntry {
  ts: string;
  event: string;
  [k: string]: unknown;
}

function adminApi<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  return invoke<T>(IpcChannel.ADMIN_API, { method, path, ...(body != null ? { body } : {}) });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => adminApi<{ users: AdminUser[] }>("GET", "/api/admin/users").then((r) => r.users),
    staleTime: 15_000,
  });
}

export function useAudit(events: string, search = "", limit = 200) {
  return useQuery({
    queryKey: ["admin", "audit", events, search, limit],
    queryFn: () => {
      const params = new URLSearchParams({ events, search, limit: String(limit) });
      return adminApi<{ entries: AuditEntry[] }>("GET", `/api/admin/audit?${params}`)
        .then((r) => r.entries);
    },
    staleTime: 10_000,
  });
}

export function useAdminActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });

  const createUser = useMutation({
    mutationFn: (v: { username: string; role: "admin" | "user" }) =>
      adminApi<{ id: string; username: string; setupKey: string }>("POST", "/api/admin/users", v),
    onSuccess: refresh,
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => adminApi("DELETE", `/api/admin/users/${id}`),
    onSuccess: refresh,
  });
  const revokeUser = useMutation({
    mutationFn: (id: string) => adminApi("POST", `/api/admin/users/${id}/revoke`),
    onSuccess: refresh,
  });
  const issueKey = useMutation({
    mutationFn: (id: string) =>
      adminApi<{ setupKey: string }>("POST", `/api/admin/users/${id}/key`),
    onSuccess: refresh,
  });
  const revokeKey = useMutation({
    mutationFn: (id: string) => adminApi("POST", `/api/admin/users/${id}/key/revoke`),
    onSuccess: refresh,
  });
  const revokeDevice = useMutation({
    mutationFn: (v: { id: string; hash: string }) =>
      adminApi("POST", `/api/admin/users/${v.id}/devices/${v.hash}/revoke`),
    onSuccess: refresh,
  });

  const clearAudit = useMutation({
    mutationFn: () => adminApi<{ removed: number }>("DELETE", "/api/admin/audit"),
    onSuccess: refresh,
  });

  return { createUser, deleteUser, revokeUser, issueKey, revokeKey, revokeDevice, clearAudit };
}
