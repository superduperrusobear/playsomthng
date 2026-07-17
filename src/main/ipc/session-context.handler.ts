import type { IpcMain } from "electron";
import { IpcChannel, LocalSessionContextSchema } from "../../shared/schemas";
import { getAppPaths } from "../services/app-paths.service";
import { loadOrCreateLocalUser } from "../services/local-user.service";

export function registerSessionContextHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.SESSION_CONTEXT_GET, async () => {
    const paths = getAppPaths();
    const localUser = await loadOrCreateLocalUser();
    const ctx = { paths, localUser };
    return LocalSessionContextSchema.parse(ctx);
  });
}
