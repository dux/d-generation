// Extracts the two pictures that exist only inside the AGA executable into ./data, so the game does not need the
// executable at runtime: the CD32 on-screen keyboard (h0:14792 points BitMap g:df0c at the start of hunk 9) and
// the CD32 pad menu (g:df34's planes at h9:3e60). Both become chunky palette indexes, one byte per pixel.
// Usage: bun tools/extract-cd32-pictures.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PAD_MENU_FILE, PAD_MENU_HEIGHT, PAD_MENU_WIDTH } from "../src/game/ui/padmenu-render.ts";
import { KEYBOARD_FILE, KEYBOARD_HEIGHT, KEYBOARD_WIDTH } from "../src/game/ui/terminal/keyboard.ts";

const ROOT = join(import.meta.dir, "..");
const HUNK_HEADER = 0x3f3, HUNK_CODE = 0x3e9, HUNK_DATA = 0x3ea, HUNK_BSS = 0x3eb;
const HUNK_RELOC32 = 0x3ec, HUNK_SYMBOL = 0x3f0, HUNK_DEBUG = 0x3f1, HUNK_END = 0x3f2;

// Data of hunk `index` of an AmigaDOS load file (header, then CODE/DATA/BSS blocks with relocations).
function hunkData(file: Uint8Array, index: number): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 0;
  const long = () => { const value = view.getUint32(at); at += 4; return value; };
  if (long() !== HUNK_HEADER) throw new Error("not an AmigaDOS load file");
  if (long() !== 0) throw new Error("resident library names are not supported");
  const count = long();
  at += 8 + count * 4; // first, last, sizes
  for (let hunk = 0; hunk < count;) {
    const type = long() & 0x3fffffff;
    if (type === HUNK_CODE || type === HUNK_DATA) {
      const bytes = long() * 4;
      if (hunk === index) return file.subarray(at, at + bytes);
      at += bytes;
    } else if (type === HUNK_BSS) {
      if (hunk === index) throw new Error(`hunk ${index} is BSS`);
      at += 4;
    } else if (type === HUNK_RELOC32) {
      for (let n = long(); n; n = long()) at += 4 + n * 4;
    } else if (type === HUNK_SYMBOL) {
      for (let n = long(); n; n = long()) at += n * 4 + 4;
    } else if (type === HUNK_DEBUG) at += long() * 4;
    else if (type === HUNK_END) hunk++;
    else throw new Error(`unsupported hunk block 0x${type.toString(16)}`);
  }
  throw new Error(`load file has no hunk ${index}`);
}

// 8 planes of `bytesPerRow * height` bytes from `offset`, most significant bit leftmost, to chunky indexes.
function planar(data: Uint8Array, offset: number, width: number, height: number, bytesPerRow: number): Uint8Array {
  const planeSize = bytesPerRow * height;
  if (offset + planeSize * 8 > data.length) throw new Error("hunk 9 is too short for the picture planes");
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

const hunk9 = hunkData(new Uint8Array(await Bun.file(join(ROOT, "amiga/aga/dgen")).arrayBuffer()), 9);
mkdirSync(join(ROOT, "data"), { recursive: true });
await Bun.write(join(ROOT, KEYBOARD_FILE), planar(hunk9, 0, KEYBOARD_WIDTH, KEYBOARD_HEIGHT, 28));
await Bun.write(join(ROOT, PAD_MENU_FILE), planar(hunk9, 0x3e60, PAD_MENU_WIDTH, PAD_MENU_HEIGHT, 34));
console.log(`wrote ${KEYBOARD_FILE} (${KEYBOARD_WIDTH}x${KEYBOARD_HEIGHT}) and ${PAD_MENU_FILE} (${PAD_MENU_WIDTH}x${PAD_MENU_HEIGHT})`);
