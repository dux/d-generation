import { cpSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig } from "vite";

// Game data is read straight from the original folders: dev serves them from the root,
// the build copies them next to the bundle.
const GAME_DIRS = ["dgener", "amiga"];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [relative("dgener", path).replaceAll("\\", "/")];
  });
}

// The game worker uses SharedArrayBuffer, which needs cross-origin isolation (serve these headers in production too).
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  publicDir: false,
  worker: { format: "es" },
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  plugins: [
    {
      name: "game-files",
      resolveId: (id) => (id === "virtual:game-files" ? "\0virtual:game-files" : undefined),
      load: (id) => (id === "\0virtual:game-files" ? `export default ${JSON.stringify(listFiles("dgener"))};` : undefined),
    },
    {
      name: "copy-game-data",
      apply: "build",
      closeBundle() {
        for (const dir of GAME_DIRS) cpSync(dir, `dist/${dir}`, { recursive: true });
      },
    },
  ],
});
