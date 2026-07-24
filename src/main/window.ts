import { BrowserWindow, shell, session } from "electron";
import path from "path";
import { resolveAppIconPath } from "./app-icon-path";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy for the renderer.
 *
 * The library server origin is user-configured (any self-hosted HTTPS host, or
 * loopback HTTP in dev), so `connect-src` allows `https:` plus loopback http.
 * Scripts are confined to `'self'` (no inline, no remote). Styles/fonts allow the
 * Google Fonts CDN the app already loads. Images allow data: URIs and blob:.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Vite dev server injects inline eval scripts in dev; allow it only in dev.
  isDev ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com" : "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function createWindow(): BrowserWindow {
  const icon = resolveAppIconPath();

  // Apply the CSP as a response header on every renderer document load.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });

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
      // Sandbox the renderer process so a compromised renderer (XSS / malicious
      // dependency) cannot reach Node APIs even via the preload bridge. The
      // preload only uses `contextBridge` + `ipcRenderer`, which work under sandbox.
      sandbox: true,
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
