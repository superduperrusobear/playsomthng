/**
 * Print the same systeminformation snapshot the app uses (minus Electron `screen` displays).
 * From repo root:  node scripts/dump-sysinfo.cjs
 */
const si = require("systeminformation");

function normalizeId(v) {
  if (v == null || typeof v !== "string") return null;
  const t = v.trim();
  if (t === "" || t === "-") return null;
  const lower = t.toLowerCase();
  if (lower.includes("o.e.m.") || lower.includes("to be filled")) return null;
  if (lower === "not available" || lower === "default string") return null;
  return t;
}

async function main() {
  const [cpu, mem, disks, gpu, os, system, battery, time, baseboard, uuidPack] = await Promise.all([
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

  const out = {
    note: "Displays come from Electron screen.* in the real app; not available in plain Node.",
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

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
