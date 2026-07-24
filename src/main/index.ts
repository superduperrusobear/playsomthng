import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { createWindow } from "./window";
import { attachCloseToTray, createTray, destroyTray, markAppQuitting } from "./tray";

// Prevent multiple instances fighting over the same GPU/disk cache
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Suppress GPU shader disk cache errors on Windows — Chromium tries to
// move cache files while OS file locks from a previous instance haven't
// released yet, producing harmless but noisy access-denied errors.
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
import { registerAuthHandlers } from "./ipc/auth.handler";
import { registerLibraryHandlers } from "./ipc/library.handler";
import { registerGameHandlers } from "./ipc/game.handler";
import { registerSettingsHandlers } from "./ipc/settings.handler";
import { registerAppHandlers } from "./ipc/app.handler";
import { registerPlaytimeHandlers } from "./ipc/playtime.handler";
import { registerSysinfoHandlers } from "./ipc/sysinfo.handler";
import { registerServerStatusHandlers } from "./ipc/server-status.handler";
import { registerSessionContextHandlers } from "./ipc/session-context.handler";
import { registerLocalStorageBreakdownHandlers } from "./ipc/local-storage-breakdown.handler";
import { registerStoredSessionHandlers } from "./ipc/stored-session.handler";
import { registerLocalLibraryFileHandlers } from "./ipc/local-library-file.handler";
import { registerLocalDownloadsFileHandlers } from "./ipc/local-downloads-file.handler";
import { registerManifestHandlers } from "./ipc/manifest.handler";
import { registerAdminApiHandlers } from "./ipc/admin-api.handler";
import { registerCatalogMetaHandlers } from "./ipc/catalog-meta.handler";
import { registerIgdbHandlers } from "./ipc/igdb.handler";
import { registerInstallHandlers } from "./ipc/install.handler";
import { registerCompatHandlers } from "./ipc/compat.handler";
import { ensureSystemInfoCollected } from "./services/sysinfo.service";
import { logger } from "./utils/logger";
import { pauseStaleDownloadingSessions, startInstallHousekeeping } from "./services/install.service";
import { startCatalogRevisionStream } from "./services/catalog-stream.service";
import { runStartupDiagnostics } from "./utils/diagnostics";

let mainWindow: BrowserWindow | null = null;
let stopCatalogRevisionStream: (() => void) | null = null;

// Focus the existing window when a second instance tries to launch
app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  // Wrap ipcMain.handle so every unhandled IPC error lands in the log file.
  const _origHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as any).handle = (channel: string, listener: (...a: any[]) => any) =>
    _origHandle(channel, async (...a: any[]) => {
      try {
        return await listener(...a);
      } catch (err) {
        void logger.error(`[IPC_ERR] ${channel}:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

  // Run startup diagnostics (non-blocking)
  runStartupDiagnostics().catch(err => console.error("Diagnostics failed", err));

  await ensureSystemInfoCollected();
  await pauseStaleDownloadingSessions();
  startInstallHousekeeping();

  // Register invoke handlers before any window loads — avoids "no handler for channel" races.
  registerAuthHandlers(ipcMain);
  registerStoredSessionHandlers(ipcMain);
  registerLocalLibraryFileHandlers(ipcMain);
  registerCatalogMetaHandlers(ipcMain);
  registerIgdbHandlers(ipcMain);
  registerLocalDownloadsFileHandlers(ipcMain);
  registerServerStatusHandlers(ipcMain);
  registerLibraryHandlers(ipcMain);
  registerManifestHandlers(ipcMain);
  registerAdminApiHandlers(ipcMain);
  registerGameHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  registerSessionContextHandlers(ipcMain);
  registerLocalStorageBreakdownHandlers(ipcMain);
  registerPlaytimeHandlers(ipcMain);
  registerSysinfoHandlers(ipcMain);
  registerInstallHandlers(ipcMain);
  registerCompatHandlers(ipcMain);

  mainWindow = createWindow();
  attachCloseToTray(mainWindow);
  createTray(mainWindow, "Somthng");
  registerAppHandlers(ipcMain, mainWindow);
  stopCatalogRevisionStream = startCatalogRevisionStream(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      attachCloseToTray(mainWindow);
      registerAppHandlers(ipcMain, mainWindow);
      stopCatalogRevisionStream?.();
      stopCatalogRevisionStream = startCatalogRevisionStream(mainWindow);
    }
  });
});

app.on("before-quit", () => {
  markAppQuitting();
  destroyTray();
  stopCatalogRevisionStream?.();
  stopCatalogRevisionStream = null;
});
