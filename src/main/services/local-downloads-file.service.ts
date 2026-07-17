import fs from "node:fs/promises";
import path from "node:path";
import { LocalDownloadsFileSchema, type LocalDownloadsFile } from "../../shared/schemas/local-downloads.schema";
import { getAppPaths } from "./app-paths.service";

export const LOCAL_DOWNLOADS_FILENAME = "downloads.json" as const;

const DEFAULT_FILE: LocalDownloadsFile = { version: 1, jobs: [] };

export async function loadLocalDownloadsFile(): Promise<LocalDownloadsFile> {
  const { dataDir } = getAppPaths();
  const filePath = path.join(dataDir, LOCAL_DOWNLOADS_FILENAME);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return LocalDownloadsFileSchema.parse(parsed);
  } catch {
    return LocalDownloadsFileSchema.parse(DEFAULT_FILE);
  }
}

export async function saveLocalDownloadsFile(data: LocalDownloadsFile): Promise<void> {
  const { dataDir } = getAppPaths();
  const filePath = path.join(dataDir, LOCAL_DOWNLOADS_FILENAME);
  await fs.mkdir(dataDir, { recursive: true });
  const validated = LocalDownloadsFileSchema.parse(data);
  await fs.writeFile(filePath, JSON.stringify(validated, null, 2), "utf8");
}
