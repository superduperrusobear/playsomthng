import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "../shared/schemas";

// The only surface area the renderer gets — typed, safe, no direct Node access
const api = {
  invoke: <T = unknown>(channel: IpcChannel, ...args: unknown[]): Promise<T> => {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },

  send: (channel: IpcChannel, ...args: unknown[]): void => {
    ipcRenderer.send(channel, ...args);
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ElectronApi = typeof api;
