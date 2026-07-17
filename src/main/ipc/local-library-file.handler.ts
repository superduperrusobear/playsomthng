import type { IpcMain } from "electron";
import { IpcChannel, LocalLibraryFileSchema } from "../../shared/schemas";
import { loadLocalLibraryFile, saveLocalLibraryFile } from "../services/local-library-file.service";

export function registerLocalLibraryFileHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.LOCAL_LIBRARY_GET, async () => {
    return loadLocalLibraryFile();
  });

  ipcMain.handle(IpcChannel.LOCAL_LIBRARY_SET, async (_event, raw) => {
    const data = LocalLibraryFileSchema.parse(raw);
    await saveLocalLibraryFile(data);
    return data;
  });
}
