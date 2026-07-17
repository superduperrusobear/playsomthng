import { useMemo } from "react";
import { useSysinfo } from "../../hooks/useSysinfo";
import { formatBytes } from "../../lib/formatBytes";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { prepareStorageVolumes, StorageVolumesList } from "../../components/settings/StorageVolumesList";
import { SettingsBackLink } from "./SettingsBackLink";
import { settingsMetaForPath } from "./settingsNav";

type SysinfoPayload = {
  cpu?: {
    manufacturer?: string;
    brand?: string;
    physicalCores?: number;
    cores?: number;
    speedMax?: number;
    speed?: number;
  };
  memory?: {
    total?: number;
    free?: number;
    used?: number;
    active?: number;
  };
  disks?: Array<{
    fs?: string;
    type?: string;
    mount?: string;
    size?: number;
    available?: number;
    used?: number;
    use?: number;
  }>;
  gpu?: Array<{
    model?: string;
    vendor?: string;
    vram?: number | null;
    vramDynamic?: boolean;
  }>;
  displays?: Array<{
    width?: number;
    height?: number;
    scaleFactor?: number;
    refreshRate?: number | null;
    rotation?: number;
    primary?: boolean;
  }>;
  os?: {
    platform?: string;
    distro?: string;
    release?: string;
    arch?: string;
    hostname?: string;
    kernel?: string;
  };
  machine?: {
    manufacturer?: string;
    model?: string;
    version?: string;
    virtual?: boolean;
    serial?: string | null;
    uuid?: string | null;
  } | null;
  /** Normalized machine IDs (SMBIOS / OS); see electron/sysinfo.js */
  deviceIdentity?: {
    systemUuid?: string | null;
    systemSerial?: string | null;
    baseboardSerial?: string | null;
    motherboardManufacturer?: string | null;
    motherboardModel?: string | null;
    windowsMachineGuid?: string | null;
    hardwareUuid?: string | null;
  };
  battery?: {
    hasBattery?: boolean;
    percent?: number;
    isCharging?: boolean;
    acConnected?: boolean;
  };
  time?: {
    uptime?: number;
    timezone?: string;
  } | null;
  collectedAt?: number;
};

function BlockTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[#9a9a9a]">
      {children}
    </h2>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-1 text-[13px] leading-snug">
      <span className="text-[#8a8a8a]">{label}</span>
      <span className="text-[#e8e8e8]">{value}</span>
    </div>
  );
}

const subBlockClass =
  "space-y-2 border-t border-[#2c2c2c]/90 pt-3 first:border-t-0 first:pt-0";

export function SystemInfoPage() {
  const { data, isLoading, isError } = useSysinfo();

  /** Must run every render — do not place after loading/error early returns (hooks rule). */
  const { disks } = useMemo(
    () => prepareStorageVolumes((data as SysinfoPayload | undefined)?.disks ?? []),
    [data],
  );

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsBackLink />
        <SettingsSurface>
          <SettingsSection>
            <p className="text-[13px] text-[#a0a0a0]">Loading…</p>
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
            <p className="text-[13px] text-[#b0b0b0]">Couldn’t load system info.</p>
          </SettingsSection>
        </SettingsSurface>
      </div>
    );
  }

  const s = data as SysinfoPayload;
  const os = s.os;
  const cpu = s.cpu;
  const mem = s.memory;
  const machine = s.machine;
  const bat = s.battery;

  const osName = [os?.distro || os?.platform, os?.release].filter(Boolean).join(" ") || "—";
  const pageMeta = settingsMetaForPath("/settings/system");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsBackLink />

      <SettingsSurface className="pb-10">
        {pageMeta && (
          <SettingsSection>
            <div className="flex gap-3">
              <img
                src={pageMeta.icon}
                alt=""
                className="h-6 w-6 shrink-0 object-contain invert opacity-75"
                draggable={false}
              />
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#b0b0b0]">
                  {pageMeta.label}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[#7a7a7a]">{pageMeta.description}</p>
              </div>
            </div>
          </SettingsSection>
        )}

        <SettingsSection>
          <BlockTitle>Operating system</BlockTitle>
          <div className="space-y-2">
            <Row label="Name" value={osName} />
            {os?.arch != null && os.arch !== "" && <Row label="Architecture" value={os.arch} />}
          </div>
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>Device identifiers</BlockTitle>
          <p className="mb-3 text-[11px] leading-relaxed text-[#5a5a5a]">
            Hardware and OS-level IDs from SMBIOS / WMI (Windows) or DMI (Linux). Useful for anonymous device
            recognition — not your Microsoft account. Some OEMs hide motherboard serials;{" "}
            <span className="text-[#7a7a7a]">hardwareUuid</span> /{" "}
            <span className="text-[#7a7a7a]">windowsMachineGuid</span> are usually still present on Windows.
          </p>
          <div className="space-y-2">
            {(() => {
              const d = s.deviceIdentity;
              if (!d) {
                return <p className="text-[13px] text-[#a8a8a8]">No device identity block.</p>;
              }
              const rows: { label: string; value: string | null | undefined }[] = [
                { label: "Hardware UUID (SMBIOS / system product)", value: d.hardwareUuid ?? undefined },
                { label: "System UUID (DMI)", value: d.systemUuid ?? undefined },
                { label: "System serial", value: d.systemSerial ?? undefined },
                { label: "Motherboard serial", value: d.baseboardSerial ?? undefined },
                { label: "Motherboard", value: [d.motherboardManufacturer, d.motherboardModel].filter(Boolean).join(" ") || undefined },
                { label: "Windows MachineGuid (registry)", value: d.windowsMachineGuid ?? undefined },
              ].filter((r) => r.value != null && String(r.value).trim() !== "");
              if (rows.length === 0) {
                return <p className="text-[13px] text-[#a8a8a8]">No IDs reported (permissions or OEM placeholders).</p>;
              }
              return rows.map((r) => <Row key={r.label} label={r.label} value={String(r.value)} />);
            })()}
          </div>
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>CPU</BlockTitle>
          <div className="space-y-2">
            {cpu?.brand != null && cpu.brand !== "" && <Row label="Model" value={cpu.brand} />}
            {typeof cpu?.physicalCores === "number" && typeof cpu?.cores === "number" && (
              <Row label="Cores" value={`${cpu.physicalCores} physical · ${cpu.cores} logical`} />
            )}
          </div>
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>Memory</BlockTitle>
          <div className="space-y-2">
            {typeof mem?.total === "number" && (
              <Row label="Installed" value={formatBytes(mem.total)} />
            )}
          </div>
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>System</BlockTitle>
          <div className="space-y-2">
            {machine == null ? (
              <p className="text-[13px] text-[#a8a8a8]">No system board info.</p>
            ) : (
              <>
                {machine.manufacturer != null && machine.manufacturer !== "" && (
                  <Row label="Manufacturer" value={machine.manufacturer} />
                )}
                {machine.model != null && machine.model !== "" && <Row label="Model" value={machine.model} />}
              </>
            )}
          </div>
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>Graphics</BlockTitle>
          {!s.gpu?.length ? (
            <p className="text-[13px] text-[#a8a8a8]">No GPU data reported.</p>
          ) : (
            <ul className="space-y-0">
              {s.gpu.map((g, i) => (
                <li key={i} className={subBlockClass}>
                  {g.model != null && g.model !== "" && <Row label="GPU" value={g.model} />}
                  {typeof g.vram === "number" && g.vram > 0 && (
                    <Row label="VRAM" value={`${g.vram} MB`} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>Storage volumes</BlockTitle>
          {disks.length === 0 ? (
            <p className="text-[13px] text-[#a8a8a8]">No drives reported.</p>
          ) : (
            <StorageVolumesList disks={disks} highlightPreferred={false} showSectionHeading={false} />
          )}
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>Displays</BlockTitle>
          {!s.displays?.length ? (
            <p className="text-[13px] text-[#a8a8a8]">No display data.</p>
          ) : (
            <ul className="space-y-0">
              {s.displays.map((d, i) => (
                <li key={i} className={subBlockClass}>
                  <Row label="Resolution" value={`${d.width ?? "?"} × ${d.height ?? "?"}`} />
                  {d.refreshRate != null && d.refreshRate > 0 && (
                    <Row label="Refresh" value={`${d.refreshRate} Hz`} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <SettingsSection>
          <BlockTitle>Power</BlockTitle>
          {!bat?.hasBattery ? (
            <p className="text-[13px] text-[#a8a8a8]">No battery (desktop or unknown).</p>
          ) : (
            <div className="space-y-2">
              {typeof bat.percent === "number" && <Row label="Charge" value={`${bat.percent}%`} />}
              {typeof bat.isCharging === "boolean" && (
                <Row label="Charging" value={bat.isCharging ? "Yes" : "No"} />
              )}
            </div>
          )}
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
