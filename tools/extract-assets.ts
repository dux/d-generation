// Converts the AGA release data the game uses into ./assets, which the game loads instead of ./amiga/aga:
//   sprites/<bank>.png + .json   aga/<bank>.aga shape sets (grey = palette index, alpha = mask) and their trees
//   deltas/dltset<n>.png + .json DATA/DLTSET<n>.DAT entries as the pixels their commands write
//   images/<name>.png            the .vim pictures, BACK1.DAT, and the CD32 keyboard and pad menu from the executable
//   palettes.json                DATA/*.PAL as their 6-bit components
//   sounds/sampleNN.wav          the amiga.eff samples, 8-bit mono
//   music/<track>.ogg            dgen.mod and dgen2.mod, one pass rendered by libopenmpt (chiptune3) and encoded
//                                to Opus by ffmpeg
//   demos/demo<n>.json           DATA/DEMO<n>.SEQ records
//   config.json                  DATA/DGEN.CFG words
// Every file is read back through ./src/formats/pack.ts and compared with the original decode before the tool ends.
// Usage: bun run extract:assets (needs ffmpeg with libopus).
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error chiptune3 ships no types for its libopenmpt build
import libopenmpt from "chiptune3/libopenmpt.worklet.js";
import { drawDelta } from "../src/formats/delta.ts";
import { readConfig, readDeltaSet, readDemo, readImage, readPalettes, readSamples, readSprites, type DemoRecording, type PackedTree } from "../src/formats/pack.ts";
import type { Frame, ShapeNode, ShapeSet } from "../src/formats/shape.ts";
import { AMIGA_SOUNDS, PAULA_CLOCK, sampleFile } from "../src/formats/sound.ts";
import { Screen } from "../src/render/screen.ts";
import { decodeVim, parseAgaShapeFile, parseAmigaEffects, unlzw } from "./formats/aga.ts";
import { deltaImage, parseDeltaStreams, runDelta } from "./formats/delta-stream.ts";
import { encodeIndexedPNG } from "./png.ts";

const ROOT = join(import.meta.dir, "..");
const AGA = join(ROOT, "amiga/aga");
const OUT = join(ROOT, "assets");
const BANKS = ["b1", "inven", "anm", "door", "door2", "ply", "shply", "sur", "surs", "shead", "cgen", "chead", "dgen", "der"];
const DELTA_SETS = [1, 2, 3, 20, 22, 23, 24, 25, 27, 30, 31, 32, 33, 34, 53, 54, 55, 60, 61, 62, 63];
// Game names of the pictures (h0:cc28 asks for "%s/%s.vim"; the Amiga file system ignores case) -> disk file.
const VIMS: Record<string, string> = {
  scene58: "SCENE58.VIM", scene114: "SCENE114.VIM", scene139: "SCENE139.VIM", scene145: "SCENE145.VIM",
  genoq: "genoq.vim", logo: "logo.vim", cred: "CRED.VIM", der: "der.vim", eye: "eye.vim",
  uk1: "uk1.vim", uk2: "uk2.vim", uk3: "uk3.vim",
};
// genoq2.pal (32 OCS words) is not used by the AGA executable.
const PALETTES = ["BLUE.PAL", "BOMBED.PAL", "CRED.PAL", "DER.PAL", "DGEN.PAL", "EYE.PAL", "GENOQ.PAL", "GREEN.PAL", "RED.PAL",
  "SCENE114.PAL", "SCENE139.PAL", "SCENE145.PAL", "SCENE58.PAL", "TITLE.PAL", "UK1.PAL", "UK2.PAL", "UK3.PAL", "logo.pal"];
const MUSIC = ["dgen", "dgen2"];
const MUSIC_RATE = 48000;

const load = async (path: string) => new Uint8Array(await Bun.file(join(AGA, path)).arrayBuffer());
const write = (path: string, data: Uint8Array | string) => Bun.write(join(OUT, path), data);
const readBack = async (path: string) => new Uint8Array(await Bun.file(join(ROOT, path)).arrayBuffer());

// Shelf packing of rectangles into an atlas `width` wide (1-pixel gaps); returns positions and the height.
function pack(sizes: { width: number; height: number }[], width: number): { at: [number, number][]; height: number } {
  const at: [number, number][] = [];
  let x = 0, y = 0, shelf = 0;
  for (const size of sizes) {
    if (x && x + size.width > width) {
      x = 0;
      y += shelf + 1;
      shelf = 0;
    }
    at.push([x, y]);
    x += size.width + 1;
    shelf = Math.max(shelf, size.height);
  }
  return { at, height: Math.max(1, y + shelf) };
}

function atlas(images: { width: number; height: number; pixels: Uint8Array; mask: Uint8Array }[], width: number) {
  const { at, height } = pack(images, width);
  const pixels = new Uint8Array(width * height), mask = new Uint8Array(width * height);
  images.forEach((image, i) => {
    const [x, y] = at[i]!;
    for (let row = 0; row < image.height; row++) {
      pixels.set(image.pixels.subarray(row * image.width, (row + 1) * image.width), (y + row) * width + x);
      mask.set(image.mask.subarray(row * image.width, (row + 1) * image.width), (y + row) * width + x);
    }
  });
  return { png: encodeIndexedPNG(width, height, pixels, mask), at };
}

// --- original decodes ---------------------------------------------------------------------------------------

// The CD32 pictures exist only in hunk 9 of the executable: the keyboard (h0:14792 points BitMap g:df0c at its
// start) and the pad menu (g:df34's planes at h9:3e60), 8 planes each, most significant bit leftmost.
function hunkData(file: Uint8Array, index: number): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 0;
  const long = () => { const value = view.getUint32(at); at += 4; return value; };
  if (long() !== 0x3f3 || long() !== 0) throw new Error("not an AmigaDOS load file");
  const count = long();
  at += 8 + count * 4;
  for (let hunk = 0; hunk < count;) {
    const type = long() & 0x3fffffff;
    if (type === 0x3e9 || type === 0x3ea) {
      const bytes = long() * 4;
      if (hunk === index) return file.subarray(at, at + bytes);
      at += bytes;
    } else if (type === 0x3eb) at += 4;
    else if (type === 0x3ec) { for (let n = long(); n; n = long()) at += 4 + n * 4; }
    else if (type === 0x3f0) { for (let n = long(); n; n = long()) at += n * 4 + 4; }
    else if (type === 0x3f1) at += long() * 4;
    else if (type === 0x3f2) hunk++;
    else throw new Error(`unsupported hunk block 0x${type.toString(16)}`);
  }
  throw new Error(`load file has no hunk ${index}`);
}

function planar(data: Uint8Array, offset: number, width: number, height: number, bytesPerRow: number): Uint8Array {
  const planeSize = bytesPerRow * height;
  const pixels = new Uint8Array(width * height);
  for (let plane = 0; plane < 8; plane++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[offset + plane * planeSize + y * bytesPerRow + (x >> 3)]! & (0x80 >> (x & 7))) pixels[y * width + x]! |= 1 << plane;
      }
    }
  }
  return pixels;
}

const hunk9 = hunkData(await load("dgen"), 9);
const images: Record<string, { width: number; height: number; pixels: Uint8Array }> = {
  backdrop: { width: 320, height: 100, pixels: unlzw(await load("DATA/BACK1.DAT")) },
  "cd32-keyboard": { width: 219, height: 69, pixels: planar(hunk9, 0, 219, 69, 28) },
  "cd32-padmenu": { width: 271, height: 26, pixels: planar(hunk9, 0x3e60, 271, 26, 34) },
};
for (const [name, file] of Object.entries(VIMS)) images[name] = { width: 320, height: 200, pixels: decodeVim(await load(`DATA/${file}`)) };

function readSequence(bytes: Uint8Array): DemoRecording {
  if (bytes.length !== 7500) throw new Error(`demo sequence has ${bytes.length} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    directions: Array.from({ length: 500 }, (_, i) => ({ time: view.getUint32(i * 6, true), direction: bytes[i * 6 + 4]!, magnitude: bytes[i * 6 + 5]! })),
    buttons: Array.from({ length: 900 }, (_, i) => ({ time: view.getUint32(3000 + i * 5, true), code: bytes[3000 + i * 5 + 4]! })),
  };
}

// --- write ----------------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
for (const dir of ["sprites", "deltas", "images", "sounds", "music", "demos"]) mkdirSync(join(OUT, dir), { recursive: true });

const banks = new Map<string, ShapeSet[]>();
for (const bank of BANKS) {
  const sets = parseAgaShapeFile(await load(`aga/${bank}.aga`));
  banks.set(bank, sets);
  const frames: Frame[] = [];
  const index = new Map<string, number>();
  const tree = (nodes: ShapeNode[]): PackedTree => nodes.map((child) => {
    if (Array.isArray(child)) return tree(child);
    const key = `${child.x},${child.y},${child.width},${child.height},${child.pixels},${child.mask}`;
    if (!index.has(key)) index.set(key, frames.push(child) - 1);
    return index.get(key)!;
  });
  const packed = sets.map((set) => ({ id: set.id, tree: tree(set.root) }));
  const { png, at } = atlas(frames.map((f) => ({ ...f, mask: f.mask! })), 256);
  await write(`sprites/${bank}.png`, png);
  await write(`sprites/${bank}.json`, JSON.stringify({ sets: packed, frames: frames.map((f, i) => [...at[i]!, f.width, f.height, f.x, f.y]) }) + "\n");
}

const deltas = new Map<number, Uint8Array[]>();
for (const set of DELTA_SETS) {
  const streams = parseDeltaStreams(await load(`DATA/DLTSET${set}.DAT`));
  deltas.set(set, streams);
  const entries = streams.map(deltaImage);
  const { png, at } = atlas(entries, 512);
  await write(`deltas/dltset${set}.png`, png);
  await write(`deltas/dltset${set}.json`, JSON.stringify({ entries: entries.map((e, i) => [...at[i]!, e.width, e.height, e.dx, e.dy]) }) + "\n");
}

for (const [name, image] of Object.entries(images)) await write(`images/${name}.png`, encodeIndexedPNG(image.width, image.height, image.pixels));

const palettes: Record<string, number[]> = {};
for (const file of PALETTES) palettes[file.toLowerCase()] = [...(await load(`DATA/${file}`))];
await write("palettes.json", JSON.stringify(palettes) + "\n");

// 8-bit unsigned mono WAV at the rate of the first sound that plays the sample (the game sets its own rate).
const effects = parseAmigaEffects(await load("amiga.eff"));
for (const [i, sample] of effects.entries()) {
  const rate = Math.round(PAULA_CLOCK / (AMIGA_SOUNDS.find((s) => s.sample === i)?.period ?? 407));
  const wav = new Uint8Array(44 + sample.length);
  const view = new DataView(wav.buffer);
  wav.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + sample.length, true);
  wav.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  wav.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, sample.length, true);
  for (let j = 0; j < sample.length; j++) wav[44 + j] = (sample.data[j]! + 128) & 0xff;
  await Bun.write(join(ROOT, sampleFile(i)), wav);
}

const sequences = new Map<number, DemoRecording>();
for (const n of [50, 52]) {
  const recording = readSequence(await load(`DATA/DEMO${n}.SEQ`));
  sequences.set(n, recording);
  await write(`demos/demo${n}.json`, JSON.stringify(recording) + "\n");
}

const cfg = await load("DATA/DGEN.CFG");
const words = Array.from({ length: 6 }, (_, i) => (cfg[i * 2]! << 8) | cfg[i * 2 + 1]!);
await write("config.json", JSON.stringify({ words }) + "\n");

// One pass of each module (libopenmpt's default repeat count 0), stereo float at 48 kHz, piped to ffmpeg.
type OpenMpt = {
  HEAPU8: Uint8Array; HEAPF32: Float32Array; _malloc(n: number): number; _free(p: number): void;
  _openmpt_module_create_from_memory(p: number, n: number, a: number, b: number, c: number): number;
  _openmpt_module_read_float_stereo(mod: number, rate: number, count: number, left: number, right: number): number;
  _openmpt_module_destroy(mod: number): void;
};
const mpt = (await libopenmpt()) as OpenMpt;
for (const track of MUSIC) {
  const song = await load(`${track}.mod`);
  const songPtr = mpt._malloc(song.length);
  mpt.HEAPU8.set(song, songPtr);
  const mod = mpt._openmpt_module_create_from_memory(songPtr, song.length, 0, 0, 0);
  mpt._free(songPtr);
  if (!mod) throw new Error(`libopenmpt cannot open ${track}.mod`);
  const block = 4096, left = mpt._malloc(block * 4), right = mpt._malloc(block * 4);
  const chunks: Float32Array[] = [];
  for (;;) {
    const frames = mpt._openmpt_module_read_float_stereo(mod, MUSIC_RATE, block, left, right);
    if (!frames) break;
    const out = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      out[i * 2] = mpt.HEAPF32[left / 4 + i]!;
      out[i * 2 + 1] = mpt.HEAPF32[right / 4 + i]!;
    }
    chunks.push(out);
  }
  mpt._free(left);
  mpt._free(right);
  mpt._openmpt_module_destroy(mod);
  const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  chunks.reduce((at, c) => (pcm.set(new Uint8Array(c.buffer), at), at + c.byteLength), 0);
  const ffmpeg = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", String(MUSIC_RATE), "-ac", "2", "-i", "-",
    "-c:a", "libopus", "-b:a", "96k", join(OUT, `music/${track}.ogg`)], { stdin: pcm });
  if ((await ffmpeg.exited) !== 0) throw new Error(`ffmpeg failed on ${track}`);
  console.log(`music/${track}.ogg: ${(pcm.length / 8 / MUSIC_RATE).toFixed(1)} s`);
}

// --- read back and compare -------------------------------------------------------------------------------------

for (const [bank, sets] of banks) {
  const packed = await readSprites(readBack, bank);
  assert.equal(packed.length, sets.length, `${bank}: set count`);
  const same = (a: ShapeNode[], b: ShapeNode[], path: string) => {
    assert.equal(a.length, b.length, `${path}: child count`);
    a.forEach((x, i) => {
      const y = b[i]!;
      if (Array.isArray(x)) return same(x, y as ShapeNode[], `${path}/${i}`);
      const f = y as Frame;
      assert.deepEqual([f.x, f.y, f.width, f.height], [x.x, x.y, x.width, x.height], `${path}/${i}: geometry`);
      assert.deepEqual(f.pixels, x.pixels, `${path}/${i}: pixels`);
      assert.deepEqual(f.mask, x.mask, `${path}/${i}: mask`);
    });
  };
  sets.forEach((set, i) => {
    assert.equal(packed[i]!.id, set.id);
    same(set.root, packed[i]!.root, `${bank} set ${set.id}`);
  });
}

// A delta image must draw what its command stream draws: run both at the same place over the same backdrop.
const backdrop = images.backdrop!.pixels;
for (const [set, streams] of deltas) {
  const packed = await readDeltaSet(readBack, set);
  streams.forEach((stream, i) => {
    for (const [x, y] of [[0, 0], [37, 53], [-12, 120]] as const) {
      const expected = new Screen(), actual = new Screen();
      runDelta(stream, x, y, (px, py, color) => {
        if (color === 0xfc) {
          const offset = ((py * 320 + px) << 16) >> 16;
          color = offset >= 0 && offset < backdrop.length ? backdrop[offset]! : 0;
        }
        expected.plot(px, py, color);
      });
      drawDelta(actual, packed.entries[i]!, x, y, backdrop);
      assert.deepEqual(actual.pixels, expected.pixels, `DLTSET${set} entry ${i} at ${x},${y}`);
    }
  });
}

for (const [name, image] of Object.entries(images)) {
  const packed = await readImage(readBack, name);
  assert.deepEqual([packed.width, packed.height], [image.width, image.height], `${name}: size`);
  assert.deepEqual(packed.pixels, image.pixels, `${name}: pixels`);
}

const packedPalettes = await readPalettes(readBack);
for (const file of PALETTES) assert.deepEqual(packedPalettes.get(file.toLowerCase()), await load(`DATA/${file}`), file);

const samples = await readSamples(readBack);
effects.forEach((effect, i) => assert.deepEqual(samples[i]!.data, Int8Array.from(effect.data), `sample ${i}`));

for (const [n, recording] of sequences) assert.deepEqual(await readDemo(readBack, n), recording, `DEMO${n}.SEQ`);
assert.deepEqual((await readConfig(readBack)).words, words, "DGEN.CFG");

console.log(`assets: ${BANKS.length} sprite banks, ${DELTA_SETS.length} delta sets, ${Object.keys(images).length} images, ${PALETTES.length} palettes, ${effects.length} samples, ${MUSIC.length} tracks, 2 demos, config; all read back identical`);
