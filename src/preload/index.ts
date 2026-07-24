import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "../shared/schemas";
import {
  WINETRICKS_DONE_CHANNEL,
  WINETRICKS_LOG_CHANNEL,
} from "../shared/compatChannels";

/**
 * Channels the main process is allowed to push to the renderer (via `on`).
 * Invoke channels are validated against the IpcChannel registry below.
 * Keeping this list explicit prevents a compromised renderer from listening
 * on arbitrary channels or invoking handlers it shouldn't reach.
 */
const ALLOWED_PUSH_CHANNELS = new Set<string>([
  "install:progress",
  "game:exit",
  IpcChannel.LIBRARY_CATALOG_REVISION,
  WINETRICKS_LOG_CHANNEL,
  WINETRICKS_DONE_CHANNEL,
]);

const INVOKE_CHANNELS = new Set<string>(Object.values(IpcChannel));

function assertInvokeChannel(channel: string): void {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`Refused IPC invoke on unregistered channel: ${channel}`);
  }
}

function assertPushChannel(channel: string): void {
  if (!ALLOWED_PUSH_CHANNELS.has(channel)) {
    throw new Error(`Refused IPC listener on unregistered channel: ${channel}`);
  }
}

// The only surface area the renderer gets — typed, safe, no direct Node access.
const api = {
  invoke: <T = unknown>(channel: IpcChannel, ...args: unknown[]): Promise<T> => {
    assertInvokeChannel(channel as string);
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },

  send: (channel: IpcChannel, ...args: unknown[]): void => {
    assertInvokeChannel(channel as string);
    ipcRenderer.send(channel, ...args);
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    assertPushChannel(channel);
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronApi = typeof api;
