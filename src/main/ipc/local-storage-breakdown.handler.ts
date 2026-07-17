import type { IpcMain } from "electron";
import { IpcChannel, LocalStorageBreakdownSchema } from "../../shared/schemas";
import { getLocalStorageBreakdown } from "../services/local-storage-breakdown.service";

export function registerLocalStorageBreakdownHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.LOCAL_STORAGE_BREAKDOWN_GET, async () => {
    const raw = await getLocalStorageBreakdown();
    return LocalStorageBreakdownSchema.parse(raw);
  });
}
