import { IpcMain } from "electron";
import { IpcChannel } from "../../shared/schemas";
import { GameService } from "../services/game.service";

const gameService = new GameService();

export function registerGameHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.GAME_GET, async (_event, { id }: { id: string }) => {
    return gameService.getGame(id);
  });
}
