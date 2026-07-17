import { BrowserWindow, shell } from "electron";
import path from "path";
import { resolveAppIconPath } from "./app-icon-path";

const isDev = process.env.NODE_ENV === "development";

export function createWindow(): BrowserWindow {
  const icon = resolveAppIconPath();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    ...(icon ? { icon } : {}),
    /* Match app chrome so no harsh strip if GPU paints before React */
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // rootDir=src, outDir=dist/main → compiled to dist/main/main/ and dist/main/preload/
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  win.once("ready-to-show", () => {
    win.show();
    // Keep background in sync with shell (frameless + rounded corners on some OS builds)
    win.setBackgroundColor("#0a0a0a");
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    // Vite builds to dist/renderer/, main compiles to dist/main/main/ → go up two levels
    win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  return win;
}
