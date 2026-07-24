import { HardDrive, Star } from "lucide-react";
import { formatStorageMetric } from "../../lib/formatBytes";
import { cn } from "../../lib/cn";

export type StorageVolumeDisk = {
  fs?: string;
  mount?: string;
  size?: number;
  available?: number;
};

function normalizeMount(mount: string | undefined): string {
  if (!mount) return "";
  return mount.replace(/[/\\]+$/, "").trim();
}

/** e.g. `Local Disk (C:)` on Windows */
export function friendlyVolumeLabel(mount: string | undefined): string {
  const norm = normalizeMount(mount);
  const m = /^([A-Za-z]):$/i.exec(norm);
  if (m) return `Local Disk (${m[1].toUpperCase()}:)`;
  if (norm) return norm.length > 32 ? `…${norm.slice(-28)}` : norm;
  return "Volume";
}

export function prepareStorageVolumes(raw: StorageVolumeDisk[]): {
  disks: StorageVolumeDisk[];
} {
  const copy = [...raw].filter((d) => typeof d.size === "number" && d.size > 0);
  copy.sort((a, b) => {
    const aC = normalizeMount(a.mount).toUpperCase().startsWith("C:") ? 0 : 1;
    const bC = normalizeMount(b.mount).toUpperCase().startsWith("C:") ? 0 : 1;
    if (aC !== bC) return aC - bC;
    return (a.mount ?? "").localeCompare(b.mount ?? "");
  });
  return { disks: copy };
}

/** True if this volume is the drive the user chose for installs (path may be deeper than mount). */
export function diskMatchesInstallPreference(diskMount: string | undefined, pref: string | null | undefined): boolean {
  if (!pref || !diskMount) return false;
  const d = normalizeMount(diskMount);
  const p = pref.trim();
  const winDrive = /^([A-Za-z]):/i;
  const dm = winDrive.exec(d);
  const pm = winDrive.exec(p);
  if (dm && pm) return dm[1].toUpperCase() === pm[1].toUpperCase();
  const nu = normalizeMount(p).toUpperCase();
  return d.toUpperCase() === nu || nu.startsWith(d.toUpperCase() + "/");
}

type Props = {
  disks: StorageVolumeDisk[];
  /** Install preference mount/path from settings — star highlights this volume only. */
  preferredMount?: string | null;
  /** When false, no star and no row highlight (e.g. System info). */
  highlightPreferred?: boolean;
  /** Heading line above the list (Storage page). System info uses its own BlockTitle — set false. */
  showSectionHeading?: boolean;
  sectionHeadingText?: string;
};

export function StorageVolumesList({
  disks,
  preferredMount = null,
  highlightPreferred = true,
  showSectionHeading = true,
  sectionHeadingText = "Volumes",
}: Props) {
  if (disks.length === 0) return null;

  return (
    <>
      {showSectionHeading ? (
        <p className="mb-4 font-title text-[11px] uppercase tracking-[0.2em] text-[#6a6a6a]">{sectionHeadingText}</p>
      ) : null}
      <ul className="space-y-0">
        {disks.map((d, i) => {
          const preferred =
            highlightPreferred && diskMatchesInstallPreference(d.mount, preferredMount);
          const free = typeof d.available === "number" ? d.available : 0;
          const total = typeof d.size === "number" ? d.size : 0;
          const freeStr = formatStorageMetric(free);
          const totalStr = formatStorageMetric(total);
          const metric = `${freeStr} free of ${totalStr}`.toUpperCase();
          const label = friendlyVolumeLabel(d.mount);
          return (
            <li
              key={`${d.mount ?? i}-${i}`}
              className="flex items-center gap-4 border-b border-white/[0.05] py-3.5 last:border-b-0"
            >
              <HardDrive
                className={cn("h-5 w-5 shrink-0", preferred ? "text-white" : "text-[#5c5c5c]")}
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "font-title text-[14px] tracking-[0.06em]",
                    preferred ? "text-white underline decoration-white/25 underline-offset-4" : "text-[#8a8a8a]",
                  )}
                >
                  {label}
                </span>
                {preferred && (
                  <span title="Preferred install drive" className="ml-1.5 inline-flex">
                    <Star
                      className="h-3.5 w-3.5 -translate-y-px text-amber-400"
                      fill="currentColor"
                      aria-hidden
                    />
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "shrink-0 max-w-[55%] text-right text-[10px] font-semibold uppercase leading-snug tracking-[0.05em] sm:max-w-none sm:text-[11px]",
                  preferred ? "text-white" : "text-[#6a6a6a]",
                )}
              >
                {metric}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
