// Dumps decoded game data to ./out for inspection: sprite and delta sheets, rendered rooms, JSON metadata.
// Usage: bun run extract
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withScheme } from "../src/formats/palette.ts";
import { cellAt, COLS, deltaSetFor, ROWS, SCENE_NUMBERS } from "../src/formats/scene.ts";
import { DELTA_SET_NUMBERS, GameData, PALETTE_NAMES, SCHEME_PALETTES, SHAPE_NAMES } from "../src/game-data.ts";
import { renderRoom } from "../src/render/room.ts";
import { Screen } from "../src/render/screen.ts";
import { deltaSheet, shapeSheet, type Sheet } from "../src/render/sheet.ts";
import { encodePNG } from "./png.ts";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "out");
const data = new GameData(async (path) => new Uint8Array(await Bun.file(join(ROOT, "dgener", path)).arrayBuffer()));
const dgen = await data.palette("DGEN");

async function writeSheet(dir: string, name: string, sheet: Sheet, meta: object) {
  const { screen, rects } = sheet;
  await Bun.write(join(dir, `${name}.png`), encodePNG(screen.width, screen.height, screen.toRGBA(dgen, true)));
  await Bun.write(join(dir, `${name}.json`), JSON.stringify({ ...meta, frames: rects }, null, 1));
}

for (const dir of ["palettes", "sprites", "deltas", "rooms"]) mkdirSync(join(OUT, dir), { recursive: true });

for (const name of PALETTE_NAMES) {
  const pal = await data.palette(name);
  const colors = Array.from({ length: pal.length / 3 }, (_, i) => [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]]);
  await Bun.write(join(OUT, "palettes", `${name}.json`), JSON.stringify(colors));
}

for (const name of SHAPE_NAMES) {
  const sets = await data.shapes(name);
  for (const set of sets) {
    const sheet = shapeSheet(set.root);
    await writeSheet(join(OUT, "sprites"), sets.length > 1 ? `${name}-${set.id}` : name, sheet, { id: set.id });
  }
}

for (const n of DELTA_SET_NUMBERS) {
  await writeSheet(join(OUT, "deltas"), `DLTSET${n}`, deltaSheet(await data.deltaSet(n)), {});
}

const screen = new Screen();
for (const n of SCENE_NUMBERS) {
  const scene = await data.scene(n);
  const scheme = renderRoom(screen, scene, n, await data.roomAssets(n));
  const palette = withScheme(dgen, await data.palette(SCHEME_PALETTES[scheme]));
  await Bun.write(join(OUT, "rooms", `SCENE${n}.png`), encodePNG(screen.width, screen.height, screen.toRGBA(palette)));
  const cells = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => Array.from(cellAt(scene, r, c))));
  const { message, pieces, drops, lines } = scene;
  await Bun.write(
    join(OUT, "rooms", `SCENE${n}.json`),
    JSON.stringify({ message, deltaSet: deltaSetFor(n), scheme, pieces, drops, lines, cells }),
  );
}

console.log(`wrote ${SHAPE_NAMES.length} sprite sheets, ${DELTA_SET_NUMBERS.length} delta sheets, ${SCENE_NUMBERS.length} rooms to ${OUT}`);
