import type { Screen } from "../render/screen.ts";

// DATA/DLTSET*.DAT: sets of run-length "delta" images (loader GAME.EXE 0:c570, drawer 0:c244).
//
// File: word (unused), entry count, data size, entry offsets[count], data.
// Entry: width, height (words), flags byte (0x80 = fill columns instead of rows),
// then 16-bit commands until 0xffff. Top 3 bits pick the op, low 13 bits are the count:
//   0x0000 run      count, color byte
//   0x2000 move+run dx word, dy byte, count, color byte
//   0x4000 copy     count literal bytes
//   0x6000 move+copy dx word, dy byte, count literal bytes
//   0x8000 pixel    color in the low byte
//   0xa000 move+pixel dx word, dy byte, color in the low byte
// The cursor walks the width x height box and stops when it leaves it.

export interface DeltaSet {
  entries: Uint8Array[];
}

// Color 0xfc shows the backdrop image (BACK1.DAT) through the delta (GAME.EXE 0:c522).
export const BACKDROP_COLOR = 0xfc;

export function parseDeltaSet(bytes: Uint8Array): DeltaSet {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(2, true);
  const dataStart = 6 + count * 2;
  const data = bytes.subarray(dataStart, dataStart + view.getUint16(4, true));
  const entries: Uint8Array[] = [];
  for (let i = 0; i < count; i++) entries.push(data.subarray(view.getUint16(6 + i * 2, true)));
  return { entries };
}

export function deltaSize(entry: Uint8Array): { width: number; height: number } {
  return { width: entry[0] | (entry[1] << 8), height: entry[2] | (entry[3] << 8) };
}

export function drawDelta(screen: Screen, entry: Uint8Array, x: number, y: number, backdrop?: Uint8Array): void {
  const { width, height } = deltaSize(entry);
  const columns = (entry[4] & 0x80) !== 0;
  const right = x + width - 1;
  const bottom = y + height - 1;
  let cx = x;
  let cy = y;
  let at = 5;
  const word = () => {
    const v = entry[at] | (entry[at + 1] << 8);
    at += 2;
    return v;
  };

  // Plots at the cursor and advances it; true once the box is exhausted.
  const put = (color: number): boolean => {
    if (color === BACKDROP_COLOR && backdrop) {
      if (cx >= 0 && cx < screen.width && cy >= 0 && cy < screen.height) screen.plot(cx, cy, backdrop[cy * screen.width + cx]);
    } else {
      screen.plot(cx, cy, color);
    }
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
    if (cmd === 0xffff) return;
    const op = cmd & 0xe000;
    const count = cmd & 0x1fff;
    if (op === 0x2000 || op === 0x6000 || op === 0xa000) {
      cx = x + word();
      cy = y + entry[at++];
    }
    switch (op) {
      case 0x0000:
      case 0x2000: {
        const color = entry[at++];
        for (let i = 0; i < count && !put(color); i++);
        break;
      }
      case 0x4000:
      case 0x6000:
        for (let i = 0; i < count && !put(entry[at + i]); i++);
        at += count;
        break;
      case 0x8000:
      case 0xa000:
        put(cmd & 0xff);
        break;
      default:
        throw new Error(`bad delta command 0x${cmd.toString(16)}`);
    }
  }
}
