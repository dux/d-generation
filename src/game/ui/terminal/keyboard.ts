// The CD32 on-screen keyboard picture: h0:14792 points BitMap g:df0c (219 x 69, 8 planes of 28 x 69 bytes) at the
// start of hunk 9 of the executable, which h0:14d1a(0) blits to (0x32, 0x32).
export const KEYBOARD_WIDTH = 219;
export const KEYBOARD_HEIGHT = 69;
const BYTES_PER_ROW = 28;

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

// Chunky palette indexes of the keyboard picture from the executable ./amiga/aga/dgen.
export function decodeKeyboard(executable: Uint8Array): Uint8Array {
  const data = hunkData(executable, 9);
  const planeSize = BYTES_PER_ROW * KEYBOARD_HEIGHT;
  if (data.length < planeSize * 8) throw new Error("hunk 9 is too short for the keyboard planes");
  const pixels = new Uint8Array(KEYBOARD_WIDTH * KEYBOARD_HEIGHT);
  for (let plane = 0; plane < 8; plane++) {
    for (let y = 0; y < KEYBOARD_HEIGHT; y++) {
      for (let x = 0; x < KEYBOARD_WIDTH; x++) {
        if (data[plane * planeSize + y * BYTES_PER_ROW + (x >> 3)]! & (0x80 >> (x & 7))) pixels[y * KEYBOARD_WIDTH + x] = pixels[y * KEYBOARD_WIDTH + x]! | (1 << plane);
      }
    }
  }
  return pixels;
}
