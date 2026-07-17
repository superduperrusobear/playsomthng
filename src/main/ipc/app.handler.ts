import { IpcMain, BrowserWindow, app, dialog, shell } from "electron";
import path from "node:path";
import { IpcChannel } from "../../shared/schemas";
import { logger } from "../utils/logger";

function executableDialogFilters(): Electron.FileFilter[] {
  switch (process.platform) {
    case "win32":
      return [
        { name: "Executables", extensions: ["exe", "bat", "cmd", "msi"] },
        { name: "Shortcuts", extensions: ["lnk"] },
        { name: "All files", extensions: ["*"] },
      ];
    case "darwin":
      return [
        { name: "Applications", extensions: ["app"] },
        { name: "Scripts & binaries", extensions: ["command", "sh", "bin"] },
        { name: "All files", extensions: ["*"] },
      ];
    default:
      return [
        { name: "AppImage / scripts / binaries", extensions: ["AppImage", "sh", "bin", "run", "x86_64"] },
        { name: "Packages", extensions: ["deb", "rpm", "snap"] },
        { name: "All files", extensions: ["*"] },
      ];
  }
}

export function registerAppHandlers(ipcMain: IpcMain, win: BrowserWindow) {
  ipcMain.handle(IpcChannel.APP_VERSION, () => app.getVersion());

  ipcMain.on(IpcChannel.APP_MINIMIZE, () => win.minimize());

  ipcMain.on(IpcChannel.APP_MAXIMIZE, () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on(IpcChannel.APP_CLOSE, () => win.close());

  ipcMain.on(IpcChannel.APP_OPEN_LOGS, () => {
    const logsDir = path.join(app.getPath("userData"), "logs");
    shell.openPath(logsDir).catch(console.error);
  });

  ipcMain.handle(IpcChannel.APP_LOG_ERROR, async (_e, raw: { message?: string }) => {
    void logger.error("[RENDERER]", raw?.message ?? String(raw));
    return { ok: true as const };
  });

  ipcMain.handle(IpcChannel.DIALOG_PICK_EXECUTABLE, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? win;
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: "Select game executable",
      properties: ["openFile"],
      filters: executableDialogFilters(),
    });
    if (canceled || filePaths.length === 0) return { path: null };
    return { path: filePaths[0] };
  });
}
