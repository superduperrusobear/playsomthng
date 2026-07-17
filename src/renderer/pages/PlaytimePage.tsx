import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import { usePlaytime } from "../hooks/usePlaytime";
import { useLibrary } from "../hooks/useLibrary";
import type { GameListItem, PlaytimeEntry } from "@shared/schemas";

function formatMinutes(total: number): string {
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function PlaytimeRow({
  entry,
  game,
}: {
  entry: PlaytimeEntry;
  game?: GameListItem;
}) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/game/${entry.gameId}`)}
      className="flex cursor-pointer items-center gap-4 rounded-xl bg-surface-raised border border-surface-border p-3 transition-all hover:border-accent/30 hover:-translate-y-px"
    >
      {/* Cover thumbnail */}
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-overlay">
        {game?.coverImage ? (
          <img src={game.coverImage} alt={game.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-bold text-text-muted">
            {game?.title[0] ?? "?"}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold text-text-primary">
          {game?.title ?? entry.gameId}
        </p>
        {entry.lastPlayedAt && (
          <p className="text-xs text-text-muted">
            Last played{" "}
            {new Date(entry.lastPlayedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      {/* Playtime */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-sm font-bold text-text-primary">
          {formatMinutes(entry.totalMinutes)}
        </span>
        <span className="text-xs text-text-muted">
          {entry.sessions} {entry.sessions === 1 ? "session" : "sessions"}
        </span>
      </div>
    </div>
  );
}

export function PlaytimePage() {
  const { data: playtimeEntries, isLoading } = usePlaytime();
  const { data: library } = useLibrary();

  const gameMap = new Map<string, GameListItem>(
    (library?.games ?? []).map((g) => [g.id, g])
  );

  const sorted = [...(playtimeEntries ?? [])].sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );

  const totalMinutes = sorted.reduce((sum, e) => sum + e.totalMinutes, 0);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Playtime</h1>
          {sorted.length > 0 && (
            <p className="mt-0.5 text-sm text-text-muted">
              {formatMinutes(totalMinutes)} total across {sorted.length}{" "}
              {sorted.length === 1 ? "game" : "games"}
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Clock size={36} className="text-text-muted" />
          <p className="text-text-secondary">No playtime tracked yet</p>
          <p className="text-sm text-text-muted">
            Launch a game to start tracking your hours
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {sorted.map((entry) => (
            <PlaytimeRow
              key={entry.gameId}
              entry={entry}
              game={gameMap.get(entry.gameId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
