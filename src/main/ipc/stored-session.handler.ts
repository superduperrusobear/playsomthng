import type { IpcMain } from "electron";
import { z } from "zod";
import { IpcChannel, StoredUserSessionSchema } from "../../shared/schemas";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "../services/stored-session.service";

const SetPayloadSchema = z.union([StoredUserSessionSchema, z.null()]);

export function registerStoredSessionHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.AUTH_SESSION_GET, async () => {
    return loadStoredSession();
  });

  ipcMain.handle(IpcChannel.AUTH_SESSION_SET, async (_event, raw) => {
    const payload = SetPayloadSchema.parse(raw);
    if (payload === null) {
      await clearStoredSession();
      return null;
    }
    await saveStoredSession(payload);
    return StoredUserSessionSchema.parse(payload);
  });
}
