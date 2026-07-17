import type { ElectronApi as _ElectronApi } from "../../preload/index";

// Override `on` to accept any string channel (push events like "install:progress")
type ElectronApi = Omit<_ElectronApi, "on"> & {
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
};

declare global {
  interface Window {
    api: ElectronApi;
  }
}
