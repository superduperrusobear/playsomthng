export function GameCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface-raised border border-surface-border animate-pulse">
      <div className="aspect-[3/4] w-full bg-surface-overlay" />
      <div className="p-3 space-y-2">
        <div className="h-3 w-3/4 rounded bg-surface-border" />
        <div className="h-2.5 w-1/2 rounded bg-surface-border" />
      </div>
    </div>
  );
}
