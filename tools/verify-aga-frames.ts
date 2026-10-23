#!/usr/bin/env bun
// Compares renderGame with the frames the original displays, pixel by pixel and colour register by colour
// register. ./tools/m68k/frame_truth.py runs the original and captures the displayed bitmap (the View's
// BitMap, harness blitter) with its palette at every stride-th main-loop boundary; the native game imports
// boundary --import of the same run (like ./tools/lockstep-aga.ts --from; 0 by default, later only after the
// last poke of an events file) and renders after the same passes, from boundary --from through `last`.
// The state is lockstep-compared at every boundary too, so a picture difference is known to be a render one.
// Writes truth | native | diff PNGs of the first mismatching frames to ./out/aga/frames/. Mismatches that the
// original's incremental redraw explains (explainedMask, orderMask) are counted apart; --verbose lists them.
// Usage: bun run verify:aga-frames [last=3000] [--stride 10] [--from 0] [--import 0] [--events file] [--diffs 8]
//        [--verbose] [--truth file.jsonl.gz --pictures file.bin.gz] (reuse a frame_truth.py capture; without
//        them the capture goes to ./tmp and is removed on exit)
import { createReadStream, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createGunzip } from "node:zlib";
import type { Actor } from "../src/game/core/model.ts";
import { renderGame, renderPalette, type Game } from "../src/game/index.ts";
import { loadAgaAssets, type AgaAssets } from "../src/game/render/assets.ts";
import { redrawObjects } from "../src/game/render/game.ts";
import { drawOrder, redrawList } from "../src/game/render/objects.ts";
import { roomImage } from "../src/game/render/room.ts";
import { HEIGHT, Screen, WIDTH } from "../src/render/screen.ts";
import { compareFrame } from "./lockstep/compare.ts";
import { importGame } from "./lockstep/import.ts";
import { InputTimeline, parseEvents } from "./lockstep/input.ts";
import { loadLayouts } from "./lockstep/layouts.ts";
import { GLOBAL_BASE, readTruth, SLOT_COUNT, type TruthFrame } from "./lockstep/truth.ts";
import { encodePNG } from "./png.ts";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "out", "aga", "frames");

interface Options { last: number; stride: number; from: number; import: number; diffs: number; verbose: boolean; events?: string; truth?: string; pictures?: string }

function options(args: readonly string[]): Options {
  const result: Options = { last: 3000, stride: 10, from: 0, import: 0, diffs: 8, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = () => {
      const next = args[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} requires a value`);
      return next;
    };
    const count = () => {
      const next = value();
      if (!/^\d+$/.test(next)) throw new Error(`${arg} requires a nonnegative integer`);
      return Number(next);
    };
    if (arg === "--stride") result.stride = count();
    else if (arg === "--from") result.from = count();
    else if (arg === "--import") result.import = count();
    else if (arg === "--diffs") result.diffs = count();
    else if (arg === "--verbose") result.verbose = true;
    else if (arg === "--events") result.events = resolve(value());
    else if (arg === "--truth") result.truth = resolve(value());
    else if (arg === "--pictures") result.pictures = resolve(value());
    else if (/^\d+$/.test(arg)) result.last = Number(arg);
    else throw new Error("usage: bun tools/verify-aga-frames.ts [last] [--stride n] [--from n] [--import n] [--events file] [--diffs n] [--verbose] [--truth file --pictures file]");
  }
  if (result.stride < 1) throw new Error("--stride must be positive");
  result.from = Math.max(result.from, result.import);
  if (result.from > result.last) throw new Error("--from is past the last boundary");
  if (!result.truth !== !result.pictures) throw new Error("--truth and --pictures go together");
  return result;
}

interface Picture { frame: number; width: number; height: number; palette: Uint8Array; pixels: Uint8Array; view: Uint8Array }

// frame_truth.py --frames: u32 frame, u16 width, u16 height, 768 palette bytes, width * height display indexes,
// width * height view (g:df00) indexes.
async function* readPictures(path: string): AsyncGenerator<Picture> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(path).pipe(createGunzip())) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    for (;;) {
      if (buffer.length < 8) break;
      const width = buffer.readUInt16BE(4), height = buffer.readUInt16BE(6), area = width * height;
      const size = 8 + 768 + 2 * area;
      if (buffer.length < size) break;
      yield {
        frame: buffer.readUInt32BE(0), width, height,
        palette: Uint8Array.from(buffer.subarray(8, 776)),
        pixels: Uint8Array.from(buffer.subarray(776, 776 + area)),
        view: Uint8Array.from(buffer.subarray(776 + area, size)),
      };
      buffer = buffer.subarray(size);
    }
  }
  if (buffer.length) throw new Error(`${path} ends inside a picture record`);
}

// Pixels a full redraw from state cannot reproduce, because the original updates the screen incrementally (mask
// values 1 stale objects, 2 copy lag, 3 equal-y order):
// * Stale objects. Only objects that h0:e2b2 finds changed (frame pointers, height byte, packed integer position
//   +0x92, erase counters, g:4ea) or that overlap a changed one are redrawn. A move inside the same integer
//   position, such as a half-pixel x step (x bit 7), updates the new part rectangles +0x6e but leaves the object
//   where h0:3b1a last drew it (+0x56): both rectangles of such parts count. Doors with a save slot (+0x9b) are
//   left out: h0:13328 sets their +0x56 to the saved background rectangle, which never equals +0x6e.
// * Copy lag. The view (g:87fa) reaches the display only through the h0:aea8 rectangle list: the erased old part
//   rectangles (h0:11654) and the changed parts' new ones (h0:e2b2). An object redrawn because it overlaps a
//   changed one, after an unflagged half-pixel move, is complete in the view but its new columns are never
//   copied. Pixels above the clip g:8c68 where the native picture equals the original's view count.
function explainedMask(truth: TruthFrame, picture: Picture, screen: Screen): Uint8Array {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (const address of truth.record.slots) {
    if (!address || (truth.read(address + 2, 1) === 2 && truth.read(address + 0x9b, 1))) continue;
    for (let part = 0; part < 3; part++) {
      const drawn = [0, 2, 4, 6].map(k => truth.read(address + 0x56 + part * 8 + k, 2));
      const next = [0, 2, 4, 6].map(k => truth.read(address + 0x6e + part * 8 + k, 2));
      if (drawn.every((v, k) => v === next[k])) continue;
      for (const [left, top, right, bottom] of [drawn, next]) {
        for (let y = top!; y <= Math.min(bottom!, HEIGHT - 1); y++) mask.fill(1, y * WIDTH + left!, y * WIDTH + Math.min(right!, WIDTH - 1) + 1);
      }
    }
  }
  const clip = truth.read(GLOBAL_BASE + 0x8c68, 2);
  for (let i = 0; i < clip * WIDTH; i++) if (!mask[i] && picture.view[i] === screen.pixels[i] && picture.view[i] !== picture.pixels[i]) mask[i] = 2;
  return mask;
}

// * Equal-y order. h0:af12 sorts each pass's dirty set g:84c0 (h0:1d00, in the truth record) with an unstable
//   qsort, so two objects with the same y byte can be drawn in the other order than in the full redraw list
//   (redrawList), and the display keeps that order until they are redrawn. Overlapping objects are always redrawn
//   together (h0:117ac), so the pass and list position of each object's last draw (noteDrawOrder) orders them as
//   the display does. For each pair with equal y bytes in the other order, pixels inside both new part rectangles
//   (+0x6e) count when drawing the objects again in that order over the native picture (redrawObjects) gives the
//   original's pixel.
function noteDrawOrder(truth: TruthFrame, game: Game, drawn: WeakMap<Actor, number>): void {
  const dirty: Actor[] = [];
  for (let i = 0; i < truth.read(GLOBAL_BASE + 0x862e, 2); i++) {
    const actor = game.objects.slots[truth.record.slots.indexOf(truth.read(GLOBAL_BASE + 0x84c0 + i * 4, 4))];
    if (actor) dirty.push(actor);
  }
  drawOrder(dirty).forEach((actor, i) => drawn.set(actor, truth.record.frame * SLOT_COUNT + i));
}

function orderMask(truth: TruthFrame, game: Game, assets: AgaAssets, picture: Picture, screen: Screen, drawn: WeakMap<Actor, number>, mask: Uint8Array): void {
  const native = drawOrder(redrawList(game.objects));
  const last = (actor: Actor) => drawn.get(actor) ?? -1;
  const swapped: [Actor, Actor][] = [];
  for (let i = 0; i < native.length; i++) {
    for (let j = i + 1; j < native.length; j++) {
      const a = native[i]!, b = native[j]!;
      if (a.y >>> 8 === b.y >>> 8 && a.firstLayer === b.firstLayer && last(b) >= 0 && last(a) > last(b)) swapped.push([a, b]);
    }
  }
  if (!swapped.length) return;
  const rects = (actor: Actor) => {
    const address = truth.record.slots[game.objects.slots.indexOf(actor)]!;
    return [0, 1, 2].filter(part => truth.read(address + 0xe7 + part, 1))
      .map(part => [0, 2, 4, 6].map(k => truth.read(address + 0x6e + part * 8 + k, 2)) as [number, number, number, number]);
  };
  const full = screen.pixels.slice();
  redrawObjects(screen, game, assets, native.slice().sort((a, b) => last(a) - last(b)));
  for (const [a, b] of swapped) {
    for (const [l1, t1, r1, b1] of rects(a)) {
      for (const [l2, t2, r2, b2] of rects(b)) {
        for (let y = Math.max(t1, t2); y <= Math.min(b1, b2, HEIGHT - 1); y++) {
          for (let x = Math.max(l1, l2); x <= Math.min(r1, r2, WIDTH - 1); x++) {
            const i = y * WIDTH + x;
            if (!mask[i] && full[i] !== picture.pixels[i] && screen.pixels[i] === picture.pixels[i]) mask[i] = 3;
          }
        }
      }
    }
  }
  screen.pixels.set(full);
}

// truth | native | diff, the diff showing the native picture darkened, unexplained mismatches in white and
// explained ones (explainedMask) in yellow.
function diffImage(picture: Picture, screen: Screen, palette: Uint8Array, stale: Uint8Array): Uint8Array {
  const { width, height } = picture;
  const rgba = new Uint8ClampedArray(width * 3 * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = picture.pixels[i]! * 3, n = screen.pixels[i]! * 3;
      const put = (column: number, r: number, g: number, b: number) => {
        const o = (y * width * 3 + column * width + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      };
      put(0, picture.palette[t]!, picture.palette[t + 1]!, picture.palette[t + 2]!);
      put(1, palette[n]!, palette[n + 1]!, palette[n + 2]!);
      if (picture.pixels[i] === screen.pixels[i]) put(2, palette[n]! >> 2, palette[n + 1]! >> 2, palette[n + 2]! >> 2);
      else if (stale[i]) put(2, 255, 255, 0);
      else put(2, 255, 255, 255);
    }
  }
  return encodePNG(width * 3, height, rgba);
}

async function main(): Promise<number> {
  const args = options(process.argv.slice(2));
  const end = args.last;
  const events = args.events ? parseEvents(await readFile(args.events, "utf8")) : [];
  const truthPath = args.truth ?? join(ROOT, "tmp", `verify-aga-frames-${process.pid}.jsonl.gz`);
  const picturesPath = args.pictures ?? join(ROOT, "tmp", `verify-aga-frames-${process.pid}.bin.gz`);
  if (!args.truth) {
    process.on("exit", () => { rmSync(truthPath, { force: true }); rmSync(picturesPath, { force: true }); });
    const command = ["uv", "run", "-q", "--with", "unicorn", "--with", "capstone", "python", "tools/m68k/frame_truth.py", String(end),
      "--truth", truthPath, "--frames", picturesPath, "--stride", String(args.stride)];
    if (args.events) command.push("--events", args.events);
    console.log(`Capturing ${end + 1} AGA boundaries, pictures every ${args.stride}`);
    const status = await Bun.spawn(command, { cwd: ROOT, stdout: "inherit", stderr: "inherit" }).exited;
    if (status !== 0) throw new Error(`frame_truth.py exited with status ${status}`);
  }

  const read = async (path: string) => new Uint8Array(await readFile(resolve(ROOT, path)));
  const assets = await loadAgaAssets(read);
  const layouts = await loadLayouts();
  const input = new InputTimeline(events);
  const screen = new Screen();
  const pictures = readPictures(picturesPath);
  let picture = (await pictures.next()).value as Picture | undefined;
  let game: Game | undefined;
  let logic: string | undefined;
  let compared = 0, identical = 0, explainedFrames = 0, written = 0;
  const mismatches: string[] = [], explained: string[] = [];
  const drawn = new WeakMap<Actor, number>();
  mkdirSync(OUT, { recursive: true });

  for await (const truth of readTruth(truthPath)) {
    const frame = truth.record.frame;
    if (frame === 0 && JSON.stringify(truth.record.events ?? []) !== JSON.stringify(events)) throw new Error("capture events differ from --events");
    if (frame < args.import) { input.at(frame); continue; }
    game ??= await importGame(read, truth, layouts);
    if (!logic) {
      try { compareFrame(game, truth, layouts); }
      catch (error) { logic = `frame ${frame}: ${error instanceof Error ? error.message : String(error)}`; }
    }
    noteDrawOrder(truth, game, drawn);
    while (picture && picture.frame < frame) picture = (await pictures.next()).value as Picture | undefined;
    if (frame >= args.from && frame % args.stride === 0 && picture?.frame === frame) {
      if (picture.width !== screen.width || picture.height !== screen.height) throw new Error(`frame ${frame}: displayed bitmap is ${picture.width}x${picture.height}`);
      const image = roomImage(game.room.scene);
      if (image) await assets.vim(image);
      renderGame(screen, game, assets);
      const palette = renderPalette(game, assets);
      const stale = explainedMask(truth, picture, screen);
      orderMask(truth, game, assets, picture, screen, drawn, stale);
      let pixels = 0, colors = 0;
      const kinds = [0, 0, 0, 0]; // unexplained, stale objects, copy lag, equal-y order
      for (let i = 0; i < screen.pixels.length; i++) {
        if (screen.pixels[i] === picture.pixels[i]) continue;
        pixels++;
        kinds[stale[i]!]!++;
      }
      const unexplained = kinds[0]!;
      for (let c = 0; c < 256; c++) if ([0, 1, 2].some(k => palette[c * 3 + k] !== picture!.palette[c * 3 + k])) colors++;
      compared++;
      if (!pixels && !colors) identical++;
      else if (!unexplained && !colors) {
        explainedFrames++;
        explained.push(`frame ${frame} (room ${game.room.scene}): ${pixels} pixels, all from incremental redrawing: ${kinds[1]} stale objects, ${kinds[2]} copy lag, ${kinds[3]} equal-y order`);
      } else {
        mismatches.push(`frame ${frame} (room ${game.room.scene}): ${pixels} pixels (${unexplained} unexplained), ${colors} colours`);
        if (written < args.diffs) {
          written++;
          const path = join(OUT, `${String(frame).padStart(5, "0")}.png`);
          await writeFile(path, diffImage(picture, screen, palette, stale));
        }
      }
    }
    if (frame === end) break;
    game.frame(input.at(frame));
  }
  if (!game) throw new Error(`capture ends before boundary ${args.import}`);

  if (args.verbose) console.log(explained.join("\n"));
  console.log(mismatches.join("\n"));
  console.log(logic ? `STATE DIVERGED at ${logic}` : `State identical at every boundary ${args.import}..${end}.`);
  console.log(`${identical}/${compared} frames identical, ${explainedFrames} differ only by incremental redrawing, ${mismatches.length} unexplained (every ${args.stride} from ${args.from} through ${end}); ${written} diff images in ${OUT}`);
  return mismatches.length || logic ? 1 : 0;
}

try { process.exitCode = await main(); }
catch (error) {
  console.error(`VERIFY FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
