import { cpSync } from "node:fs";
import { defineConfig } from "vite";

// Game data is read straight from the original folders: dev serves them from the root,
// the build copies them next to the bundle.
const GAME_DIRS = ["dgener", "amiga"];

export default defineConfig({
  publicDir: false,
  worker: { format: "es" },
  plugins: [
    {
      name: "copy-game-data",
      apply: "build",
      closeBundle() {
        for (const dir of GAME_DIRS) cpSync(dir, `dist/${dir}`, { recursive: true });
      },
    },
  ],
});
