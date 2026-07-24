import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "@shared/schemas";
import { cn } from "../../lib/cn";

/**
 * Inline store search: a quiet underlined field that lives in the header row,
 * matching the filter controls beside it. Type to filter; results drop below.
 */
export function StoreSearch({ games }: { games: Game[] }) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return games.filter((g) => g.title.toLowerCase().includes(t)).slice(0, 8);
  }, [games, q]);

  const go = useCallback(
    (id: string) => {
      navigate(`/game/${id}`);
      setQ("");
      setFocused(false);
    },
    [navigate],
  );

  const showResults = focused && q.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            go(matches[0].id);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setQ("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Search"
        aria-label="Search games"
        className={cn(
          "peer w-32 bg-transparent pb-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.16em] outline-none transition-[color,width] duration-300",
          "text-[#9a9a9a] placeholder:text-[#5a5a5a] focus:w-48 focus:text-white",
        )}
      />
      {/* Underline in the app's control language — grows on focus */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-right scale-x-0 bg-white/60 transition-transform duration-300 peer-focus:scale-x-100"
      />

      {showResults && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[300] w-[min(calc(100vw-3rem),280px)] overflow-hidden rounded-lg border border-white/[0.08] bg-[#0b0b0f]/95 shadow-[0_18px_44px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {matches.length === 0 ? (
            <p className="px-3 py-2.5 text-[11px] text-[#5c5c5c]">No games match “{q.trim()}”.</p>
          ) : (
            <ul className="max-h-[min(44vh,300px)] overflow-y-auto py-1 [scrollbar-width:thin]">
              {matches.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => go(g.id)}
                    className="block w-full truncate px-3 py-2 text-left text-[12px] text-[#c4c4c4] transition hover:bg-white/[0.06] hover:text-white"
                  >
                    {g.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
