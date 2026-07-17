import { IpcMain } from "electron";
import { IpcChannel } from "../../shared/schemas";
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

  ipcMain.handle(
    IpcChannel.SYSINFO_DISK_CHECK,
    async (_event, payload: { requiredBytes: number; preferredMount?: string | null }) => {
      return checkDiskSpace(payload.requiredBytes, payload.preferredMount);
    }
  );

  /** Recursive size of a file or directory — used by Settings → Storage (game install folders). */
  ipcMain.handle(IpcChannel.FS_DIR_SIZE_BYTES, async (_e, raw: { path: string }) => {
    return getDirectorySizeBytes(raw.path);
  });
}
