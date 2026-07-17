import { create } from "zustand";
import type { Game } from "@shared/schemas";

export interface CardOrigin {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GamePreviewState {
  game: Game | null;
  origin: CardOrigin | null;
  set: (g: Game, origin?: CardOrigin | null) => void;
  clear: () => void;
}

export const useGamePreviewStore = create<GamePreviewState>((set) => ({
  game: null,
  origin: null,
  set: (game, origin = null) => set({ game, origin }),
  clear: () => set({ game: null, origin: null }),
}));
