import { useNavigate } from "react-router-dom";
import type { GameListItem } from "@shared/schemas";
import { gameListItemToGame } from "../../lib/storeGame";
import { useGamePreviewStore } from "../../store/gamePreview.store";
import { GameCard } from "./GameCard";
import { GameCardSkeleton } from "./GameCardSkeleton";

interface GameGridProps {
  games: GameListItem[];
  isLoading?: boolean;
}

export function GameGrid({ games, isLoading }: GameGridProps) {
  const navigate = useNavigate();
  const setPreviewGame = useGamePreviewStore((s) => s.set);

  if (isLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <GameCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 text-5xl">🎮</div>
        <p className="text-lg font-semibold text-text-secondary">No games found</p>
        <p className="mt-1 text-sm text-text-muted">
          Try adjusting your filters or syncing your library
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onClick={() => {
            setPreviewGame(gameListItemToGame(game));
            navigate(`/game/${game.id}`);
          }}
        />
      ))}
    </div>
  );
}
