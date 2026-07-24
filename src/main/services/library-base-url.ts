import { SettingsService } from "./settings.service";

/** Defense in depth for any call that carries a setup code or bearer token. */
export function assertSecureServerUrl(raw: string): string {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("This server uses unencrypted HTTP. Use HTTPS before signing in or opening admin tools.");
  }
  return raw.replace(/\/$/, "");
}

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
