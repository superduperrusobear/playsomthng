import { SettingsService } from "./settings.service";

/** First enabled library source — same base URL used for catalog and `/api/auth/login`. */
export function getEnabledLibraryBaseUrl(): string {
  const svc = new SettingsService();
  const settings = svc.getSettings();
  const enabled = settings.sources.filter((s) => s.enabled);
  if (enabled.length > 0) return enabled[0].baseUrl.replace(/\/$/, "");
  if (settings.sources.length > 0) return settings.sources[0].baseUrl.replace(/\/$/, "");
  // No server configured yet — the connect screen must supply one before login/downloads.
  return "";
}
