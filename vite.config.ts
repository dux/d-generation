import { cpSync, createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig } from "vite";

// The AGA disk files are read straight from ./amiga: dev serves them from the root, the build copies them next to
// the bundle. The floors in ./levels are bundled as text (./src/game/host/files.ts).
const GAME_DIR = "amiga";

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
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = decodeURIComponent((req.url ?? "").split("?")[0]);
          if (!pathname.startsWith(`/${GAME_DIR}/`)) return next();
          const path = resolve(".", pathname.slice(1));
          if (!path.startsWith(resolve(GAME_DIR) + sep) || !statSync(path, { throwIfNoEntry: false })?.isFile()) return next();
          // Serve original disk bytes before Vite's JS analysis (the AGA executable has no extension).
          res.setHeader("Content-Type", "application/octet-stream");
          for (const [name, value] of Object.entries(ISOLATION)) res.setHeader(name, value);
          createReadStream(path).on("error", next).pipe(res);
        });
      },
    },
    {
      name: "copy-game-data",
      apply: "build",
      closeBundle() {
        cpSync(GAME_DIR, `dist/${GAME_DIR}`, { recursive: true });
      },
    },
  ],
});
