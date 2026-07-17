import { IpcChannel } from "@shared/schemas";

export function invoke<T = unknown>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  return window.api.invoke<T>(channel, ...args);
}

export function send(channel: IpcChannel, ...args: unknown[]): void {
  window.api.send(channel, ...args);
}

export function onEvent(
  channel: IpcChannel,
  callback: (...args: unknown[]) => void
): () => void {
  return window.api.on(channel, callback);
}
