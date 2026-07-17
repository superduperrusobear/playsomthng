import type { Platform } from "@shared/schemas";

import windowsIcon from "../assets/icons/windows-174.svg";
import ps2Icon from "../assets/icons/playstation2.svg";
import ps3Icon from "../assets/icons/playstation3.svg";
import ps4Icon from "../assets/icons/playstation4.svg";
import pspIcon from "../assets/icons/playstationportable.svg";
import psvitaIcon from "../assets/icons/playstationvita.svg";
import xboxIcon from "../assets/icons/xbox-9-logo.svg";
import xboxOneIcon from "../assets/icons/xbox-one-3-logo.svg";
import wiiIcon from "../assets/icons/wii-svgrepo-com.svg";
import wiiuIcon from "../assets/icons/brand-wiiu.svg";

const PLATFORM_ICON_MAP: Partial<Record<Platform, string>> = {
  pc: windowsIcon,
  ps2: ps2Icon,
  ps3: ps3Icon,
  ps4: ps4Icon,
  ps5: ps4Icon,
  ps1: ps2Icon,
  psp: pspIcon,
  psvita: psvitaIcon,
  xbox: xboxIcon,
  xbox360: xboxIcon,
  xboxone: xboxOneIcon,
  wii: wiiIcon,
  wiiu: wiiuIcon,
};

const PLATFORM_LABEL: Record<Platform, string> = {
  pc: "PC",
  ps1: "PS1",
  ps2: "PS2",
  ps3: "PS3",
  ps4: "PS4",
  ps5: "PS5",
  xbox: "Xbox",
  xbox360: "Xbox 360",
  xboxone: "Xbox One",
  nes: "NES",
  snes: "SNES",
  n64: "N64",
  gamecube: "GameCube",
  wii: "Wii",
  wiiu: "Wii U",
  switch: "Switch",
  gba: "GBA",
  nds: "NDS",
  "3ds": "3DS",
  psp: "PSP",
  psvita: "PS Vita",
  arcade: "Arcade",
  other: "Other",
};

const EMULATOR_LABEL: Record<string, string> = {
  rpcs3: "RPCS3",
  pcsx2: "PCSX2",
  duckstation: "DuckStation",
  dolphin: "Dolphin",
  cemu: "Cemu",
  yuzu: "Yuzu",
  ryujinx: "Ryujinx",
  xemu: "Xemu",
  xenia: "Xenia",
  ppsspp: "PPSSPP",
  vita3k: "Vita3K",
  melonds: "melonDS",
  citra: "Citra",
  mame: "MAME",
  retroarch: "RetroArch",
  other: "Other",
};

export function platformIcon(p: Platform): string | undefined {
  return PLATFORM_ICON_MAP[p];
}

export function platformLabel(p: Platform): string {
  return PLATFORM_LABEL[p] ?? p;
}

export function emulatorLabel(e: string): string {
  return EMULATOR_LABEL[e] ?? e;
}
