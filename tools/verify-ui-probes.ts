#!/usr/bin/env bun
// Original UI function probes captured by capture_ui_probes.py; title animation is captured at actual boot ticks.
import { mkdirSync, readFileSync } from "node:fs";
import { createGame } from "../src/game/index.ts";
import { loadAgaAssets } from "../src/game/render/assets.ts";
import { renderGame, renderPalette } from "../src/game/render/game.ts";
import { loadUiAssets } from "../src/game/ui/assets.ts";
import { renderScreen } from "../src/game/ui/render.ts";
import { ending } from "../src/game/ui/ending.ts";
import { showStats } from "../src/game/ui/stats.ts";
import { Screen } from "../src/render/screen.ts";
import { showMessage, updateMessages } from "../src/game/core/messages.ts";
import { drawPadMenu } from "../src/game/ui/padmenu-render.ts";
import { compareScreen, readCapture, writeDiff, type Picture } from "./verify-ui-frames.ts";

const read = async (path: string) => new Uint8Array(readFileSync(path));
const ui = await loadUiAssets(read);
const assets = await loadAgaAssets(path => read(`amiga/aga/${path}`));
const dir = "tmp/uiflow3-pixels";
mkdirSync(dir, { recursive: true });
let failures = 0;
function check(name: string, native: Picture, top = 0): void {
  const truth = readCapture(name, dir);
  if (!truth) throw new Error(`missing ${dir}/${name}.json; run tools/m68k/capture_ui_probes.py`);
  const a = { pixels: native.pixels.subarray(top * 320), palette: native.palette };
  const b = { pixels: truth.pixels.subarray(top * 320), palette: truth.palette };
  const diff = compareScreen(a, b);
  console.log(`${name}${top ? ` rows ${top}..199` : ""}: ${diff.pixels} pixels, ${diff.colors} colours${diff.firstPixel ? ` ${JSON.stringify(diff.firstPixel)}` : ""}`);
  if (diff.pixels || diff.colors) failures++;
  const full = compareScreen(native, truth);
  writeDiff(`${dir}/${name}.png`, native, truth, full.mismatch);
  const record = JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
  if (name.startsWith("t") && record.view) {
    const view = new Uint8Array(Buffer.from(record.view, "base64"));
    let copyLag = 0;
    for (let i = 0; i < native.pixels.length; i++) if (full.mismatch[i] && native.pixels[i] === view[i] && truth.pixels[i] !== view[i]) copyLag++;
    console.log(`  original view proves ${copyLag}/${full.pixels} copy-lag pixels`);
    if (full.pixels > copyLag) {
      console.log(`  actors ${JSON.stringify(game.objects.slots.filter(Boolean).map(a => ({ classId: a!.classId, x: a!.x, y: a!.y, paths: a!.spritePaths, offsets: a!.spriteOffsetY })))}`);
      for (const raw of record.actors) {
        const bytes = Buffer.from(raw, "base64");
        console.log(`  original class ${bytes[2]} x${bytes.readUInt16BE(10)} y${bytes.readUInt16BE(12)} old ${bytes.subarray(0x56, 0x6e).toString("hex")} new ${bytes.subarray(0x6e, 0x86).toString("hex")}`);
      }
    }
  }
}
const game = await createGame(read, { demo: true });
const screen = new Screen();
let tick = 0;
const animation = new Set([1850, 1900, 1950, 2000, 2050, 2100]);
game.onTick = () => {
  tick++;
  if (!animation.has(tick)) return;
  const palette = renderScreen(screen, game.state.screen, ui, { game, assets });
  check(`t${tick.toString().padStart(5, "0")}`, { pixels: screen.pixels.slice(), palette });
};
game.boot();
const baseline = game.snapshot();
game.onTick = null;
showStats(game);
renderGame(screen, game, assets);
check("stats", { pixels: screen.pixels.slice(), palette: renderPalette(game, assets) }, game.state.panelTop);
for (const [name, text] of [["pause", "`|3Game Paused"], ["flash", "One life remaining."]]) {
  showMessage(game.context, text!, 1, 2);
  updateMessages(game.context, slot => game.pollTimer(slot));
  renderGame(screen, game, assets);
  check(name!, { pixels: screen.pixels.slice(), palette: renderPalette(game, assets) }, game.state.panelTop);
}
game.restore(baseline);
renderGame(screen, game, assets);
game.state.padDisplay = [{ op: "menu" }];
drawPadMenu(screen, game.state, ui.padMenu);
check("pad-menu", { pixels: screen.pixels.slice(), palette: renderPalette(game, assets) });
game.state.padDisplay = [];
const stop = new Error("captured first ending wait");
for (let id = 0; id < 5; id++) {
  game.onTick = () => { throw stop; };
  try { ending(game, id); } catch (error) { if (error !== stop) throw error; }
  const palette = renderScreen(screen, game.state.screen, ui, { game, assets });
  check(`ending-${id}`, { pixels: screen.pixels.slice(), palette });
}
console.log(`${failures} differing UI probes`);
process.exitCode = failures ? 1 : 0;
