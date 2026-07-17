import {
  CatalogGameRawSchema,
  catalogEntryToGame,
  isCatalogGameRaw,
} from "../../shared/catalog-mapper";
import { Game, GameSchema } from "../../shared/schemas";
import { SettingsService } from "./settings.service";
import { debugFetch } from "../utils/network-debug";

export class GameService {
  private settingsService = new SettingsService();

  async getGame(id: string): Promise<Game> {
    const settings = this.settingsService.getSettings();
    const source = settings.sources.find((s) => s.enabled);
    if (!source) throw new Error("No library source configured");

    const res = await debugFetch(new URL(`/api/games/${id}`, source.baseUrl).toString(), { timeoutMs: 15000 });
    if (!res.ok) throw new Error(`Game not found: ${id} (${res.status})`);
    const raw: unknown = await res.json();
    if (isCatalogGameRaw(raw)) {
      return catalogEntryToGame(CatalogGameRawSchema.parse(raw));
    }
    return GameSchema.parse(raw);
  }
}
