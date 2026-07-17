import { create } from "zustand";
import type { LibraryFilters } from "@shared/schemas";

interface LibraryState {
  filters: LibraryFilters;
  setFilters: (partial: Partial<LibraryFilters>) => void;
  resetFilters: () => void;
}

const defaultFilters: LibraryFilters = {
  sortBy: "title",
  sortDir: "asc",
  page: 1,
  pageSize: 50,
};

export const useLibraryStore = create<LibraryState>((set) => ({
  filters: defaultFilters,
  setFilters: (partial) =>
    set((state) => ({ filters: { ...state.filters, ...partial, page: 1 } })),
  resetFilters: () => set({ filters: defaultFilters }),
}));
