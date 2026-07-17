import type { Game } from "@shared/schemas";

/** Full Game objects so the profile overlay has data to display. */
export const STORE_TEMPLATE_GAMES: Game[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Test Title Alpha",
    slug: "test-title-alpha",
    description:
      "A fast-paced action RPG set in a sprawling open world. Master elemental combat, explore forgotten ruins, and shape the fate of a fractured kingdom.",
    coverImage: undefined,
    bannerImage: undefined,
    screenshots: [],
    platform: "pc",
    tags: ["action", "rpg", "open world"],
    developer: "Studio Null",
    publisher: "PlaySomthng Labs",
    releaseDate: "2025-03-15",
    emulator: { required: false },
    sizeBytes: 42_000_000_000,
    systemRequirements: {
      minimum: { os: "Windows 10", cpu: "Intel i5-8400", gpu: "GTX 1060", ram: "8 GB", storage: "42 GB" },
      recommended: { os: "Windows 11", cpu: "Ryzen 5 5600X", gpu: "RTX 3060", ram: "16 GB", storage: "42 GB" },
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Test Title Beta",
    slug: "test-title-beta",
    description:
      "A cinematic third-person adventure exclusive to the PS5. Navigate a sci-fi thriller with branching dialogue and real-time consequences.",
    coverImage: undefined,
    bannerImage: undefined,
    screenshots: [],
    platform: "ps5",
    tags: ["adventure", "story", "sci-fi"],
    developer: "Neon Arc",
    publisher: "PlaySomthng Labs",
    releaseDate: "2024-11-01",
    emulator: { required: false },
    sizeBytes: 67_500_000_000,
    systemRequirements: undefined,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    title: "Test Title Gamma",
    slug: "test-title-gamma",
    description:
      "A GameCube classic remastered. Sail the seas, solve puzzles, and battle ancient evils in cel-shaded glory. Requires Dolphin emulator.",
    coverImage: undefined,
    bannerImage: undefined,
    screenshots: [],
    platform: "gamecube",
    tags: ["adventure", "puzzle", "classic"],
    developer: "Retro Forge",
    publisher: "PlaySomthng Labs",
    releaseDate: "2003-03-24",
    emulator: { required: true, emulator: "dolphin", emulatorVersion: "5.0+", setupNotes: "Use ISO format. Enable dual-core for stable 60 fps." },
    sizeBytes: 1_400_000_000,
    systemRequirements: {
      minimum: { os: "Windows 10", cpu: "Intel i3-6100", gpu: "Intel HD 530", ram: "4 GB", storage: "1.5 GB" },
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    title: "Test Title Delta",
    slug: "test-title-delta",
    description:
      "A competitive arena shooter for Xbox One. 5v5 tactical rounds, destructible environments, ranked matchmaking.",
    coverImage: undefined,
    bannerImage: undefined,
    screenshots: [],
    platform: "xboxone",
    tags: ["shooter", "competitive", "multiplayer"],
    developer: "Hardpoint Studios",
    publisher: "PlaySomthng Labs",
    releaseDate: "2022-08-10",
    emulator: { required: false },
    sizeBytes: 28_000_000_000,
    systemRequirements: undefined,
  },
];

export const STORE_TEMPLATE_ID_PREFIX = "00000000-0000-4000-8000-";

export function isStoreTemplateId(id: string): boolean {
  return id.startsWith(STORE_TEMPLATE_ID_PREFIX);
}
