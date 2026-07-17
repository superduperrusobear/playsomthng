/**
 * Resets local app state so the next launch behaves like a fresh install.
 *
 *   node scripts/reset.js          → back to the connect gate (keeps library + installs)
 *   node scripts/reset.js --all    → wipe all app data (logs kept)
 *   node scripts/reset.js --list   → show what would be removed
 *
 * Only touches the dev userData dir unless --packaged is passed.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DEV = "somthng";
const APP_PACKAGED = "Somthng";

function userDataDir(appName) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), appName);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), appName);
}

/** Files that decide first-run behaviour. */
const FIRST_RUN_TARGETS = [
  "settings.json",
  path.join("data", "user-session.json"),
];

/** Everything the app writes, minus logs. */
const ALL_TARGETS = [
  "settings.json",
  "data",
  "Local Storage",
  "Session Storage",
];

function remove(dir, rel) {
  const target = path.join(dir, rel);
  if (!fs.existsSync(target)) return null;
  fs.rmSync(target, { recursive: true, force: true });
  return target;
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const list = args.includes("--list");
const packaged = args.includes("--packaged");

const dir = userDataDir(packaged ? APP_PACKAGED : APP_DEV);
const targets = all ? ALL_TARGETS : FIRST_RUN_TARGETS;

if (!fs.existsSync(dir)) {
  console.log(`[reset] Nothing to do — ${dir} does not exist.`);
  process.exit(0);
}

if (list) {
  console.log(`[reset] ${dir}`);
  for (const t of targets) {
    const p = path.join(dir, t);
    console.log(`  ${fs.existsSync(p) ? "would remove" : "absent     "}  ${t}`);
  }
  process.exit(0);
}

console.log(`[reset] ${dir}`);
let n = 0;
for (const t of targets) {
  const removed = remove(dir, t);
  if (removed) {
    console.log(`  removed  ${t}`);
    n++;
  }
}
console.log(
  n === 0
    ? "[reset] Already clean."
    : `[reset] Done (${n}). Next launch starts at the connect gate.`,
);
