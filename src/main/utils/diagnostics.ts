import { app } from "electron";
import { SettingsService } from "../services/settings.service";
import { debugFetch } from "./network-debug";
import { logger } from "./logger";

export async function runStartupDiagnostics() {
  logger.info(`=== STARTUP DIAGNOSTIC SUMMARY ===`);
  logger.info(`PACKAGED: ${app.isPackaged}`);
  
  const settings = new SettingsService().getSettings();
  const source = settings.sources.find(s => s.enabled);
  
  if (!source) {
    logger.error(`EFFECTIVE_BASE_URL: NONE`);
    logger.error(`FIRST_FAILURE: No enabled source found in settings`);
    logger.info(`==================================`);
    return;
  }
  
  const baseUrl = source.baseUrl;
  logger.info(`EFFECTIVE_BASE_URL: ${baseUrl}`);
  
  let firstFailure = "";
  
  // 1. Health check
  let healthOk = false;
  try {
    const res = await debugFetch(new URL("/health", baseUrl), { timeoutMs: 10000 });
    healthOk = res.ok;
    logger.info(`HEALTH_CHECK: ${res.ok ? "OK" : `FAILED (${res.status})`}`);
    if (!res.ok && !firstFailure) firstFailure = `Health check failed: HTTP ${res.status}`;
  } catch (err: any) {
    logger.error(`HEALTH_CHECK: FAILED (${err.message})`);
    if (!firstFailure) firstFailure = `Health check error: ${err.message}`;
  }
  
  // 2. Games fetch (catalog sync)
  let gamesOk = false;
  try {
    const res = await debugFetch(new URL("/api/games", baseUrl), { timeoutMs: 15000 });
    gamesOk = res.ok;
    logger.info(`GAMES_FETCH: ${res.ok ? "OK" : `FAILED (${res.status})`}`);
    if (!res.ok && !firstFailure) firstFailure = `Games fetch failed: HTTP ${res.status}`;
  } catch (err: any) {
    logger.error(`GAMES_FETCH: FAILED (${err.message})`);
    if (!firstFailure) firstFailure = `Games fetch error: ${err.message}`;
  }
  
  if (firstFailure) {
    logger.error(`FIRST_FAILING_STEP: ${firstFailure}`);
  } else {
    logger.info(`FIRST_FAILING_STEP: NONE (All checks passed)`);
  }
  
  logger.info(`=== END DIAGNOSTIC SUMMARY ===`);
}
