import { IpcMain } from "electron";
import { IpcChannel, IpcRequestSchema } from "../../shared/schemas";
import {
  ensureSystemInfoCollected,
  getCachedSystemInfo,
  refreshSystemInfo,
  checkDiskSpace,
} from "../services/sysinfo.service";
import { getDirectorySizeBytes } from "../services/install.service";

export function registerSysinfoHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.SYSINFO_GET, async () => {
    const snap = getCachedSystemInfo();
    if (snap !== null) return snap;
    return ensureSystemInfoCollected();
  });

  ipcMain.handle(IpcChannel.SYSINFO_REFRESH, async () => refreshSystemInfo());

  ipcMain.handle(IpcChannel.SYSINFO_DISK_CHECK, async (_event, raw: unknown) => {
    const { requiredBytes, preferredMount } = IpcRequestSchema[IpcChannel.SYSINFO_DISK_CHECK].parse(raw);
    return checkDiskSpace(requiredBytes, preferredMount ?? null);
  });

  /** Recursive size of a file or directory — used by Settings → Storage (game install folders). */
  ipcMain.handle(IpcChannel.FS_DIR_SIZE_BYTES, async (_e, raw: unknown) => {
    const { path: targetPath } = IpcRequestSchema[IpcChannel.FS_DIR_SIZE_BYTES].parse(raw);
    return getDirectorySizeBytes(targetPath);
  });
}
