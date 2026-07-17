import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getAppPaths } from "../services/app-paths.service";

let logFilePath = "";

/**
 * Initializes the logger by ensuring the logs directory exists.
 * In development, this just writes to a local file or console,
 * but in packaged mode it writes to the user data directory.
 */
async function initLogger() {
  if (logFilePath) return;

  const logsDir = getAppPaths().logsDir;
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch (err) {
    console.error("Failed to create logs directory:", err);
  }
  
  const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  logFilePath = path.join(logsDir, `playsomthng-${dateStr}.log`);
}

/**
 * Appends a timestamped log message to the log file.
 */
export async function logToFile(level: "INFO" | "WARN" | "ERROR", ...args: unknown[]) {
  await initLogger();

  const timestamp = new Date().toISOString();
  const message = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  const line = `[${timestamp}] [${level}] ${message}\n`;

  console.log(line.trim());

  if (logFilePath) {
    try {
      await fs.appendFile(logFilePath, line, "utf8");
    } catch (err) {
      console.error("Failed to write to log file:", err);
    }
  }
}

export const logger = {
  info: (...args: unknown[]) => logToFile("INFO", ...args),
  warn: (...args: unknown[]) => logToFile("WARN", ...args),
  error: (...args: unknown[]) => logToFile("ERROR", ...args),
};
