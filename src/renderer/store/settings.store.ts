import { create } from "zustand";
import type { AppSettings } from "@shared/schemas";

interface SettingsState {
  settings: AppSettings | null;
  setSettings: (s: AppSettings) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  setSettings: (settings) => set({ settings }),
  updateSettings: (partial) =>
    set((state) =>
      state.settings ? { settings: { ...state.settings, ...partial } } : state
    ),
}));
