import { z } from "zod";

/** Per-game Linux launch wrappers / env / args — stored in user-library.json */
export const LaunchFlagsSchema = z.object({
  gameMode: z.boolean().optional(),
  mangoHud: z.boolean().optional(),
  gamescope: z.boolean().optional(),
  gamescopeWidth: z.number().int().positive().optional(),
  gamescopeHeight: z.number().int().positive().optional(),
  /** When false, gamescope omits `-f` (borderless/windowed inside gamescope). */
  gamescopeFullscreen: z.boolean().optional(),
  skipIntro: z.boolean().optional(),
  windowed: z.boolean().optional(),
  /** Appended raw to the assembled command (not shell-escaped). */
  customFlags: z.string().optional(),
});

export type LaunchFlags = z.infer<typeof LaunchFlagsSchema>;
