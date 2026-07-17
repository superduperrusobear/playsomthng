import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { WebContents } from "electron";
import { WINETRICKS_DONE_CHANNEL, WINETRICKS_LOG_CHANNEL } from "../../shared/compatChannels";

const PROTON_PREFIX = /^proton/i;

const ALLOWED_WINETRICKS_VERBS = new Set([
  "vcrun2022",
  "vcrun2019",
  "dotnet48",
  "dotnet6",
  "xna40",
  "d3dx11",
  "d3dx9",
  "dxvk",
  "openal",
  "corefonts",
]);

export function isAllowedWinetricksVerb(verb: string): boolean {
  return ALLOWED_WINETRICKS_VERBS.has(verb);
}

async function listProtonDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && PROTON_PREFIX.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Steam Proton compatibility tool folder names under ~/.steam/steam/...
 */
export async function listProtonVersions(): Promise<string[]> {
  if (process.platform !== "linux") return [];
  const home = os.homedir();
  const roots = [
    path.join(home, ".steam", "steam", "compatibilitytools.d"),
    path.join(home, ".steam", "steam", "steamapps", "common"),
  ];
  const set = new Set<string>();
  for (const r of roots) {
    for (const name of await listProtonDirs(r)) set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type ProtonDbTier = "platinum" | "gold" | "silver" | "bronze" | "borked" | "pending" | "unknown";

export async function fetchProtonDbSummary(appId: string): Promise<{ tier: ProtonDbTier | null; raw?: string }> {
  const id = appId.replace(/\D/g, "");
  if (!id) return { tier: null };
  try {
    const url = `https://www.protondb.com/api/v1/reports/summaries/${id}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { tier: null };
    const data = (await res.json()) as { tier?: string; bestReportedTier?: string };
    const raw = (data.tier ?? data.bestReportedTier ?? "").toLowerCase();
    if (!raw) return { tier: null };
    const tier = raw as ProtonDbTier;
    const known: ProtonDbTier[] = ["platinum", "gold", "silver", "bronze", "borked", "pending", "unknown"];
    if (known.includes(tier)) return { tier, raw };
    return { tier: "unknown", raw };
  } catch {
    return { tier: null };
  }
}

export function runWinetricksVerb(
  verb: string,
  contents: WebContents,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAllowedWinetricksVerb(verb)) {
    return Promise.resolve({ ok: false, error: "Verb not allowed" });
  }
  if (process.platform === "win32") {
    return Promise.resolve({ ok: false, error: "Winetricks is not available on Windows" });
  }

  return new Promise((resolve) => {
    const child = spawn("winetricks", [verb], {
      shell: process.platform === "darwin",
      env: process.env,
    });

    const send = (line: string) => {
      contents.send(WINETRICKS_LOG_CHANNEL, { verb, line });
    };

    child.stdout?.on("data", (buf: Buffer) => {
      send(buf.toString());
    });
    child.stderr?.on("data", (buf: Buffer) => {
      send(buf.toString());
    });

    child.on("error", (err) => {
      contents.send(WINETRICKS_DONE_CHANNEL, { verb, ok: false, code: -1 });
      resolve({ ok: false, error: err.message });
    });

    child.on("close", (code) => {
      const ok = code === 0;
      contents.send(WINETRICKS_DONE_CHANNEL, { verb, ok, code: code ?? -1 });
      resolve({ ok, error: ok ? undefined : `Exit code ${code}` });
    });
  });
}
