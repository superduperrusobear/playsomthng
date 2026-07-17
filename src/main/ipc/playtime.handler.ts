import { IpcMain } from "electron";
import { IpcChannel } from "../../shared/schemas";

// In-memory playtime store per session. Swap for persistent DB later.
const playtimeMap = new Map<string, { totalMinutes: number; sessions: number; lastPlayedAt: string; startedAt?: number }>();

export function playtimeStart(gameId: string) {
  const existing =
    playtimeMap.get(gameId) ?? { totalMinutes: 0, sessions: 0, lastPlayedAt: new Date().toISOString() };
  playtimeMap.set(gameId, { ...existing, startedAt: Date.now() });
}

export function playtimeStop(gameId: string) {
  const entry = playtimeMap.get(gameId);
  if (!entry?.startedAt) {
    return { stopped: false };
  }

  const elapsedMinutes = Math.floor((Date.now() - entry.startedAt) / 60000);
  playtimeMap.set(gameId, {
    totalMinutes: entry.totalMinutes + elapsedMinutes,
    sessions: entry.sessions + 1,
    lastPlayedAt: new Date().toISOString(),
  });

  return { stopped: true, minutesAdded: elapsedMinutes };
}

export function registerPlaytimeHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.PLAYTIME_GET, async () => {
    return Array.from(playtimeMap.entries()).map(([gameId, data]) => ({
      gameId,
      totalMinutes: data.totalMinutes,
      sessions: data.sessions,
      lastPlayedAt: data.lastPlayedAt,
    }));
  });

  ipcMain.handle(IpcChannel.PLAYTIME_START, async (_event, { gameId }: { gameId: string }) => {
    playtimeStart(gameId);
    return { started: true };
  });

  ipcMain.handle(IpcChannel.PLAYTIME_STOP, async (_event, { gameId }: { gameId: string }) => {
    return playtimeStop(gameId) ?? { stopped: false };
  });
}
