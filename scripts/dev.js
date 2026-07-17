/**
 * Dev launcher — starts Vite, polls until it responds, then boots Electron.
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const VITE_URL = "http://localhost:5173";
const ROOT = path.join(__dirname, "..");
// Local server by default. Override with PLAYSOMTHNG_API_BASE to point elsewhere.
const DEFAULT_REMOTE_API_BASE = process.env.PLAYSOMTHNG_API_BASE || "http://127.0.0.1:3000";
function waitForHttp(url, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Timed out waiting for ${url}`));
          } else {
            setTimeout(attempt, 800);
          }
        });
    }
    attempt();
  });
}

// ── 1. Start Vite ─────────────────────────────────────────────────────────────
console.log("[dev] Starting Vite dev server…");

// shell: true lets Windows resolve cmd/bat wrappers (npx, etc.)
const vite = spawn("npx", ["vite"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PLAYSOMTHNG_API_BASE: process.env.PLAYSOMTHNG_API_BASE || DEFAULT_REMOTE_API_BASE,
    PLAYSMTHNG_API_BASE: process.env.PLAYSMTHNG_API_BASE || process.env.PLAYSOMTHNG_API_BASE || DEFAULT_REMOTE_API_BASE,
  },
});

// ── 2. Poll Vite, then launch Electron ────────────────────────────────────────
waitForHttp(VITE_URL)
  .then(() => {
    console.log("[dev] Vite is ready. Launching Electron…");

    const electronBin = String(require("electron")); // absolute path to electron.exe
    const proc = spawn(electronBin, [ROOT], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        PLAYSOMTHNG_API_BASE: process.env.PLAYSOMTHNG_API_BASE || DEFAULT_REMOTE_API_BASE,
        PLAYSMTHNG_API_BASE: process.env.PLAYSMTHNG_API_BASE || process.env.PLAYSOMTHNG_API_BASE || DEFAULT_REMOTE_API_BASE,
      },
      shell: false,
    });

    proc.on("close", (code) => {
      console.log("[dev] Electron closed. Stopping Vite.");
      vite.kill();
      process.exit(code ?? 0);
    });

    proc.on("error", (err) => {
      console.error("[dev] Electron launch error:", err.message);
      vite.kill();
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error("[dev]", err.message);
    vite.kill();
    process.exit(1);
  });

vite.on("close", (code) => {
  if (code !== null && code !== 0) {
    console.error(`[dev] Vite exited unexpectedly (${code})`);
    process.exit(code);
  }
});

process.on("SIGINT", () => {
  vite.kill();
  process.exit(0);
});
