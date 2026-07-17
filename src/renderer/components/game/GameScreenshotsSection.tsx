import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { preferHigherResImageUrl } from "../../lib/storeGame";

function ScreenshotsHeading() {
  return (
    <h3 className="font-title text-[16px] tracking-[0.18em] text-white/90 uppercase">
      Screenshots
    </h3>
  );
}

type Props = {
  screenshots: string[];
  gameTitle: string;
};

export function GameScreenshotsSection({ screenshots, gameTitle }: Props) {
  const urls = useMemo(
    () => screenshots.map((s) => preferHigherResImageUrl(s) ?? s),
    [screenshots],
  );
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      setLightboxIdx((i) => (i === null ? 0 : (i + delta + urls.length) % urls.length));
    },
    [urls.length],
  );

  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIdx(null);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxIdx, go]);

  if (urls.length === 0) return null;

  const thumb = (idx: number, extraClass = "") => {
    const url = urls[idx];
    if (!url) return <div className={`rounded-lg bg-white/5 ${extraClass}`} style={{ aspectRatio: "16/9" }} />;
    const isLast = idx === 4 && urls.length > 5;
    return (
      <button
        key={url + idx}
        type="button"
        onClick={() => setLightboxIdx(idx)}
        className={`relative rounded-lg overflow-hidden group ${extraClass}`}
        style={{ aspectRatio: "16/9" }}
        aria-label={`View screenshot ${idx + 1}`}
      >
        <img src={url} alt={`${gameTitle} — screenshot ${idx + 1}`} className="w-full h-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200" />
        {isLast && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-white font-title text-[20px] tracking-widest">
            +{urls.length - 5}
          </div>
        )}
      </button>
    );
  };

  return (
    <section className="space-y-2.5">
      <ScreenshotsHeading />

      {/*
        Layout mirrors reference image:
          Row 1: [large featured — 60%] [two stacked thumbs — 40%]
          Row 2: [thumb] [thumb]
      */}
      <div className="space-y-2">
        {/* Row 1 */}
        <div className="flex gap-2 items-stretch">
          {/* Featured — left, larger */}
          <button
            type="button"
            onClick={() => setLightboxIdx(0)}
            className="relative rounded-xl overflow-hidden group"
            style={{ flex: "3", aspectRatio: "16/9" }}
            aria-label="View screenshot 1"
          >
            <img
              src={urls[0]}
              alt={`${gameTitle} — screenshot 1`}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200" />
          </button>

          {/* Two stacked on the right */}
          <div className="flex flex-col gap-2" style={{ flex: "2" }}>
            {urls[1] && thumb(1, "flex-1")}
            {urls[2] && thumb(2, "flex-1")}
          </div>
        </div>

        {/* Row 2 — two equal thumbs */}
        {urls.length > 3 && (
          <div className="flex gap-2">
            {urls[3] && <div style={{ flex: 1 }}>{thumb(3, "w-full")}</div>}
            {urls[4] && <div style={{ flex: 1 }}>{thumb(4, "w-full")}</div>}
          </div>
        )}
      </div>

      {/* Counter */}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <span className="text-[11px] text-white/40 tabular-nums">
          1 / {urls.length}
        </span>
        {urls.length > 1 && (
          <button
            type="button"
            onClick={() => setLightboxIdx(0)}
            className="text-[11px] text-white/40 hover:text-white/70 transition"
            aria-label="View all screenshots"
          >
            ›
          </button>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/94 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot viewer"
        >
          <div className="flex shrink-0 items-center justify-between px-4 py-3">
            <p className="truncate text-[13px] text-[#ccc]">
              {gameTitle}
              <span className="ml-2 text-[#888]">({lightboxIdx + 1}/{urls.length})</span>
            </p>
            <button
              type="button"
              onClick={() => setLightboxIdx(null)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[#aaa] transition hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center p-4"
            onClick={() => setLightboxIdx(null)}
          >
            <img
              src={urls[lightboxIdx]}
              alt={`${gameTitle} — screenshot ${lightboxIdx + 1}`}
              className="max-h-full max-w-full object-contain"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
            {urls.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); go(-1); }}
                  className="absolute left-2 top-1/2 z-[1] flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80 md:left-6"
                  aria-label="Previous"
                >
                  <ChevronLeft className="h-7 w-7" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); go(1); }}
                  className="absolute right-2 top-1/2 z-[1] flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80 md:right-6"
                  aria-label="Next"
                >
                  <ChevronRight className="h-7 w-7" />
                </button>
              </>
            )}
          </div>

          <p className="shrink-0 pb-4 text-center text-[11px] text-[#666]">
            Esc to close · ← → to navigate
          </p>
        </div>
      )}
    </section>
  );
}
