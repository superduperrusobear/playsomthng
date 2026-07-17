/**
 * Rasterize `src/renderer/assets/app-logo.svg` → `build/icon.png` (1024×1024)
 * for electron-builder (exe, installer, shortcuts, taskbar).
 *
 * Run: node scripts/build-app-icon.mjs
 * (Automatically run before `npm run dist` via package.json `predist`.)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "src/renderer/assets/app-logo.svg");
const outDir = path.join(root, "build");
const outPng = path.join(outDir, "icon.png");

async function main() {
  if (!fs.existsSync(svgPath)) {
    console.error("Missing:", svgPath);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(svgPath, { density: 300 })
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 10, g: 10, b: 12, alpha: 1 },
    })
    .png()
    .toFile(outPng);
  console.log("Wrote", outPng);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
