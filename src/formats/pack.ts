// Readers for ./assets, the game's data converted from the AGA release by ./tools/extract-assets.ts. `read` takes
// paths relative to the repository root (the site root in ./docs).
import type { DeltaImage, DeltaSet } from "./delta.ts";
import { decodePng, type IndexedImage } from "./png.ts";
import type { Frame, ShapeNode, ShapeSet } from "./shape.ts";
import { parseWav, SAMPLE_COUNT, sampleFile, type AmigaSample } from "./sound.ts";

export type Read = (path: string) => Promise<Uint8Array>;

// Atlas rectangle [x, y, width, height] followed by the entry's own offsets ([frame x, frame y] or [dx, dy]).
type Rect = [number, number, number, number, number, number];
export type PackedTree = (number | PackedTree)[];
export interface SpritePack { sets: { id: number; tree: PackedTree }[]; frames: Rect[] }
export interface DeltaPack { entries: Rect[] }
export interface DemoRecording { directions: { time: number; direction: number; magnitude: number }[]; buttons: { time: number; code: number }[] }

const json = async <T>(read: Read, path: string): Promise<T> => JSON.parse(new TextDecoder().decode(await read(path))) as T;

function crop(atlas: IndexedImage, [x, y, width, height]: Rect): { pixels: Uint8Array; mask: Uint8Array } {
  const pixels = new Uint8Array(width * height), mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const from = (y + row) * atlas.width + x;
    pixels.set(atlas.pixels.subarray(from, from + width), row * width);
    mask.set(atlas.mask!.subarray(from, from + width), row * width);
  }
  return { pixels, mask };
}

// assets/sprites/<bank>.png + .json: the shape sets of aga/<bank>.aga.
export async function readSprites(read: Read, bank: string): Promise<ShapeSet[]> {
  const [pack, atlas] = await Promise.all([json<SpritePack>(read, `assets/sprites/${bank}.json`), read(`assets/sprites/${bank}.png`).then(decodePng)]);
  const frames = pack.frames.map((rect): Frame => ({ x: rect[4], y: rect[5], width: rect[2], height: rect[3], ...crop(atlas, rect) }));
  const node = (tree: PackedTree): ShapeNode[] => tree.map((child) => (typeof child === "number" ? frames[child]! : node(child)));
  return pack.sets.map(({ id, tree }) => ({ id, root: node(tree) }));
}

// assets/deltas/dltset<n>.png + .json: the entries of DLTSET<n>.DAT.
export async function readDeltaSet(read: Read, set: number): Promise<DeltaSet> {
  const [pack, atlas] = await Promise.all([json<DeltaPack>(read, `assets/deltas/dltset${set}.json`), read(`assets/deltas/dltset${set}.png`).then(decodePng)]);
  return { entries: pack.entries.map((rect): DeltaImage => ({ dx: rect[4], dy: rect[5], width: rect[2], height: rect[3], ...crop(atlas, rect) })) };
}

// assets/images/<name>.png: a full picture as palette indexes.
export async function readImage(read: Read, name: string): Promise<IndexedImage> {
  return decodePng(await read(`assets/images/${name}.png`));
}

// assets/palettes.json: every DATA/*.PAL the game loads, by lower-case file name, as the 6-bit components on disk.
export async function readPalettes(read: Read): Promise<Map<string, Uint8Array>> {
  const palettes = await json<Record<string, number[]>>(read, "assets/palettes.json");
  return new Map(Object.entries(palettes).map(([name, values]) => [name, Uint8Array.from(values)]));
}

export async function readSamples(read: Read): Promise<AmigaSample[]> {
  return Promise.all(Array.from({ length: SAMPLE_COUNT }, async (_, i) => parseWav(await read(sampleFile(i)))));
}

// assets/demos/demo<n>.json: DATA/DEMO<n>.SEQ, 500 direction and 900 button records.
export function readDemo(read: Read, sequence: number): Promise<DemoRecording> {
  return json<DemoRecording>(read, `assets/demos/demo${sequence}.json`);
}

// assets/config.json: the six big-endian words of DATA/DGEN.CFG.
export function readConfig(read: Read): Promise<{ words: number[] }> {
  return json<{ words: number[] }>(read, "assets/config.json");
}
