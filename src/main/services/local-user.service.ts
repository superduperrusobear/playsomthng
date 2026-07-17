import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LocalUserIdentitySchema, type LocalUserIdentity } from "../../shared/schemas/local-user.schema";
import { getAppPaths } from "./app-paths.service";

const FILE = "local-user.json";

function nowIso(): string {
  return new Date().toISOString();
}

export async function loadOrCreateLocalUser(): Promise<LocalUserIdentity> {
  const { dataDir } = getAppPaths();
  const filePath = path.join(dataDir, FILE);
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return LocalUserIdentitySchema.parse(parsed);
  } catch {
    const fresh: LocalUserIdentity = {
      localId: randomUUID(),
      displayName: undefined,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await fs.writeFile(filePath, JSON.stringify(fresh, null, 2), "utf8");
    return fresh;
  }
}

/** Rewrite local user file after edits (e.g. display name). */
export async function saveLocalUser(user: LocalUserIdentity): Promise<void> {
  const { dataDir } = getAppPaths();
  const filePath = path.join(dataDir, FILE);
  const next = { ...user, updatedAt: nowIso() };
  const validated = LocalUserIdentitySchema.parse(next);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(validated, null, 2), "utf8");
}
