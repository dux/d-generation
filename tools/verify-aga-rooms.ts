// Compares ./src/game/render/room.ts with the rooms the original draws in ./tools/m68k/room_truth.py
// (./out/aga-truth/rooms/), pixel by pixel and colour register by colour register, for every room of
// ./levels. Writes the rendered rooms to ./out/aga/rooms/.
// Usage: bun run verify:aga-rooms [scene...]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseFloor } from "../src/formats/level.ts";
import { loadAgaAssets } from "../src/game/render/assets.ts";
import { drawRoom, roomImage, roomPalette, type Scheme } from "../src/game/render/room.ts";
import { Screen } from "../src/render/screen.ts";
import { encodePNG } from "./png.ts";

interface Capture { floor: number; scene: number; name: string; scheme: Scheme; undefinedPixels: number }

const ROOT = join(import.meta.dir, "..");
const TRUTH = join(ROOT, "out", "aga-truth", "rooms");
const OUT = join(ROOT, "out", "aga", "rooms");
mkdirSync(OUT, { recursive: true });

const read = async (path: string) => new Uint8Array(await Bun.file(join(ROOT, path)).arrayBuffer());
const bytes = async (name: string) => new Uint8Array(await Bun.file(join(TRUTH, name)).arrayBuffer());
const assets = await loadAgaAssets(read);
const captures: Capture[] = await Bun.file(join(TRUTH, "rooms.json")).json();
const only = new Set(process.argv.slice(2).map(Number));

const screen = new Screen();
const lines: string[] = [];
let rooms = 0;
let identical = 0;
let unexpected = 0;
for (let floorNumber = 1; floorNumber <= 10; floorNumber++) {
  const floor = parseFloor(await Bun.file(join(ROOT, "levels", `floor${String(floorNumber).padStart(2, "0")}.json5`)).text());
  for (const room of floor.rooms) {
    if (only.size && !only.has(room.scene)) continue;
    const at = captures.findIndex((c) => c.floor === floorNumber && c.scene === room.scene);
    if (at < 0) throw new Error(`no capture of floor ${floorNumber} scene ${room.scene}; run tools/m68k/room_truth.py`);
    const capture = captures[at];
    // g:19dc carries over from the room drawn before in the capture run.
    const previous = at > 0 ? captures[at - 1].scheme : 0;
    const image = roomImage(room.scene);
    if (image) await assets.vim(image);
    const scheme = drawRoom(screen, room, assets, room.scene, previous);
    const palette = roomPalette(assets, room.scene, scheme);

    const truth = await bytes(`${capture.name}.bin`);
    const truthPalette = await bytes(`${capture.name}.pal`);
    const undefinedAt = capture.undefinedPixels ? new Set(new Uint32Array((await bytes(`${capture.name}.undef`)).buffer)) : new Set<number>();
    let diff = 0;
    let undefinedDiff = 0;
    for (let i = 0; i < truth.length; i++) {
      if (truth[i] === screen.pixels[i]) continue;
      if (undefinedAt.has(i)) undefinedDiff++;
      else diff++;
    }
    let colors = 0;
    for (let c = 0; c < 256; c++) {
      if ([0, 1, 2].some((k) => truthPalette[c * 3 + k] !== palette[c * 3 + k])) colors++;
    }
    const problems = [
      diff && `${diff} pixels`,
      scheme !== capture.scheme && `scheme ${scheme}, expected ${capture.scheme}`,
      colors && `${colors} colours`,
    ].filter(Boolean);
    // Pixels the original copies from memory outside the BACK1 buffer are undefined there and colour 0 here.
    const known = undefinedDiff ? `${undefinedDiff} of ${undefinedAt.size} pixels read from memory past BACK1 (undefined)` : "";
    lines.push(`${capture.name}: ${[...problems, known].filter(Boolean).join(", ") || "identical"}`);
    rooms++;
    if (problems.length) unexpected++;
    else if (!known) identical++;
    await Bun.write(join(OUT, `${capture.name}.png`), encodePNG(screen.width, screen.height, screen.toRGBA(palette)));
  }
}

console.log(lines.join("\n"));
console.log(`${identical}/${rooms} rooms identical, ${rooms - identical - unexpected} differ only in undefined pixels, ${unexpected} unexpected differences`);
process.exit(unexpected ? 1 : 0);
