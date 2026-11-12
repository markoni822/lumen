/**
 * Pliki binarne repozytorium są trzymane w `assets-binary.json` (base64),
 * bo przez warstwę MCP nie da się przepchnąć surowych bajtów — treść pliku
 * idzie jako tekst, a PNG nie jest UTF-8.
 *
 * Ten skrypt odtwarza je w `public/` przed buildem i przed devem.
 * Uruchamia się automatycznie przez hooki `prebuild` / `predev` w package.json.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "assets-binary.json");

if (!existsSync(manifestPath)) {
  console.error("[assets] brak assets-binary.json — pomijam.");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let written = 0;

for (const [relative, base64] of Object.entries(manifest)) {
  const target = join(root, relative);
  const bytes = Buffer.from(base64, "base64");
  if (existsSync(target) && statSync(target).size === bytes.length) {
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  written += 1;
  console.log(`[assets] odtworzono ${relative} (${bytes.length} B)`);
}

console.log(`[assets] gotowe — ${written} plików odtworzonych, ${Object.keys(manifest).length} w manifeście.`);
