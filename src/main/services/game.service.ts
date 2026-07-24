import {
  CatalogGameRawSchema,
  catalogEntryToGame,
  isCatalogGameRaw,
} from "../../shared/catalog-mapper";
import { Game, GameSchema } from "../../shared/schemas";
import { SettingsService } from "./settings.service";
import { debugFetch } from "../utils/network-debug";
import { getAuthTokenForDownloads, getHardwareUuidForDownloads } from "../ipc/auth.handler";

export class GameService {
  private settingsService = new SettingsService();

  async getGame(id: string): Promise<Game> {
    const settings = this.settingsService.getSettings();
    const source = settings.sources.find((s) => s.enabled);
    if (!source) throw new Error("No library source configured");

    // /api/games/{id} is session-gated — send the token + hardware header.
    const headers: Record<string, string> = {};
    const token = getAuthTokenForDownloads();
    const hw = getHardwareUuidForDownloads();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (hw) headers["X-Hardware-Uuid"] = hw;

    const res = await debugFetch(new URL(`/api/games/${id}`, source.baseUrl).toString(), { headers, timeoutMs: 15000 });
    if (!res.ok) throw new Error(`Game not found: ${id} (${res.status})`);
    const raw: unknown = await res.json();
    if (isCatalogGameRaw(raw)) {
      return catalogEntryToGame(CatalogGameRawSchema.parse(raw));
    }
    return GameSchema.parse(raw);
  }
}
