import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { StoredUserSessionSchema, type StoredUserSession } from "../../shared/schemas/stored-session.schema";
import { getAppPaths } from "./app-paths.service";
import { logger } from "../utils/logger";

/** OS-encrypted when a keystore is available; legacy plaintext files migrate on next save. */
export const STORED_SESSION_FILENAME = "user-session.bin" as const;
const LEGACY_PLAINTEXT_FILENAME = "user-session.json" as const;

function sessionPath(): string {
  return path.join(getAppPaths().dataDir, STORED_SESSION_FILENAME);
}

function legacyPath(): string {
  return path.join(getAppPaths().dataDir, LEGACY_PLAINTEXT_FILENAME);
}

export async function loadStoredSession(): Promise<StoredUserSession | null> {
  try {
    const buf = await fs.readFile(sessionPath());
    const raw = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf8");
    return StoredUserSessionSchema.parse(JSON.parse(raw));
  } catch {
    /* fall through to legacy */
  }
  try {
    const raw = await fs.readFile(legacyPath(), "utf8");
    const session = StoredUserSessionSchema.parse(JSON.parse(raw));
    // Re-save encrypted and drop the plaintext file.
    await saveStoredSession(session);
    await fs.unlink(legacyPath()).catch(() => {});
    logger.info("[SESSION] Migrated plaintext session to encrypted storage");
    return session;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredUserSession): Promise<void> {
  const { dataDir } = getAppPaths();
  await fs.mkdir(dataDir, { recursive: true });
  const json = JSON.stringify(StoredUserSessionSchema.parse(session));
  if (safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(sessionPath(), safeStorage.encryptString(json));
  } else {
    logger.warn("[SESSION] OS encryption unavailable; storing session with file permissions only");
    await fs.writeFile(sessionPath(), json, { mode: 0o600 });
  }
}

export async function clearStoredSession(): Promise<void> {
  await fs.unlink(sessionPath()).catch(() => {});
  await fs.unlink(legacyPath()).catch(() => {});
}
