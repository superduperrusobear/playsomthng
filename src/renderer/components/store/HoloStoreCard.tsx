import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "@shared/schemas";
import { resolveStoreCoverImage } from "../../lib/storeGame";
import { STORE_CARD_WIDTH_PX } from "./storeCarouselLayout";
import { cn } from "../../lib/cn";
import { isStoreTemplateId } from "../../data/storeTemplateGames";

const MAX_TILT = 8;

export const HoloStoreCard = forwardRef<HTMLDivElement, {
  game: Game;
  isSelected: boolean;
  distance: number;
  /** Single-click — scroll carousel so this card is centered. */
  onCenter?: () => void;
  /** Double-click — opens the game hub with a flip animation. */
  onNavigate: (rect: DOMRect) => void;
}>(function HoloStoreCard({
  game,
  isSelected,
  distance,
  onCenter,
  onNavigate,
}, ref) {
  const innerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [tiltTransform, setTiltTransform] = useState(
    "perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0px)"
  );
  const [tiltTransition, setTiltTransition] = useState(
    "transform 0.45s cubic-bezier(0.23, 1, 0.32, 1)"
  );
  const [shimmer, setShimmer] = useState({ x: 50, y: 50, on: false });

  const cover = resolveStoreCoverImage(game);
  const isFar = distance >= 2;

  const baseRotateY = isFar ? (distance > 0 ? -12 : 12) : distance === 1 ? (distance > 0 ? -6 : 6) : 0;
  const baseTranslateZ = isSelected ? 40 : isFar ? -30 : -10;
  const baseScale = isSelected ? 1.08 : isFar ? 0.82 : 0.92;
  const baseBrightness = isSelected ? 1 : isFar ? 0.45 : 0.65;

  useEffect(() => {
    setTiltTransform(
      `perspective(900px) rotateX(0deg) rotateY(${baseRotateY}deg) translateZ(${baseTranslateZ}px)`
    );
    setTiltTransition("transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)");
  }, [baseRotateY, baseTranslateZ]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isSelected) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = innerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      setTiltTransform(
        `perspective(900px) rotateX(${-(y - 0.5) * MAX_TILT}deg) rotateY(${(x - 0.5) * MAX_TILT + baseRotateY}deg) translateZ(${baseTranslateZ + 20}px)`
      );
      setTiltTransition("transform 0.08s cubic-bezier(0.23, 1, 0.32, 1)");
      setShimmer({ x: x * 100, y: y * 100, on: true });
    });
  }, [isSelected, baseRotateY, baseTranslateZ]);

  const onPointerLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setTiltTransform(
      `perspective(900px) rotateX(0deg) rotateY(${baseRotateY}deg) translateZ(${baseTranslateZ}px)`
    );
    setTiltTransition("transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)");
    setShimmer((s) => ({ ...s, on: false }));
  }, [baseRotateY, baseTranslateZ]);

  return (
    <div
      ref={ref}
      className={cn("group shrink-0 snap-center", "cursor-pointer")}
      onClick={() => {
        onCenter?.();
      }}
      style={selecting ? {
        width: STORE_CARD_WIDTH_PX,
        animation: "cardPickPulse 0.22s ease-out forwards",
        willChange: "transform, filter",
      } : {
        width: STORE_CARD_WIDTH_PX,
        transform: `scale(${baseScale})`,
        filter: `brightness(${baseBrightness})`,
        transition:
          "transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.65s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        willChange: "transform, filter",
      }}
      onDoubleClick={(e) => {
        if (selecting) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setSelecting(true);
        if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
        selectTimerRef.current = setTimeout(() => {
          selectTimerRef.current = null;
          onNavigate(rect);
        }, 210);
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${game.title}`}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !selecting) {
          e.preventDefault();
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          setSelecting(true);
          if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
          selectTimerRef.current = setTimeout(() => {
            selectTimerRef.current = null;
            onNavigate(rect);
          }, 210);
        }
      }}
    >
      <div
        ref={innerRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerLeave}
        style={{
          transform: tiltTransform,
          transition: tiltTransition,
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
        className="flex flex-col"
      >
        <div
          className={cn(
            "relative aspect-[3/4] w-full overflow-hidden rounded-lg border bg-[#1e1e1e]",
            "transition-[border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
            isSelected
              ? "border-[#4a4a4a] card-shadow-store-selected"
              : isFar
              ? "border-[#222] card-shadow-store-far"
              : "border-[#333] card-shadow-store-mid",
            isSelected && "hover:border-[#5a5a5a]",
          )}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
              decoding="async"
              sizes={`${STORE_CARD_WIDTH_PX}px`}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-[#2c2c2c] to-[#141414] px-3 text-center">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#444]">
                {isStoreTemplateId(game.id) ? "Preview" : "No cover"}
              </span>
            </div>
          )}

          <div className="card-glimmer card-glimmer--store rounded-lg" aria-hidden />

          {isSelected && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[2] mix-blend-screen"
              style={{
                background: `radial-gradient(circle at ${shimmer.x}% ${shimmer.y}%, rgba(255,255,255,0.14) 0%, transparent 50%)`,
                opacity: shimmer.on ? 0.8 : 0,
                transition: shimmer.on ? "opacity 0.08s ease" : "opacity 0.4s ease",
              }}
            />
          )}

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[3] rounded-lg mix-blend-overlay"
            style={{
              background: isSelected
                ? "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 50%, rgba(0,0,0,0.08) 100%)"
                : "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 50%, rgba(0,0,0,0.06) 100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
});
