import { create } from "zustand";

const STORAGE_KEY = "store-catalog-update-pending";

function readPending(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persist(pending: boolean): void {
  try {
    if (pending) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory indicator still works when storage is unavailable.
  }
}

type StoreUpdateState = {
  hasUpdate: boolean;
  markUpdate: () => void;
  clearUpdate: () => void;
};

export const useStoreUpdateStore = create<StoreUpdateState>((set) => ({
  hasUpdate: readPending(),
  markUpdate: () => {
    persist(true);
    set({ hasUpdate: true });
  },
  clearUpdate: () => {
    persist(false);
    set({ hasUpdate: false });
  },
}));
