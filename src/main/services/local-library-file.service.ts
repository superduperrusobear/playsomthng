import fs from "node:fs/promises";
import path from "node:path";
import { LocalLibraryFileSchema, type LocalLibraryFile } from "../../shared/schemas/local-library.schema";
import { getAppPaths } from "./app-paths.service";

export const LOCAL_LIBRARY_FILENAME = "user-library.json" as const;

const DEFAULT_LIBRARY: LocalLibraryFile = { version: 1, games: [] };

export async function loadLocalLibraryFile(): Promise<LocalLibraryFile> {
  const { dataDir } = getAppPaths();
  const filePath = path.join(dataDir, LOCAL_LIBRARY_FILENAME);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return LocalLibraryFileSchema.parse(parsed);
  } catch {
    return LocalLibraryFileSchema.parse(DEFAULT_LIBRARY);
  }
}

export async function saveLocalLibraryFile(data: LocalLibraryFile): Promise<void> {
  const { dataDir } = getAppPaths();
  const filePath = path.join(dataDir, LOCAL_LIBRARY_FILENAME);
  await fs.mkdir(dataDir, { recursive: true });
  const validated = LocalLibraryFileSchema.parse(data);
  await fs.writeFile(filePath, JSON.stringify(validated, null, 2), "utf8");
}
