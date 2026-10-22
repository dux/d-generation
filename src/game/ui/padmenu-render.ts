import type { Screen } from "../../render/screen.ts";
import type { GameState } from "../core/model.ts";

const WIDTH = 271, HEIGHT = 26, ROW = 34;

// h0:14792: g:df34's planes point at h9:3e60 + plane * 884.
export function decodePadMenu(file: Uint8Array): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 0;
  const long = () => { const value = view.getUint32(at); at += 4; return value; };
  if (long() !== 0x3f3 || long() !== 0) throw new Error("not an AmigaDOS load file");
  const count = long();
  at += 8 + count * 4;
  for (let hunk = 0; hunk < count;) {
    const type = long() & 0x3fffffff;
    if (type === 0x3e9 || type === 0x3ea) {
      const size = long() * 4;
      if (hunk === 9) {
        const start = at + 0x3e60, planeSize = ROW * HEIGHT;
        if (0x3e60 + planeSize * 8 > size) throw new Error("short pad menu planes");
        const pixels = new Uint8Array(WIDTH * HEIGHT);
        for (let p = 0; p < 8; p++) for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
          if (file[start + p * planeSize + y * ROW + (x >> 3)]! & (0x80 >> (x & 7))) pixels[y * WIDTH + x] |= 1 << p;
        }
        return pixels;
      }
      at += size;
    } else if (type === 0x3eb) at += 4;
    else if (type === 0x3ec) { for (let n = long(); n; n = long()) at += 4 + n * 4; }
    else if (type === 0x3f0) { for (let n = long(); n; n = long()) at += n * 4 + 4; }
    else if (type === 0x3f1) at += long() * 4;
    else if (type === 0x3f2) hunk++;
    else throw new Error(`unsupported hunk block ${type.toString(16)}`);
  }
  throw new Error("load file has no pad menu hunk");
}

// h0:151a4 saves the underlying display; h0:153ec/15452 invert the selected rectangle with minterm 0x50.
export function drawPadMenu(screen: Screen, state: GameState, pixels: Uint8Array): void {
  let saved: Uint8Array | null = null;
  for (const op of state.padDisplay) {
    if (op.op === "menu") {
      saved = screen.pixels.slice();
      for (let y = 0; y < HEIGHT; y++) screen.pixels.set(pixels.subarray(y * WIDTH, (y + 1) * WIDTH), (50 + y) * screen.width + 30);
    } else if (op.op === "invert") {
      for (let y = 54; y < 72; y++) for (let x = 34 + 44 * op.item; x < 77 + 44 * op.item; x++) screen.pixels[y * screen.width + x] ^= 0xff;
    } else if (saved) {
      for (let y = 50; y < 76; y++) {
        const at = y * screen.width + 30;
        screen.pixels.set(saved.subarray(at, at + WIDTH), at);
      }
      saved = null;
    }
  }
}
