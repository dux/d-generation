// Builds the playable game into ./docs, the folder GitHub Pages serves (Settings > Pages > Deploy from a branch,
// master, /docs): ./game.html as index.html with its bundle (floors included), the cross-origin isolation service
// worker, and only the ./assets files the game loads, found by running the browser worker's loaders against the
// repository. All URLs are relative, so the site works under https://<user>.github.io/<repo>/.
// Usage: bun run build (commit ./docs), bun run preview to try it.
import { copyFileSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build } from "vite";
import { createGame } from "../src/game/index.ts";
import { loadAgaAssets } from "../src/game/render/assets.ts";
import { roomImage } from "../src/game/render/room.ts";
import { loadUiAssets } from "../src/game/ui/assets.ts";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "docs");
// Fetched by the page itself: the two songs (./src/audio/music.ts).
const PAGE_FILES = ["assets/music/dgen.ogg", "assets/music/dgen2.ogg"];
const SCENES = 150;

await build({
  root: ROOT,
  base: "./",
  logLevel: "warn",
  // Code in bundle/, so it stays apart from the game data in assets/.
  build: { outDir: OUT, emptyOutDir: true, assetsDir: "bundle", rollupOptions: { input: join(ROOT, "game.html") } },
});
renameSync(join(OUT, "game.html"), join(OUT, "index.html"));
copyFileSync(join(ROOT, "src/pages/coi-sw.js"), join(OUT, "coi-sw.js"));
// Serve the files as they are, without a Jekyll pass.
writeFileSync(join(OUT, ".nojekyll"), "");

// The same loads as ./src/game/host/worker.ts, recording every path.
const files = new Set(PAGE_FILES);
const read = async (path: string) => {
  files.add(path);
  return new Uint8Array(await readFile(join(ROOT, path)));
};
const [, assets] = await Promise.all([
  createGame(read, { demo: true }),
  loadAgaAssets(read),
  loadUiAssets(read),
]);
for (let scene = 1; scene <= SCENES; scene++) {
  const name = roomImage(scene);
  if (name) await assets.vim(name);
}

let bytes = 0;
const copied = [...files].filter((path) => !path.startsWith("levels/")).sort();
for (const path of copied) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  copyFileSync(join(ROOT, path), join(OUT, path));
  bytes += statSync(join(ROOT, path)).size;
}

console.log(`docs: index.html, bundle, coi-sw.js, ${copied.length} game files (${(bytes / 1024).toFixed(0)} KB)`);
