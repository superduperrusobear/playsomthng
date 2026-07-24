import type { IpcMain } from "electron";
import { IpcChannel, IpcRequestSchema } from "../../shared/schemas";
import { fetchProtonDbSummary, listProtonVersions, runWinetricksVerb } from "../services/compat.service";

export function registerCompatHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.COMPAT_PROTON_LIST, async () => {
    const versions = await listProtonVersions();
    return { versions };
  });

  ipcMain.handle(IpcChannel.COMPAT_PROTONDB_GET, async (_e, raw: unknown) => {
    const { appId } = IpcRequestSchema[IpcChannel.COMPAT_PROTONDB_GET].parse(raw);
    const r = await fetchProtonDbSummary(appId);
    return { tier: r.tier, raw: r.raw };
  });

  ipcMain.handle(IpcChannel.COMPAT_WINETRICKS_RUN, async (event, raw: unknown) => {
    const { verb } = IpcRequestSchema[IpcChannel.COMPAT_WINETRICKS_RUN].parse(raw);
    return runWinetricksVerb(verb, event.sender);
  });
}
