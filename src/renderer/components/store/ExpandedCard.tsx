import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type { Game, LocalLibraryFile, SystemSpec } from "@shared/schemas";
import { useLocalLibraryFile, useSaveLocalLibraryFile } from "../../hooks/useLocalLibraryFile";
import { formatBytes } from "../../lib/formatBytes";
import { platformIcon, platformLabel, emulatorLabel } from "../../lib/platformIcons";
import { isStoreTemplateId } from "../../data/storeTemplateGames";
import { preferHigherResImageUrl, resolveStoreCoverImage } from "../../lib/storeGame";
import arrowPrev from "../../assets/icons/arrow-prev-svgrepo-com.svg";

const MAX_TILT = 15;

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-[#2a2a2a] via-[#222] to-transparent" />;
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="py-4">{children}</div>;
}

function Label({ children }: { children: string }) {
  return (
    <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.25em] text-[#555]">
      {children}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 py-0.5 text-[12px]">
      <span className="text-[#666]">{label}</span>
      <span className="text-right text-[#bbb]">{value}</span>
    </div>
  );
}

function SpecBlock({ title, spec }: { title: string; spec: SystemSpec }) {
  if (!spec.os && !spec.cpu && !spec.gpu && !spec.ram && !spec.storage) return null;
  return (
    <div className="space-y-0.5">
      <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.2em] text-[#484848]">{title}</p>
      {spec.os && <Row label="OS" value={spec.os} />}
      {spec.cpu && <Row label="CPU" value={spec.cpu} />}
      {spec.gpu && <Row label="GPU" value={spec.gpu} />}
      {spec.ram && <Row label="RAM" value={spec.ram} />}
      {spec.storage && <Row label="Storage" value={spec.storage} />}
    </div>
  );
}

export function ExpandedCard({
  game,
  onClose,
}: {
  game: Game;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const { data: localLib } = useLocalLibraryFile();
  const saveLibrary = useSaveLocalLibraryFile();

  const inLibrary = useMemo(
    () => localLib?.games.some((e) => e.gameId === game.id) ?? false,
    [localLib?.games, game.id],
  );

  const toggleLibrary = useCallback(() => {
    const current: LocalLibraryFile = localLib ?? { version: 1, games: [] };
    if (inLibrary) {
      saveLibrary.mutate({
        ...current,
        games: current.games.filter((e) => e.gameId !== game.id),
      });
    } else {
      saveLibrary.mutate({
        ...current,
        games: [
          ...current.games,
          {
            gameId: game.id,
            installed: false,
            installPath: null,
            installedVersion: null,
            downloadState: "not_installed",
            lastPlayedAt: null,
            pinned: false,
            source: "server",
          },
        ],
      });
    }
  }, [localLib, game.id, inLibrary, saveLibrary]);

  const [entered, setEntered] = useState(false);
  const [pointer, setPointer] = useState({ x: 50, y: 50, active: false });
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      setTilt({ rx: -(y - 0.5) * MAX_TILT, ry: (x - 0.5) * MAX_TILT });
      setPointer({ x: x * 100, y: y * 100, active: true });
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setTilt({ rx: 0, ry: 0 });
    setPointer((p) => ({ ...p, active: false }));
  }, []);

  const icon = platformIcon(game.platform);
  const emu = game.emulator ?? { required: false as const };
  const emuReq = emu.required ? emu : null;
  const minSpec = game.systemRequirements?.minimum;
  const recSpec = game.systemRequirements?.recommended;
  const screenshots = game.screenshots ?? [];
  const heroCover = resolveStoreCoverImage(game);
  const tags = game.tags ?? [];
  const hyp = Math.min(1, Math.sqrt(((pointer.x - 50) / 50) ** 2 + ((pointer.y - 50) / 50) ** 2));

  return (
    <div
      className="absolute inset-0 z-40 overflow-hidden"
      style={{
        backgroundColor: "#1a1a1a",
      }}
    >
      {/* Back */}
      <button
        onClick={onClose}
        className="absolute left-6 top-5 z-50 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[#555] transition-colors hover:text-[#ccc]"
        style={{ opacity: entered ? 1 : 0, transition: "opacity 0.4s ease 0.2s" }}
      >
        <img src={arrowPrev} alt="" className="h-3.5 w-3.5 invert opacity-40" draggable={false} />
        Back
      </button>

      {/* Main layout */}
      <div
        className="flex h-full items-center justify-center gap-14 px-16"
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? "translateY(0) scale(1)" : "translateY(24px) scale(0.94)",
          transition: "opacity 0.45s cubic-bezier(0.25,0.46,0.45,0.94), transform 0.55s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {/* ── Interactive card ── */}
        <div className="shrink-0" style={{ perspective: "900px" }}>
          <div
            ref={cardRef}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerCancel={onPointerLeave}
            className="relative cursor-crosshair"
            style={{
              width: "260px",
              transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
              transition: pointer.active
                ? "transform 0.06s linear"
                : "transform 0.7s cubic-bezier(0.34,1.56,0.64,1)",
              transformStyle: "preserve-3d",
              willChange: "transform",
            }}
          >
            <div
              className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border bg-[#1a1a1a]"
              style={{
                borderColor: pointer.active
                  ? `hsl(210, 55%, ${35 + hyp * 25}%)`
                  : "#3a3a3a",
                boxShadow: pointer.active
                  ? `0 0 ${20 + hyp * 35}px ${4 + hyp * 10}px rgba(80,180,230,${0.12 + hyp * 0.22}), 0 30px 60px -15px rgba(0,0,0,0.75)`
                  : "0 0 12px 2px rgba(80,180,230,0.07), 0 30px 60px -15px rgba(0,0,0,0.65)",
                transition: pointer.active
                  ? "border-color 0.06s linear, box-shadow 0.06s linear"
                  : "border-color 0.6s ease, box-shadow 0.6s ease",
              }}
            >
              {heroCover ? (
                <img src={heroCover} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-[#272727] to-[#111] px-4 text-center">
                  <span className="text-[9px] font-medium uppercase tracking-[0.25em] text-[#3a3a3a]">
                    {isStoreTemplateId(game.id) ? "No Cover" : "No Cover"}
                  </span>
                </div>
              )}

              {/* Glare follows cursor */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 mix-blend-screen"
                style={{
                  background: `radial-gradient(farthest-corner ellipse at ${pointer.x}% ${pointer.y}%, rgba(255,255,255,0.22) 0%, rgba(200,230,255,0.06) 40%, transparent 70%)`,
                  opacity: pointer.active ? 1 : 0,
                  transition: pointer.active ? "opacity 0.06s linear" : "opacity 0.6s ease",
                }}
              />

              {/* Constant edge sheen */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-xl mix-blend-overlay"
                style={{
                  background: "linear-gradient(145deg, rgba(255,255,255,0.07) 0%, transparent 45%, rgba(0,0,0,0.1) 100%)",
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Info panel ── */}
        <div
          className="flex min-w-0 flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            width: "420px",
            maxHeight: "75vh",
            overflowY: "auto",
            opacity: entered ? 1 : 0,
            transform: entered ? "translateX(0)" : "translateX(18px)",
            transition: "opacity 0.4s ease 0.12s, transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94) 0.12s",
          }}
        >
          {/* Banner image */}
          <div className="mb-5 aspect-[16/6] w-full overflow-hidden rounded-lg">
            {game.bannerImage ? (
              <img
                src={preferHigherResImageUrl(game.bannerImage) ?? game.bannerImage}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#242424] to-[#1a1a1a]">
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#333]">No Banner</span>
              </div>
            )}
          </div>

          {/* Platform + title */}
          <div className="mb-1 flex items-center gap-2.5">
            {icon && (
              <img src={icon} alt="" className="h-5 w-5 shrink-0 object-contain invert opacity-35" draggable={false} />
            )}
            <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-[#555]">
              {platformLabel(game.platform)}
            </span>
          </div>

          <h1
            className="font-bold leading-tight tracking-tight text-white/90"
            style={{ fontSize: "clamp(20px, 2.8vw, 28px)" }}
          >
            {game.title}
          </h1>

          <div className="mt-1.5 mb-4 flex flex-wrap gap-x-1.5 text-[11px] text-[#555]">
            {game.developer && <span>{game.developer}</span>}
            {game.publisher && game.publisher !== game.developer && (
              <><span>·</span><span>{game.publisher}</span></>
            )}
            {game.releaseDate && (
              <><span>·</span><span>{game.releaseDate.slice(0, 4)}</span></>
            )}
          </div>

          {/* Primary action — up top for retention */}
          <button
            type="button"
            onClick={toggleLibrary}
            disabled={saveLibrary.isPending}
            className="mb-5 w-full py-3 text-[11px] font-semibold uppercase tracking-[0.18em] transition-all disabled:opacity-50"
            style={{
              background: inLibrary
                ? "linear-gradient(to right, #2a1515 0%, #1c0e0e 100%)"
                : "linear-gradient(to right, #1a3a1a 0%, #152515 100%)",
              color: inLibrary ? "#c47070" : "#7ac47a",
              boxShadow: inLibrary ? "none" : "0 0 20px rgba(80,160,80,0.15)",
            }}
          >
            {saveLibrary.isPending
              ? "Saving…"
              : inLibrary
                ? "Remove from library"
                : "Add to library"}
          </button>

          <Divider />

          {game.description && (
            <>
              <Section>
                <Label>About</Label>
                <p className="text-[12px] leading-relaxed text-[#888]">{game.description}</p>
              </Section>
              <Divider />
            </>
          )}

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <>
              <Section>
                <Label>Screenshots</Label>
                <div
                  className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{ marginLeft: "-2px", paddingLeft: "2px" }}
                >
                  {screenshots.map((src, i) => (
                    <div
                      key={i}
                      className="shrink-0 cursor-pointer overflow-hidden rounded-md transition-transform hover:scale-105"
                      style={{ width: "120px", height: "68px" }}
                    >
                      <img
                        src={preferHigherResImageUrl(src) ?? src}
                        alt={`Screenshot ${i + 1}`}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              </Section>
              <Divider />
            </>
          )}

          {typeof game.sizeBytes === "number" && (
            <>
              <Section>
                <Label>Size</Label>
                <p className="text-[13px] font-medium text-[#bbb]">{formatBytes(game.sizeBytes)}</p>
              </Section>
              <Divider />
            </>
          )}

          {emuReq && (
            <>
              <Section>
                <Label>Emulator required</Label>
                <p className="text-[12px] text-[#bbb]">
                  {emulatorLabel(emuReq.emulator)}
                  {emuReq.emulatorVersion && <span className="text-[#555]"> · v{emuReq.emulatorVersion}</span>}
                </p>
                {emuReq.setupNotes && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#666]">{emuReq.setupNotes}</p>
                )}
              </Section>
              <Divider />
            </>
          )}

          {(minSpec || recSpec) && (
            <>
              <Section>
                <Label>System requirements</Label>
                <div className="space-y-4">
                  {minSpec && <SpecBlock title="Minimum" spec={minSpec} />}
                  {recSpec && <SpecBlock title="Recommended" spec={recSpec} />}
                </div>
              </Section>
              <Divider />
            </>
          )}

          {tags.length > 0 && (
            <>
              <Section>
                <Label>Tags</Label>
                <p className="text-[11px] text-[#666]">{tags.join("  ·  ")}</p>
              </Section>
              <Divider />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
