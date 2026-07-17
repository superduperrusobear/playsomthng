import type { LaunchFlags } from "./schemas/launch-compat.schema";
import type { PlatformFamily } from "./schemas/app-paths.schema";

/** Whether the main process should spawn via shell (wrappers / raw suffix / env on Windows). */
export function needsShellLaunch(
  platformFamily: PlatformFamily,
  flags: LaunchFlags | null | undefined,
): boolean {
  if (!flags) return false;
  const f = flags;
  const custom = !!(f.customFlags && f.customFlags.trim());
  if (platformFamily === "linux") {
    return !!(
      f.gameMode ||
      f.mangoHud ||
      f.gamescope ||
      f.skipIntro ||
      f.windowed ||
      custom
    );
  }
  return !!(f.skipIntro || f.windowed || custom);
}

export const DEFAULT_GAMESCOPE_W = 1920;
export const DEFAULT_GAMESCOPE_H = 1080;

function shellQuotePosix(s: string): string {
  if (/[^a-zA-Z0-9_./+=:@%-]/.test(s)) {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
  return s;
}

function shellQuoteWin(s: string): string {
  if (/[\s"&]/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Human-readable preview of the command the app will run (matches main-process launch on Linux).
 */
export function formatLaunchCommandPreview(args: {
  execPath: string;
  launchFlags?: LaunchFlags | null;
  platformFamily: PlatformFamily;
}): string {
  const { execPath, platformFamily } = args;
  const f = args.launchFlags ?? {};
  const custom = (f.customFlags ?? "").trim();

  if (platformFamily === "linux") {
    const parts: string[] = [];
    if (f.skipIntro) parts.push("env", "SKIP_INTRO=1");
    if (f.gameMode) parts.push("gamemoderun");
    if (f.mangoHud) parts.push("mangohud");
    if (f.gamescope) {
      const w = f.gamescopeWidth ?? DEFAULT_GAMESCOPE_W;
      const h = f.gamescopeHeight ?? DEFAULT_GAMESCOPE_H;
      parts.push("gamescope", "-w", String(w), "-h", String(h));
      if (f.gamescopeFullscreen !== false) parts.push("-f");
      parts.push("--");
    }
    parts.push(shellQuotePosix(execPath));
    if (f.windowed) parts.push("-windowed");
    let line = parts.join(" ");
    if (custom) line += (line.endsWith(" ") ? "" : " ") + custom;
    return line;
  }

  if (platformFamily === "windows") {
    const inner = [shellQuoteWin(execPath), f.windowed ? "-windowed" : "", custom].filter(Boolean).join(" ");
    if (f.skipIntro) return `set SKIP_INTRO=1 && ${inner}`;
    return inner;
  }

  // darwin / other
  let line = shellQuotePosix(execPath);
  if (f.windowed) line += " -windowed";
  if (custom) line += " " + custom;
  if (f.skipIntro) line = `SKIP_INTRO=1 ${line}`;
  return line;
}
