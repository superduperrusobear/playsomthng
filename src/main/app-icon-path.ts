import { app } from "electron";
import fs from "fs";
import path from "path";

/** PNG used for BrowserWindow, tray, and taskbar (dev + packaged). */
export function resolveAppIconPath(): string | undefined {
  if (app.isPackaged) {
    const fromResources = path.join(process.resourcesPath, "app-icon.png");
    if (fs.existsSync(fromResources)) return fromResources;
    return undefined;
  }
  const dev = path.join(__dirname, "../../../build/icon.png");
  if (fs.existsSync(dev)) return dev;
  return undefined;
}
