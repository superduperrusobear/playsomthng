import { RefreshCw } from "lucide-react";
import { useLibraryStore } from "../../store/library.store";
import { SearchBar } from "./SearchBar";
import { cn } from "../../lib/cn";
import type { Platform } from "@shared/schemas";

const PLATFORMS: { label: string; value: Platform | "all" }[] = [
  { label: "All", value: "all" },
  { label: "PC", value: "pc" },
  { label: "PS2", value: "ps2" },
  { label: "PS3", value: "ps3" },
  { label: "PS4", value: "ps4" },
  { label: "Switch", value: "switch" },
  { label: "GameCube", value: "gamecube" },
  { label: "Wii", value: "wii" },
  { label: "Xbox 360", value: "xbox360" },
  { label: "PSP", value: "psp" },
];

interface FilterBarProps {
  onSync?: () => void;
  isSyncing?: boolean;
}

export function FilterBar({ onSync, isSyncing }: FilterBarProps) {
  const { filters, setFilters } = useLibraryStore();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <SearchBar />

        <select
          value={filters.sortBy}
          onChange={(e) =>
            setFilters({ sortBy: e.target.value as typeof filters.sortBy })
          }
          className="rounded-xl bg-surface-overlay border border-surface-border px-3 py-2 text-sm text-text-secondary outline-none focus:border-accent/60 transition-all cursor-pointer"
        >
          <option value="title">Name</option>
          <option value="dateAddedToLibrary">Date Added</option>
          <option value="releaseDate">Release Date</option>
          <option value="platform">Platform</option>
        </select>

        <button
          onClick={onSync}
          disabled={isSyncing}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
            "bg-surface-overlay border border-surface-border text-text-secondary hover:text-text-primary hover:border-accent/40",
            isSyncing && "opacity-60 cursor-not-allowed"
          )}
        >
          <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
          Sync
        </button>
      </div>

      {/* Platform pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PLATFORMS.map(({ label, value }) => {
          const isActive =
            value === "all" ? !filters.platform : filters.platform === value;
          return (
            <button
              key={value}
              onClick={() =>
                setFilters({ platform: value === "all" ? undefined : value })
              }
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-all",
                isActive
                  ? "bg-accent text-white shadow-sm shadow-accent/30"
                  : "bg-surface-overlay text-text-muted hover:text-text-secondary border border-surface-border"
              )}
            >
              {label}
            </button>
          );
        })}

        {/* Emulator toggle */}
        <button
          onClick={() =>
            setFilters({
              emulatorRequired: filters.emulatorRequired === true ? undefined : true,
            })
          }
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-all",
            filters.emulatorRequired
              ? "bg-brand-blue text-white"
              : "bg-surface-overlay text-text-muted hover:text-text-secondary border border-surface-border"
          )}
        >
          Needs Emulator
        </button>
      </div>
    </div>
  );
}
