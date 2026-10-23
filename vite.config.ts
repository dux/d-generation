import { createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig } from "vite";

// The game reads the AGA disk files from ./amiga and the pictures extracted from the executable from ./data, which
// dev serves from the root; `bun run build` (./tools/build-pages.ts) copies the ones the game loads into ./docs,
// the GitHub Pages site. The floors in ./levels are bundled as text (./src/game/host/files.ts).
const GAME_DIRS = ["amiga", "data"];

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
          const dir = GAME_DIRS.find((name) => pathname.startsWith(`/${name}/`));
          if (!dir) return next();
          const path = resolve(".", pathname.slice(1));
          if (!path.startsWith(resolve(dir) + sep) || !statSync(path, { throwIfNoEntry: false })?.isFile()) return next();
          // Serve the bytes as they are, before Vite's JS analysis.
          res.setHeader("Content-Type", "application/octet-stream");
          for (const [name, value] of Object.entries(ISOLATION)) res.setHeader(name, value);
          createReadStream(path).on("error", next).pipe(res);
        });
      },
    },
  ],
});
