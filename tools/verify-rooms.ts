// Compares src/render/room.ts with the original game's rooms captured by tools/emu/room_truth.py.
// Usage: bun run verify:rooms [scene...]
import { join } from "node:path";
import { SCENE_NUMBERS } from "../src/formats/scene.ts";
import { GameData } from "../src/game-data.ts";
import { renderRoom } from "../src/render/room.ts";
import { Screen } from "../src/render/screen.ts";

// The original copies backdrop pixels for rows >= 100 from past the end of its 32000-byte buffer (heap garbage);
// these rooms have window pieces that reach those rows, we show the real backdrop instead.
const BACKDROP_OVERRUN = new Set([3, 10, 22]);

const ROOT = join(import.meta.dir, "..");
const TRUTH = join(ROOT, "out", "truth");
const data = new GameData(async (path) => new Uint8Array(await Bun.file(join(ROOT, "dgener", path)).arrayBuffer()));
const schemes: Record<string, number> = await Bun.file(join(TRUTH, "schemes.json")).json();
const scenes = process.argv.length > 2 ? process.argv.slice(2).map(Number) : SCENE_NUMBERS;

const screen = new Screen();
const failures: string[] = [];
for (const n of scenes) {
  const truth = new Uint8Array(await Bun.file(join(TRUTH, `SCENE${n}.bin`)).arrayBuffer());
  const scheme = renderRoom(screen, await data.scene(n), n, await data.roomAssets(n));
  let diff = 0;
  for (let i = 0; i < truth.length; i++) if (truth[i] !== screen.pixels[i]) diff++;
  const problems = [diff && `${diff} pixels`, scheme !== schemes[n] && `scheme ${scheme}, expected ${schemes[n]}`].filter(Boolean);
  if (problems.length) failures.push(`SCENE${n}: ${problems.join(", ")}${BACKDROP_OVERRUN.has(n) ? " (known: backdrop overrun)" : ""}`);
}

console.log(failures.join("\n"));
const unexpected = failures.filter((f) => !f.endsWith("(known: backdrop overrun)")).length;
console.log(`${scenes.length - failures.length}/${scenes.length} rooms identical, ${unexpected} unexpected differences`);
process.exit(unexpected ? 1 : 0);
