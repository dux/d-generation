#!/usr/bin/env bun
// Compare the displays after the bomber expiry (h0:1dd2 explosion, bombed.pal, red flash, debris) with the
// original, importing only the pre-expiry scenario boundary 110 and then running native passes.
// Usage: bun tools/verify-ui-bombed.ts TRUTH.jsonl.gz
// Capture with capture_display.py --frames 111,112,113,120,140,180 --events tools/scenarios/uiflow3-bombed-ending.json
// --out tmp/uiflow3-pixels (boundary N is label fN).
import { existsSync, readFileSync } from "node:fs";
import { importGame } from "./lockstep/import.ts";
import { loadLayouts } from "./lockstep/layouts.ts";
import { readTruth } from "./lockstep/truth.ts";
import { loadAgaAssets } from "../src/game/render/assets.ts";
import { renderGame, renderPalette } from "../src/game/render/game.ts";
import { roomImage } from "../src/game/render/room.ts";
import { Screen } from "../src/render/screen.ts";
import { compareScreen, readCapture, writeDiff } from "./verify-ui-frames.ts";

const DIR = "tmp/uiflow3-pixels";
const FRAMES = [111, 112, 113, 120, 140, 180];
const path = process.argv[2];
if (!path) throw new Error("usage: bun tools/verify-ui-bombed.ts TRUTH.jsonl.gz");
const read = async (path: string) => new Uint8Array(readFileSync(path));
const layouts = await loadLayouts();
const assets = await loadAgaAssets(read);
let failures = 0;
for await (const boundary of readTruth(path)) {
  if (boundary.record.frame !== 110) continue;
  const game = await importGame(read, boundary, layouts);
  const screen = new Screen();
  for (let frame = 111; frame <= FRAMES.at(-1)!; frame++) {
    game.frame();
    if (!FRAMES.includes(frame)) continue;
    const label = `f${String(frame).padStart(5, "0")}`;
    if (!existsSync(`${DIR}/${label}.json`)) throw new Error(`missing original capture ${DIR}/${label}.json`);
    const image = roomImage(game.room.scene);
    if (image) await assets.vim(image);
    renderGame(screen, game, assets);
    const native = { pixels: screen.pixels.slice(), palette: renderPalette(game, assets) };
    const diff = compareScreen(native, readCapture(label, DIR)!);
    console.log(`bombed boundary ${frame} scene ${game.room.scene}: ${diff.pixels} pixels, ${diff.colors} colours${diff.firstPixel ? ` ${JSON.stringify(diff.firstPixel)}` : ""}${diff.firstColor ? ` ${JSON.stringify(diff.firstColor)}` : ""}`);
    writeDiff(`${DIR}/bombed-${frame}.png`, native, readCapture(label, DIR)!, diff.mismatch);
    if (diff.pixels || diff.colors) failures++;
  }
  break;
}
console.log(`${failures} differing bombed displays`);
process.exitCode = failures ? 1 : 0;
