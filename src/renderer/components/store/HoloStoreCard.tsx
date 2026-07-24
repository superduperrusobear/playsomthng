import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "@shared/schemas";
import { resolveStoreCoverImage } from "../../lib/storeGame";
import { STORE_CARD_WIDTH_PX } from "./storeCarouselLayout";
import { cn } from "../../lib/cn";
import { isStoreTemplateId } from "../../data/storeTemplateGames";

const MAX_TILT = 7;
const TILT_SLOW = "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)";
const TILT_FAST = "transform 0.1s cubic-bezier(0.23, 1, 0.32, 1)";

/** Cover-flow pose: cards angle toward the center and recede/desaturate with distance. */
function poseFor(offset: number) {
  const side = Math.sign(offset);
  const d = Math.min(Math.abs(offset), 2);
  if (d === 0) {
    return { t: "rotateY(0deg) translateZ(46px) translateY(-10px) scale(1.06)", f: "none" };
  }
  if (d === 1) {
    return {
      t: `rotateY(${-side * 9}deg) translateZ(-18px) translateY(4px) scale(0.9)`,
      f: "brightness(0.8) saturate(0.9)",
    };
  }
  return {
    t: `rotateY(${-side * 16}deg) translateZ(-55px) translateY(10px) scale(0.8)`,
    f: "brightness(0.55) saturate(0.68)",
  };
}

export const HoloStoreCard = forwardRef<HTMLDivElement, {
  game: Game;
  /** Signed steps from the centered card (negative = left of center). */
  offset: number;
  /** Single-click — scroll carousel so this card is centered. */
  onCenter?: () => void;
  /** Double-click — opens the game hub. */
  onNavigate: (rect: DOMRect) => void;
}>(function HoloStoreCard({ game, offset, onCenter, onNavigate }, ref) {
  const tiltRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selecting, setSelecting] = useState(false);

  const isSelected = offset === 0;
  const near = Math.abs(offset) <= 1;
  const pose = poseFor(offset);
  const cover = resolveStoreCoverImage(game);

  useEffect(
    () => () => {
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** Pointer tilt writes styles directly — no React re-render per frame. */
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isSelected) return;
      const { clientX, clientY } = e;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = tiltRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const x = (clientX - r.left) / r.width;
        const y = (clientY - r.top) / r.height;
        el.style.transition = TILT_FAST;
        el.style.transform = `rotateX(${-(y - 0.5) * MAX_TILT}deg) rotateY(${(x - 0.5) * MAX_TILT}deg) translateZ(14px)`;
        const s = shineRef.current;
        if (s) {
          s.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,0.16) 0%, transparent 55%)`;
          s.style.opacity = "1";
        }
      });
    },
    [isSelected],
  );

  const resetTilt = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const el = tiltRef.current;
    if (el) {
      el.style.transition = TILT_SLOW;
      el.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0px)";
    }
    const s = shineRef.current;
    if (s) s.style.opacity = "0";
  }, []);

  // If the carousel scrolls past a card mid-hover, drop its tilt.
  useEffect(() => {
    if (!isSelected) resetTilt();
  }, [isSelected, resetTilt]);

  const beginSelect = (rect: DOMRect) => {
    if (selecting) return;
    setSelecting(true);
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    selectTimerRef.current = setTimeout(() => {
      selectTimerRef.current = null;
      onNavigate(rect);
    }, 210);
  };

  return (
    <div
      ref={ref}
      className="group shrink-0 cursor-pointer snap-center"
      style={{ width: STORE_CARD_WIDTH_PX, transformStyle: "preserve-3d" }}
      onClick={() => onCenter?.()}
      onDoubleClick={(e) => beginSelect(e.currentTarget.getBoundingClientRect())}
      role="button"
      tabIndex={0}
      aria-label={`Open ${game.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          beginSelect((e.currentTarget as HTMLDivElement).getBoundingClientRect());
        }
      }}
    >
      {/* Pose in the arc (React-driven; single transition, no competing transforms) */}
      <div
        style={{
          transform: pose.t,
          filter: selecting ? undefined : pose.f,
          transition: "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), filter 0.55s ease",
          transformStyle: "preserve-3d",
          willChange: "transform, filter",
          animation: selecting ? "cardPickPulse 0.24s ease-out forwards" : undefined,
        }}
      >
        {/* Pointer tilt layer (DOM-driven) */}
        <div
          ref={tiltRef}
          onPointerMove={onPointerMove}
          onPointerLeave={resetTilt}
          onPointerCancel={resetTilt}
          className="relative"
          style={{ transformStyle: "preserve-3d", transition: TILT_SLOW, willChange: "transform" }}
        >
          {/* Card face + floor reflection */}
          <div
            className={cn(
              "relative aspect-[3/4] w-full overflow-hidden rounded-xl border bg-[#101010]",
              "transition-[border-color,box-shadow] duration-500",
              isSelected
                ? "border-white/20 card-shadow-store-selected"
                : near
                  ? "border-white/[0.07] card-shadow-store-mid"
                  : "border-white/[0.04] card-shadow-store-far",
            )}
            style={
              {
                WebkitBoxReflect:
                  "below 12px linear-gradient(to bottom, transparent 76%, rgba(0,0,0,0.3) 100%)",
              } as React.CSSProperties
            }
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

            {/* One light sweep when the card lands center — replaces the old looping shimmer */}
            {isSelected && <div aria-hidden className="store-sheen" />}

            {/* Pointer-follow shine (selected only; driven from onPointerMove) */}
            <div
              ref={shineRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[2] opacity-0 mix-blend-screen transition-opacity duration-300"
            />

            {/* Glass edge */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[3] rounded-xl"
              style={{
                background:
                  "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 28%, transparent 55%, rgba(0,0,0,0.12) 100%)",
                mixBlendMode: "overlay",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
