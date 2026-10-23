#!/usr/bin/env bun
// bun tools/lockstep/render.ts [--scene n] [--frames 0,20,60] [--from capture-frame --truth file]: renderGame PNGs to ./out/native/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAgaAssets } from "../../src/game/render/assets.ts";
import { roomImage } from "../../src/game/render/room.ts";
import { createGame, renderGame, renderPalette, type Game } from "../../src/game/index.ts";
import { Screen } from "../../src/render/screen.ts";
import { encodePNG } from "../png.ts";
import { importGame } from "./import.ts";
import { loadLayouts } from "./layouts.ts";
import { readTruth } from "./truth.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const scene = option("--scene") === undefined ? undefined : Number(option("--scene"));
const from = option("--from") === undefined ? undefined : Number(option("--from"));
const frames = (option("--frames") ?? "0,20,60,100").split(",").map(Number).sort((a, b) => a - b);
if (frames.some(frame => !Number.isInteger(frame) || frame < 0)) throw new Error("--frames requires nonnegative integer frame numbers");
const read = async (path: string) => new Uint8Array(await readFile(resolve(path)));
let game: Game | undefined;
if (from !== undefined) {
  const truthPath = option("--truth");
  if (!truthPath) throw new Error("--from requires --truth");
  const layouts = await loadLayouts();
  for await (const truth of readTruth(truthPath)) if (truth.record.frame === from) { game = await importGame(read, truth, layouts); break; }
  if (!game) throw new Error(`capture has no frame ${from}`);
} else game = await createGame(read, { demo: true, scene });
const assets = await loadAgaAssets(read);
const screen = new Screen();
await mkdir("out/native", { recursive: true });
const prefix = from !== undefined ? `import${from}-` : scene === undefined ? "" : `scene${scene}-`;
let frame = 0;
for (const target of frames) {
  while (frame < target) { game.frame(); frame++; }
  const image = roomImage(game.room.scene);
  if (image) await assets.vim(image);
  renderGame(screen, game, assets);
  const path = `out/native/${prefix}${String(frame).padStart(5, "0")}.png`;
  await writeFile(path, encodePNG(screen.width, screen.height, screen.toRGBA(renderPalette(game, assets))));
  console.log(JSON.stringify({ path, frame, scene: game.room.scene, actors: game.objects.slots.filter(Boolean).length, panel: game.state.panelText }));
}
