import type { IpcMain } from "electron";
import { IpcChannel, LocalDownloadsFileSchema } from "../../shared/schemas";
import { loadLocalDownloadsFile, saveLocalDownloadsFile } from "../services/local-downloads-file.service";

export function registerLocalDownloadsFileHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.LOCAL_DOWNLOADS_GET, async () => {
    return loadLocalDownloadsFile();
  });

  ipcMain.handle(IpcChannel.LOCAL_DOWNLOADS_SET, async (_event, raw) => {
    const data = LocalDownloadsFileSchema.parse(raw);
    await saveLocalDownloadsFile(data);
    return data;
  });
}
