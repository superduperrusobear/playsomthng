import { IpcMain } from "electron";
import { IpcChannel, LibraryFiltersSchema } from "../../shared/schemas";
import { LibraryService } from "../services/library.service";

const libraryService = new LibraryService();

export function registerLibraryHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.LIBRARY_FETCH, async (_event, rawFilters) => {
    const filters = LibraryFiltersSchema.parse(rawFilters ?? {});
    return libraryService.fetchGames(filters);
  });

  ipcMain.handle(IpcChannel.LIBRARY_SYNC, async (event) => {
    return libraryService.syncLibrary((progress) => {
      event.sender.send(IpcChannel.LIBRARY_SYNC_PROGRESS, progress);
    });
  });
}
