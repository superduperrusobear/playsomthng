import path from "path";
import { createRequire } from "module";
import { app } from "electron";

const nodeRequire = createRequire(__filename);

type SysInfoModule = {
  collectSystemInfo: () => Promise<unknown>;
  hasSufficientSpace: (requiredBytes: number, preferredMount?: string | null) => Promise<unknown>;
};

function loadSysInfoModule(): SysInfoModule {
  const root = app.getAppPath();
  const modPath = path.join(root, "electron", "sysinfo.js");
  return nodeRequire(modPath) as SysInfoModule;
}

let cached: unknown | null = null;
let collectPromise: Promise<unknown> | null = null;

/** Run once after app.ready; safe to call multiple times — returns same promise / cache. */
export async function ensureSystemInfoCollected(): Promise<unknown> {
  if (cached !== null) return cached;
  if (collectPromise) return collectPromise;

  const { collectSystemInfo } = loadSysInfoModule();
  collectPromise = collectSystemInfo()
    .then((data) => {
      cached = data;
      return data;
    })
    .finally(() => {
      collectPromise = null;
    });

  return collectPromise;
}

export function getCachedSystemInfo(): unknown | null {
  return cached;
}

/** SMBIOS hardware UUID only — sent to the auth server for enrollment (not stored locally). */
export function getHardwareUuidFromSysinfoSnapshot(sys: unknown): string | null {
  const o = sys as { deviceIdentity?: { hardwareUuid?: string | null } } | null;
  const v = o?.deviceIdentity?.hardwareUuid;
  if (v == null || typeof v !== "string") return null;
  const t = v.trim().replace(/^\{|\}$/g, "");
  if (t === "" || t === "-") return null;
  const lower = t.toLowerCase();
  if (lower.includes("o.e.m.") || lower.includes("to be filled")) return null;
  if (lower === "not available" || lower === "default string") return null;
  return lower;
}

export async function refreshSystemInfo(): Promise<unknown> {
  cached = null;
  const { collectSystemInfo } = loadSysInfoModule();
  const data = await collectSystemInfo();
  cached = data;
  return data;
}

export async function checkDiskSpace(
  requiredBytes: number,
  preferredMount?: string | null
): Promise<unknown> {
  const { hasSufficientSpace } = loadSysInfoModule();
  return hasSufficientSpace(requiredBytes, preferredMount ?? null);
}
