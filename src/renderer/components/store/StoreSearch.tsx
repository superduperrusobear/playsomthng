import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import type { Game } from "@shared/schemas";

/**
 * Minimal store search: opens from a small icon, filters published titles, navigates to the game page.
 */
export function StoreSearch({ games }: { games: Game[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return games.filter((g) => g.title.toLowerCase().includes(t)).slice(0, 10);
  }, [games, q]);

  const go = useCallback(
    (id: string) => {
      navigate(`/game/${id}`);
      setOpen(false);
      setQ("");
    },
    [navigate],
  );

  return (
    <div ref={wrapRef} className="relative flex h-14 w-14 items-center justify-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-white/35 transition hover:bg-white/[0.06] hover:text-white/75"
        aria-label="Search store"
        aria-expanded={open}
      >
        <Search className="h-[18px] w-[18px]" strokeWidth={1.85} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%-4px)] z-[300] w-[min(calc(100vw-3rem),268px)] rounded-xl border border-white/[0.09] bg-[#0a0a0f]/[0.97] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md"
          role="dialog"
          aria-label="Search games"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                go(matches[0].id);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="Find a game…"
            className="w-full rounded-lg border border-white/[0.07] bg-black/35 px-2.5 py-2 text-[12px] text-[#eaeaea] outline-none ring-0 placeholder:text-[#5a5a5a] focus:border-white/18"
          />
          {q.trim() && matches.length === 0 && (
            <p className="mt-2 px-0.5 text-[11px] text-[#5c5c5c]">No matches</p>
          )}
          {matches.length > 0 && (
            <ul className="mt-1.5 max-h-[min(40vh,240px)] overflow-y-auto [scrollbar-width:thin]">
              {matches.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => go(g.id)}
                    className="w-full rounded-lg px-2 py-2 text-left text-[12px] leading-snug text-[#c8c8c8] transition hover:bg-white/[0.07] hover:text-white"
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
