import { Search, X } from "lucide-react";
import { useLibraryStore } from "../../store/library.store";

export function SearchBar() {
  const search = useLibraryStore((s) => s.filters.search ?? "");
  const setFilters = useLibraryStore((s) => s.setFilters);

  return (
    <div className="relative flex-1 max-w-sm">
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
      />
      <input
        type="text"
        value={search}
        onChange={(e) => setFilters({ search: e.target.value || undefined })}
        placeholder="Search games…"
        className="w-full rounded-xl bg-surface-overlay border border-surface-border py-2 pl-9 pr-8 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-all"
      />
      {search && (
        <button
          onClick={() => setFilters({ search: undefined })}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
