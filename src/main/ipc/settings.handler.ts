import { IpcMain } from "electron";
import { IpcChannel, AppSettingsSchema } from "../../shared/schemas";
import { SettingsService } from "../services/settings.service";

const settingsService = new SettingsService();

export function registerSettingsHandlers(ipcMain: IpcMain) {
  ipcMain.handle(IpcChannel.SETTINGS_GET, async () => {
    return settingsService.getSettings();
  });

  ipcMain.handle(IpcChannel.SETTINGS_SET, async (_event, partial) => {
    const validated = AppSettingsSchema.partial().parse(partial);
    return settingsService.updateSettings(validated);
  });
}
