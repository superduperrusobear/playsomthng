import { z } from "zod";

/** Normalized client / IPC error codes — extend as you wire the DB and APIs. */
export const AppErrorCodeSchema = z.enum([
  "UNKNOWN",
  "NETWORK",
  "STORE_UNAVAILABLE",
  "LIBRARY_UNAVAILABLE",
  "AUTH",
  "VALIDATION",
]);

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

export const ClientErrorSchema = z.object({
  code: AppErrorCodeSchema,
  message: z.string(),
  detail: z.string().optional(),
});

export type ClientError = z.infer<typeof ClientErrorSchema>;
