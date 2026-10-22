#!/usr/bin/env bun
// Compares renderScreen with the pictures the original displays during the first title run (h0:28ea), pixel by
// pixel (palette indexes) and colour register by colour register. Harness pictures come from
// ./tools/m68k/capture_display.py (run automatically for missing ticks into ./tmp/uiflow-captures).
// The native side is a ScreenState driven by the screen primitives in the order h0:28ea calls them, one
// paletteVblank per harness tick, with the wait lengths measured from a harness boot trace.
// Writes truth | native | diff PNGs of mismatching ticks to ./out/ui/.
// Usage: bun tools/verify-ui-frames.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadUiAssets } from "../src/game/ui/assets.ts";
import { renderScreen } from "../src/game/ui/render.ts";
import {
  applyPalette, blitDelta, clearScreen, clearView, copyRect, createScreenState, drawText, fadeIn, fadeInPrepare, fadeOut,
  fillRect, loadDeltaSet, loadPalette, loadVim, paletteVblank, restoreView, setColor15White, showVim, type ScreenState,
} from "../src/game/ui/screen.ts";
import { STORY_1, STORY_2 } from "../src/game/ui/title.ts";
import { Screen } from "../src/render/screen.ts";
import { encodePNG } from "./png.ts";

const ROOT = join(import.meta.dir, "..");
const CAPTURES = join(ROOT, "tmp", "uiflow-captures");
const OUT = join(ROOT, "out", "ui");

export interface Picture { pixels: Uint8Array; palette: Uint8Array }
export interface Capture extends Picture { label: string; tick: number; frame: number; width: number; height: number }
export interface ScreenDiff {
  pixels: number; // mismatching palette indexes
  colors: number; // mismatching colour registers
  firstPixel?: { x: number; y: number; expected: number; actual: number };
  firstColor?: { index: number; expected: number[]; actual: number[] };
  mismatch: Uint8Array; // 1 per mismatching pixel
}

export function compareScreen(native: Picture, captured: Picture): ScreenDiff {
  if (native.pixels.length !== captured.pixels.length) throw new Error(`picture sizes ${native.pixels.length} / ${captured.pixels.length}`);
  const diff: ScreenDiff = { pixels: 0, colors: 0, mismatch: new Uint8Array(native.pixels.length) };
  for (let i = 0; i < native.pixels.length; i++) {
    if (native.pixels[i] === captured.pixels[i]) continue;
    diff.mismatch[i] = 1;
    if (!diff.pixels++) diff.firstPixel = { x: i % 320, y: Math.floor(i / 320), expected: captured.pixels[i]!, actual: native.pixels[i]! };
  }
  for (let c = 0; c < 256; c++) {
    const expected = [...captured.palette.subarray(c * 3, c * 3 + 3)], actual = [...native.palette.subarray(c * 3, c * 3 + 3)];
    if (expected.every((v, k) => v === actual[k])) continue;
    if (!diff.colors++) diff.firstColor = { index: c, expected, actual };
  }
  return diff;
}

export function readCapture(label: string, dir = CAPTURES): Capture | null {
  const path = join(dir, `${label}.json`);
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, "utf8"));
  return { ...record, pixels: new Uint8Array(Buffer.from(record.pixels, "base64")), palette: new Uint8Array(Buffer.from(record.palette, "base64")) };
}

export function captureTicks(ticks: readonly number[], dir = CAPTURES): void {
  const missing = ticks.filter((tick) => !existsSync(join(dir, `${tickLabel(tick)}.json`)));
  if (!missing.length) return;
  const run = Bun.spawnSync(["uv", "run", "--with", "unicorn", "--with", "capstone", "python", "tools/m68k/capture_display.py",
    "--ticks", missing.join(","), "--out", dir], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`capture_display.py exited with ${run.exitCode}`);
}

export const tickLabel = (tick: number) => `t${String(tick).padStart(5, "0")}`;

// PNG: truth | native | mismatches in red over a dimmed truth.
export function writeDiff(path: string, native: Picture, captured: Picture, mismatch: Uint8Array): void {
  const width = 320, height = 200, rgba = new Uint8ClampedArray(width * 3 * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const put = (panel: number, rgb: ArrayLike<number>) => rgba.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], ((y * width * 3) + panel * width + x) * 4);
      const truth = captured.palette.subarray(captured.pixels[i]! * 3, captured.pixels[i]! * 3 + 3);
      put(0, truth);
      put(1, native.palette.subarray(native.pixels[i]! * 3, native.pixels[i]! * 3 + 3));
      put(2, mismatch[i] ? [255, 0, 0] : [truth[0]! >> 2, truth[1]! >> 2, truth[2]! >> 2]);
    }
  }
  writeFileSync(path, encodePNG(width * 3, height, rgba));
}

// g:5ac.
const COPYRIGHT = "Copyright 1993 Robert Cook and Mindscape";
const VIEW_RIGHT = 319, VIEW_HEIGHT = 200;

export interface Check { tick: number; card: string }
// Ticks well inside each card (and inside fades), by harness tick. The h0:b6c title passes (ticks 1800..2121) are
// not replayed here: by tick 2300 the harness display is again genoq (g:de58) plus delta card 3.
export const CHECKS: Check[] = [
  { tick: 100, card: "eye" }, { tick: 175, card: "eye fading out" }, { tick: 230, card: "eye under black (music starts)" },
  { tick: 270, card: "cleared" }, { tick: 280, card: "Logo fading in" }, { tick: 284, card: "Logo fading in" },
  { tick: 400, card: "Logo" }, { tick: 594, card: "Logo fading out" }, { tick: 610, card: "black, delta card 1 in g:de5c" },
  { tick: 640, card: "delta card 1 band fading in" }, { tick: 644, card: "delta card 1 band fading in" },
  { tick: 800, card: "delta card 1 band" }, { tick: 1000, card: "delta card 2 fading in" },
  { tick: 1004, card: "delta card 2 fading in" }, { tick: 1200, card: "delta card 2, bars, copyright" },
  { tick: 1355, card: "delta card 2 fading out" }, { tick: 1400, card: "genoq copied from g:de58" },
  { tick: 2300, card: "delta card 3 at (0x27, 0x96) over genoq" }, { tick: 2460, card: "delta card 3 fading out" },
  { tick: 2480, card: "story page 1 in g:de5c" }, { tick: 3000, card: "story page 1" }, { tick: 3340, card: "story page 1" },
  { tick: 3360, card: "story page 2 in g:de5c" }, { tick: 3800, card: "story page 2" }, { tick: 4380, card: "story page 2" },
];

// h0:28ea first run (g:53e clear) up to the end of story page 2, with the harness tick of every wait end.
function introSequence(s: ScreenState, until: (tick: number) => void, run: (ticks: number) => void): void {
  s.clip = VIEW_HEIGHT - 1; // g:873c
  clearScreen(s);
  restoreView(s);
  clearView(s);
  s.mode = "screen";
  loadVim(s, "genoq", "de58");
  loadDeltaSet(s, 0x22);
  showVim(s, "eye", 0);
  until(166);
  run(fadeOut(s, "vim"));
  until(251);
  clearScreen(s);
  until(276);
  loadPalette(s, "title.pal", "title");
  run(showVim(s, "Logo", 1));
  until(293);
  fillRect(s, 0, 0, VIEW_RIGHT, VIEW_HEIGHT);
  until(585);
  run(fadeOut(s, "vim"));
  clearScreen(s);
  blitDelta(s, 0x22, 1, 0, 0);
  until(636);
  fillRect(s, 0, 0x50, VIEW_RIGHT, 0x1e);
  fadeInPrepare(s, "title");
  run(fadeIn(s));
  until(944);
  run(fadeOut(s, "title"));
  clearScreen(s);
  blitDelta(s, 0x22, 2, 0, 0);
  until(996);
  fillRect(s, 0, 0x28, VIEW_RIGHT, 0x5a);
  s.wideLines = 1;
  drawText(s, 0x28, 0xb4, COPYRIGHT);
  fillRect(s, 0, 0xb4, VIEW_RIGHT, 9);
  fadeInPrepare(s, "title");
  run(fadeIn(s));
  setColor15White(s);
  until(1346);
  run(fadeOut(s, "title"));
  copyRect(s, 0, 0, VIEW_RIGHT, VIEW_HEIGHT);
  restoreView(s);
  applyPalette(s, "title");
  until(2121);
  s.clip = 0xb5; // left by the h0:b6c title passes (harness g:8c68 at tick 2300)
  blitDelta(s, 0x22, 3, 0x27, 0x96, "de50");
  until(2455);
  run(fadeOut(s, "title"));
  clearScreen(s);
  applyPalette(s, "title");
  setColor15White(s);
  s.textColor = 0x91;
  drawText(s, 0x0a, 0x41, STORY_1);
  until(2515);
  fillRect(s, 0, 0x28, VIEW_RIGHT, 0x64);
  until(3348);
  clearScreen(s);
  drawText(s, 0x0a, 0x37, STORY_2);
  s.wideLines = 0;
  until(3390);
  fillRect(s, 0, 0x28, VIEW_RIGHT, 0x64);
  until(4390);
}

// Compares native pictures (by harness tick) with the captures, prints one line per check and writes diff PNGs.
// Returns the number of differing checks. A native run stepped by game.onTick can feed this the same way.
export function checkPictures(natives: ReadonlyMap<number, Picture>, checks: readonly Check[] = CHECKS): number {
  captureTicks(checks.map((c) => c.tick));
  let failures = 0;
  mkdirSync(OUT, { recursive: true });
  for (const check of checks) {
    const captured = readCapture(tickLabel(check.tick));
    if (!captured) throw new Error(`no capture for tick ${check.tick}`);
    const native = natives.get(check.tick);
    if (!native) throw new Error(`no native picture for tick ${check.tick}`);
    const diff = compareScreen(native, captured);
    const differs = diff.pixels > 0 || diff.colors > 0;
    if (differs) failures++;
    console.log(`${differs ? "DIFF" : "ok"} t${check.tick} ${check.card}: ${diff.pixels} pixels, ${diff.colors} colours` +
      (diff.firstPixel ? ` first pixel ${JSON.stringify(diff.firstPixel)}` : "") + (diff.firstColor ? ` first colour ${JSON.stringify(diff.firstColor)}` : ""));
    if (differs) writeDiff(join(OUT, `${tickLabel(check.tick)}.png`), native, captured, diff.mismatch);
  }
  console.log(failures ? `${failures} card checks differ (diffs in ./out/ui)` : `all ${checks.length} card checks match`);
  return failures;
}

async function main(): Promise<number> {
  const assets = await loadUiAssets(async (path) => new Uint8Array(readFileSync(join(ROOT, path))));
  const wanted = new Set(CHECKS.map((c) => c.tick));
  const screen = new Screen();
  const s = createScreenState();
  const natives = new Map<number, Picture>();
  let tick = 0;
  // One harness tick: the vblank server's palette steps, then the picture as a tick capture sees it.
  const vblank = () => {
    paletteVblank(s);
    tick++;
    if (wanted.has(tick)) {
      const palette = renderScreen(screen, s, assets);
      natives.set(tick, { pixels: screen.pixels.slice(), palette });
    }
  };
  const until = (end: number) => {
    if (tick > end) throw new Error(`sequence is at tick ${tick}, past ${end}`);
    while (tick < end) vblank();
  };
  const run = (ticks: number) => { for (let i = 0; i < ticks; i++) vblank(); };
  introSequence(s, until, run);
  return checkPictures(natives) ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
