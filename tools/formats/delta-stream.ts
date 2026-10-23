// DATA/DLTSET*.DAT: sets of run-length "delta" images (loader h0:ca2a, drawer h0:11f24).
//
// File: word (unused), entry count, data size, entry offsets[count], data (little-endian).
// Entry: width, height (words), flags byte (0x80 = fill columns instead of rows),
// then 16-bit commands. Top 3 bits pick the op, low 13 bits are the count:
//   0x0000 run      count, color byte
//   0x2000 move+run dx word, dy byte, count, color byte
//   0x4000 copy     count literal bytes
//   0x6000 move+copy dx word, dy byte, count literal bytes
//   0x8000 pixel    color in the low byte
//   0xa000 move+pixel dx word, dy byte, color in the low byte
//   0xc000 and up   end of the entry (0xffff included)
// The cursor walks the width x height box and stops when it leaves it; a move can put it outside the box.
import type { DeltaImage } from "../../src/formats/delta.ts";
import { s16 } from "../../src/game/core/int.ts";

export function parseDeltaStreams(bytes: Uint8Array): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(2, true);
  const dataStart = 6 + count * 2;
  const data = bytes.subarray(dataStart, dataStart + view.getUint16(4, true));
  return Array.from({ length: count }, (_, i) => data.subarray(view.getUint16(6 + i * 2, true)));
}

// Runs one entry at (x, y) as h0:11f24 does, calling plot for every pixel in drawing order (later plots win).
// Coordinates are 16-bit like the original's.
export function runDelta(entry: Uint8Array, x: number, y: number, plot: (x: number, y: number, color: number) => void): void {
  const width = entry[0]! | (entry[1]! << 8), height = entry[2]! | (entry[3]! << 8);
  const columns = (entry[4]! & 0x80) !== 0;
  const right = s16(x + width - 1);
  const bottom = s16(y + height - 1);
  let cx = x, cy = y, at = 5;
  const word = () => {
    const v = entry[at]! | (entry[at + 1]! << 8);
    at += 2;
    return v;
  };
  const put = (color: number): boolean => {
    plot(cx, cy, color);
    if (columns) {
      if (++cy > bottom) {
        cy = y;
        if (++cx > right) return true;
      }
    } else if (++cx > right) {
      cx = x;
      if (++cy > bottom) return true;
    }
    return false;
  };
  for (;;) {
    if (at + 2 > entry.length) throw new Error("delta runs past the end of its set");
    const cmd = word();
    const op = cmd & 0xe000;
    const count = cmd & 0x1fff;
    if (op >= 0xc000) return;
    if (op === 0x2000 || op === 0x6000 || op === 0xa000) {
      cx = s16(x + word());
      cy = s16(y + entry[at++]!);
    }
    if (op === 0x0000 || op === 0x2000) {
      const color = entry[at++]!;
      for (let i = 0; i < count && !put(color); i++);
    } else if (op === 0x4000 || op === 0x6000) {
      for (let i = 0; i < count && !put(entry[at + i]!); i++);
      at += count;
    } else {
      put(cmd & 0xff);
    }
  }
}

// The entry's final pixels as an image placed at (dx, dy) relative to the drawing position.
export function deltaImage(entry: Uint8Array): DeltaImage {
  const written = new Map<string, number>();
  runDelta(entry, 0, 0, (x, y, color) => written.set(`${x},${y}`, color));
  if (!written.size) return { dx: 0, dy: 0, width: 0, height: 0, pixels: new Uint8Array(), mask: new Uint8Array() };
  const points = [...written.keys()].map((key) => key.split(",").map(Number) as [number, number]);
  const dx = Math.min(...points.map(([x]) => x)), dy = Math.min(...points.map(([, y]) => y));
  const width = Math.max(...points.map(([x]) => x)) - dx + 1, height = Math.max(...points.map(([, y]) => y)) - dy + 1;
  const pixels = new Uint8Array(width * height), mask = new Uint8Array(width * height);
  for (const [key, color] of written) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    pixels[(y - dy) * width + x - dx] = color;
    mask[(y - dy) * width + x - dx] = 1;
  }
  return { dx, dy, width, height, pixels, mask };
}
