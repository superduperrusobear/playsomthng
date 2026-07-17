import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { resolveAppIconPath } from "./app-icon-path";

/** Fallback if `build/icon.png` / packaged `app-icon.png` is missing. */
const TRAY_ICON_PLACEHOLDER =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let tray: Tray | null = null;
let quitting = false;

export function isAppQuitting(): boolean {
  return quitting;
}

export function markAppQuitting(): void {
  quitting = true;
}

export function createTray(mainWindow: BrowserWindow, productName: string): void {
  if (tray) return;

  const iconPath = resolveAppIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PLACEHOLDER, "base64"));
  tray = new Tray(icon);
  tray.setToolTip(productName);

  const show = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  };

  const quit = () => {
    markAppQuitting();
    app.quit();
  };

  const menu = Menu.buildFromTemplate([
    { label: `Open ${productName}`, click: show },
    { type: "separator" },
    { label: "Quit", click: quit },
  ]);
  tray.setContextMenu(menu);

  tray.on("click", () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      show();
    }
  });
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/** Hide to tray instead of destroying the window (frameless close button). */
export function attachCloseToTray(mainWindow: BrowserWindow): void {
  mainWindow.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
  });
}
