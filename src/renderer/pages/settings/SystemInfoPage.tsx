import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { useSysinfo } from "../../hooks/useSysinfo";
import { formatBytes } from "../../lib/formatBytes";
import { SettingsBackLink } from "./SettingsBackLink";

type DiskInfo = {
  fs?: string;
  type?: string;
  mount?: string;
  size?: number;
  available?: number;
  used?: number;
};

type SysinfoPayload = {
  cpu?: { brand?: string; physicalCores?: number; cores?: number };
  memory?: { total?: number; free?: number; used?: number; active?: number };
  disks?: DiskInfo[];
  gpu?: Array<{ model?: string; vram?: number | null }>;
  displays?: Array<{
    width?: number;
    height?: number;
    refreshRate?: number | null;
    primary?: boolean;
  }>;
  os?: {
    platform?: string;
    distro?: string;
    release?: string;
    arch?: string;
    hostname?: string;
  };
  machine?: { manufacturer?: string; model?: string; virtual?: boolean } | null;
  battery?: { hasBattery?: boolean; percent?: number; isCharging?: boolean };
  time?: { uptime?: number } | null;
};

function humanUptime(seconds?: number): string {
  if (seconds == null || seconds <= 0) return "Unavailable";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function usagePercent(used?: number, total?: number): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

function driveName(disk: DiskInfo, index: number): string {
  const mount = disk.mount?.replace(/[/\\]+$/, "").trim();
  const windowsDrive = mount?.match(/^([A-Za-z]):$/);
  if (windowsDrive) return `Drive ${windowsDrive[1].toUpperCase()}:`;
  return mount || disk.fs || `Storage ${index + 1}`;
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 py-2">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#565656]">{label}</dt>
      <dd className="mt-2 truncate text-[13px] font-medium text-white/85" title={value}>
        {value}
      </dd>
      {detail && <p className="mt-1 truncate text-[10px] text-[#656565]">{detail}</p>}
    </div>
  );
}

export function SystemInfoPage() {
  const { data, isLoading, isError } = useSysinfo();

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsBackLink />
        <SettingsSurface>
          <SettingsSection>
            <p className="text-[11px] text-[#666]">Reading this PC…</p>
          </SettingsSection>
        </SettingsSurface>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsBackLink />
        <SettingsSurface>
          <SettingsSection>
            <p className="text-[11px] text-[#a97777]">Could not read system information.</p>
          </SettingsSection>
        </SettingsSurface>
      </div>
    );
  }

  const system = data as SysinfoPayload;
  const osName =
    [system.os?.distro || system.os?.platform, system.os?.release].filter(Boolean).join(" ") ||
    "Unknown operating system";
  const machineName =
    [system.machine?.manufacturer, system.machine?.model].filter(Boolean).join(" ") ||
    system.os?.hostname ||
    "This PC";
  const memoryUsed = system.memory?.used ?? system.memory?.active;
  const memoryPercent = usagePercent(memoryUsed, system.memory?.total);
  const gpu = system.gpu?.find((item) => item.model) ?? system.gpu?.[0];
  const coreDetail =
    system.cpu?.physicalCores != null && system.cpu?.cores != null
      ? `${system.cpu.physicalCores} physical · ${system.cpu.cores} logical cores`
      : undefined;

  const seenDrives = new Set<string>();
  const drives = (system.disks ?? []).filter((disk) => {
    if (typeof disk.size !== "number" || disk.size <= 0) return false;
    const key = `${disk.mount ?? disk.fs ?? ""}:${disk.size}`;
    if (seenDrives.has(key)) return false;
    seenDrives.add(key);
    return true;
  });
  drives.sort((a, b) => {
    const aMount = a.mount ?? "";
    const bMount = b.mount ?? "";
    const aMain = /^C:/i.test(aMount) ? 0 : 1;
    const bMain = /^C:/i.test(bMount) ? 0 : 1;
    return aMain - bMain || aMount.localeCompare(bMount);
  });
  const totalStorage = drives.reduce((sum, disk) => sum + (disk.size ?? 0), 0);
  const freeStorage = drives.reduce((sum, disk) => sum + (disk.available ?? 0), 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface className="pb-10">
        <SettingsSection className="py-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#667b68]">System</p>
              <h1 className="mt-2 truncate font-title text-[clamp(1.7rem,4vw,2.6rem)] uppercase tracking-[0.08em] text-white/95">
                {machineName}
              </h1>
              <p className="mt-2 text-[11px] text-[#666]">
                {osName} {system.os?.arch ? `· ${system.os.arch}` : ""}
              </p>
            </div>
            <div className="shrink-0 sm:text-right">
              <p className="text-[8px] uppercase tracking-[0.15em] text-[#4f4f4f]">Uptime</p>
              <p className="mt-1 text-[11px] text-[#888]">{humanUptime(system.time?.uptime)}</p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection className="py-7">
          <h2 className="font-title text-[13px] uppercase tracking-[0.16em] text-white/80">
            Hardware at a glance
          </h2>
          <dl className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Processor" value={system.cpu?.brand || "Not reported"} detail={coreDetail} />
            <Metric
              label="Memory"
              value={system.memory?.total ? formatBytes(system.memory.total) : "Not reported"}
              detail={memoryPercent != null ? `${memoryPercent}% in use` : undefined}
            />
            <Metric
              label="Graphics"
              value={gpu?.model || "Not reported"}
              detail={gpu?.vram ? `${gpu.vram} MB VRAM` : undefined}
            />
            <Metric
              label="Total storage"
              value={totalStorage > 0 ? formatBytes(totalStorage) : "Not reported"}
              detail={totalStorage > 0 ? `${formatBytes(freeStorage)} free` : undefined}
            />
          </dl>
        </SettingsSection>

        <SettingsSection className="py-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-title text-[13px] uppercase tracking-[0.16em] text-white/80">Storage</h2>
            <span className="text-[9px] text-[#555]">
              {drives.length} {drives.length === 1 ? "drive" : "drives"}
            </span>
          </div>

          {drives.length === 0 ? (
            <p className="mt-5 text-[11px] text-[#666]">No storage reported.</p>
          ) : (
            <div className="mt-4">
              {drives.map((disk, index) => {
                const total = disk.size ?? 0;
                const free = disk.available ?? 0;
                const used = Math.max(0, disk.used ?? total - free);
                const usedPercent = usagePercent(used, total) ?? 0;
                return (
                  <div
                    key={`${disk.mount ?? disk.fs ?? index}-${index}`}
                    className="border-b border-white/[0.055] py-5 last:border-b-0"
                  >
                    <div className="flex items-baseline justify-between gap-5">
                      <div className="min-w-0">
                        <p className="truncate font-title text-[15px] tracking-[0.06em] text-[#c9c9c9]">
                          {driveName(disk, index)}
                        </p>
                        <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-[#505050]">
                          {disk.type || disk.fs || "Local storage"}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-[10px] tabular-nums text-[#777]">
                        <span className="text-[#aaa]">{formatBytes(free)}</span> free of {formatBytes(total)}
                      </p>
                    </div>
                    <div className="mt-4 h-[2px] bg-white/[0.055]">
                      <div
                        className="h-full bg-[#718d74]"
                        style={{ width: `${usedPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>

        <SettingsSection className="py-7">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-title text-[12px] uppercase tracking-[0.16em] text-white/75">Displays</h2>
              <div className="mt-4">
                {!system.displays?.length ? (
                  <p className="text-[11px] text-[#666]">No display details.</p>
                ) : (
                  system.displays.map((display, index) => (
                    <div
                      key={index}
                      className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-3 last:border-b-0"
                    >
                      <span className="text-[11px] text-[#aaa]">
                        {display.width ?? "?"} × {display.height ?? "?"}
                      </span>
                      <span className="text-[9px] text-[#5e5e5e]">
                        {display.refreshRate ? `${display.refreshRate} Hz` : "Unknown refresh"}
                        {display.primary ? " · Primary" : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h2 className="font-title text-[12px] uppercase tracking-[0.16em] text-white/75">
                Platform
              </h2>
              <dl className="mt-4">
                <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-3">
                  <dt className="text-[10px] text-[#666]">Computer</dt>
                  <dd className="text-[10px] text-[#aaa]">
                    {system.machine?.virtual ? "Virtual machine" : "Physical computer"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-[10px] text-[#666]">Power</dt>
                  <dd className="text-[10px] text-[#aaa]">
                    {system.battery?.hasBattery
                      ? `${Math.round(system.battery.percent ?? 0)}%${
                          system.battery.isCharging ? " · Charging" : ""
                        }`
                      : "AC powered"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
