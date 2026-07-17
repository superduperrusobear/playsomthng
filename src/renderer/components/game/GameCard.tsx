import { Play, Cpu } from "lucide-react";
import type { GameListItem } from "@shared/schemas";
import { resolveStoreCoverImage } from "../../lib/storeGame";

const PLATFORM_LABELS: Record<string, string> = {
  pc: "PC", ps1: "PS1", ps2: "PS2", ps3: "PS3", ps4: "PS4", ps5: "PS5",
  xbox: "Xbox", xbox360: "Xbox 360", xboxone: "Xbox One",
  nes: "NES", snes: "SNES", n64: "N64", gamecube: "GameCube",
  wii: "Wii", wiiu: "Wii U", switch: "Switch",
  gba: "GBA", nds: "NDS", "3ds": "3DS",
  psp: "PSP", psvita: "PS Vita",
  arcade: "Arcade", other: "Other",
};

interface GameCardProps {
  game: GameListItem;
  onClick?: () => void;
}

export function GameCard({ game, onClick }: GameCardProps) {
  const needsEmulator = game.emulator.required;
  const cover = resolveStoreCoverImage(game);

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-surface-border/90 bg-surface-raised transition-all duration-200 hover:border-accent/40 hover:-translate-y-0.5 animate-fade-in card-shadow-smudge"
    >
      {/* Cover art */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-surface-overlay">
        {cover ? (
          <img
            src={cover}
            alt={game.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-overlay to-surface-border">
            <span className="text-4xl font-bold text-text-muted">
              {game.title[0]}
            </span>
          </div>
        )}
        <div className="card-glimmer rounded-t-2xl" aria-hidden />

        {/* Hover overlay */}
        <div className="absolute inset-0 z-[2] flex items-end justify-center pb-4 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-lg">
            <Play size={13} fill="currentColor" /> View
          </span>
        </div>
      </div>

      {/* Card footer */}
      <div className="p-3 space-y-1">
        <p className="truncate text-sm font-semibold text-text-primary leading-tight">
          {game.title}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {PLATFORM_LABELS[game.platform] ?? game.platform}
          </span>
          {needsEmulator && (
            <span
              title="Emulator required"
              className="flex items-center gap-0.5 text-xs text-accent/70"
            >
              <Cpu size={10} />
              EMU
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
