import type { IpcMain } from "electron";
import { IpcChannel } from "../../shared/schemas";
import { fetchProtonDbSummary, listProtonVersions, runWinetricksVerb } from "../services/compat.service";

export function registerCompatHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IpcChannel.COMPAT_PROTON_LIST, async () => {
    const versions = await listProtonVersions();
    return { versions };
  });

  ipcMain.handle(IpcChannel.COMPAT_PROTONDB_GET, async (_e, raw: { appId: string }) => {
    const r = await fetchProtonDbSummary(raw.appId);
    return { tier: r.tier, raw: r.raw };
  });

  ipcMain.handle(IpcChannel.COMPAT_WINETRICKS_RUN, async (event, raw: { verb: string }) => {
    return runWinetricksVerb(raw.verb, event.sender);
  });
}
