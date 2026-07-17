/**
 * Non-invasive hardware / OS snapshot for the launcher.
 * Uses systeminformation + Electron screen (displays). No processes, users, or network dumps.
 */
const si = require("systeminformation");
const { screen } = require("electron");

/** Strip placeholders so the UI / API only show real IDs when present. */
function normalizeId(v) {
  if (v == null || typeof v !== "string") return null;
  const t = v.trim();
  if (t === "" || t === "-") return null;
  const lower = t.toLowerCase();
  if (lower.includes("o.e.m.") || lower.includes("to be filled")) return null;
  if (lower === "not available" || lower === "default string") return null;
  return t;
}

async function collectSystemInfo() {
  const [
    cpu,
    mem,
    disks,
    gpu,
    os,
    system,
    battery,
    time,
    baseboard,
    uuidPack,
  ] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.graphics(),
    si.osInfo(),
    Promise.resolve(si.system()).catch(() => null),
    Promise.resolve(si.battery()).catch(() => null),
    Promise.resolve(si.time()).catch(() => null),
    Promise.resolve(si.baseboard()).catch(() => null),
    Promise.resolve(si.uuid()).catch(() => null),
  ]);

  const primary = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays().map((d) => ({
    width: d.bounds.width,
    height: d.bounds.height,
    scaleFactor: d.scaleFactor,
    refreshRate: d.displayFrequency ?? null,
    rotation: d.rotation,
    primary: d.id === primary.id,
  }));

  return {
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      physicalCores: cpu.physicalCores,
      cores: cpu.cores,
      speedMax: cpu.speedMax,
      speed: cpu.speed,
    },
    memory: {
      total: mem.total,
      free: mem.free,
      used: mem.used,
      active: mem.active,
    },
    disks: disks.map((d) => ({
      fs: d.fs,
      type: d.type,
      mount: d.mount,
      size: d.size,
      available: d.available,
      used: d.used,
      use: d.use,
    })),
    gpu: (gpu.controllers || []).map((g) => ({
      model: g.model,
      vendor: g.vendor,
      vram: g.vram,
      vramDynamic: g.vramDynamic,
    })),
    displays,
    os: {
      platform: os.platform,
      distro: os.distro,
      release: os.release,
      arch: os.arch,
      hostname: os.hostname,
      kernel: os.kernel,
    },
    machine: system
      ? {
          manufacturer: system.manufacturer,
          model: system.model,
          version: system.version,
          virtual: system.virtual,
          serial: normalizeId(system.serial),
          uuid: normalizeId(system.uuid),
        }
      : null,
    /**
     * Machine-scoped identifiers from SMBIOS / WMI / OS (no MAC addresses).
     * - hardwareUuid ≈ Win32_ComputerSystemProduct UUID (Windows) / product UUID (Linux)
     * - windowsMachineGuid = HKLM\...\Cryptography\MachineGuid (Windows install id)
     * - baseboardSerial = motherboard serial when the OEM exposes it
     */
    deviceIdentity: {
      systemUuid: normalizeId(system?.uuid),
      systemSerial: normalizeId(system?.serial),
      baseboardSerial: normalizeId(baseboard?.serial),
      motherboardManufacturer: baseboard?.manufacturer?.trim() || null,
      motherboardModel: baseboard?.model?.trim() || null,
      windowsMachineGuid: normalizeId(uuidPack?.os),
      hardwareUuid: normalizeId(uuidPack?.hardware),
    },
    battery: battery && battery.hasBattery
      ? {
          hasBattery: true,
          percent: battery.percent,
          isCharging: battery.ischarging,
          acConnected: battery.acconnected,
        }
      : { hasBattery: false },
    time: time
      ? {
          uptime: time.uptime,
          timezone: time.timezone,
        }
      : null,
    collectedAt: Date.now(),
  };
}

async function hasSufficientSpace(requiredBytes, preferredMount = null) {
  const disks = await si.fsSize();

  const target = preferredMount
    ? disks.find((d) => d.mount === preferredMount)
    : [...disks].sort((a, b) => b.available - a.available)[0];

  if (!target) {
    return { ok: false, reason: "No disk found" };
  }

  const ok = target.available > requiredBytes;
  return {
    ok,
    available: target.available,
    mount: target.mount,
    reason: ok ? null : "Not enough space",
  };
}

module.exports = { collectSystemInfo, hasSufficientSpace };
