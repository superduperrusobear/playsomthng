import { z } from "zod";

/** `unconfigured` = no server attached yet. `offline` = a configured server didn't answer. */
export const ServerStateSchema = z.enum(["online", "offline", "maintenance", "unconfigured"]);
export type ServerState = z.infer<typeof ServerStateSchema>;

/** Result of pinging the configured library server (e.g. GET /health). */
export const ServerStatusSchema = z.object({
  online: z.boolean(),
  /** Display line: ONLINE | OFFLINE | UNDER MAINTENANCE | NOT CONNECTED */
  serverState: ServerStateSchema,
  latencyMs: z.number().optional(),
  /** Server process uptime in seconds, if the health endpoint returns it. */
  uptimeSeconds: z.number().optional(),
  error: z.string().optional(),
});

export type ServerStatus = z.infer<typeof ServerStatusSchema>;
