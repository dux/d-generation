// Amiga AGA release formats (executable ./amiga/aga/dgen, labels h<hunk>:<offset> as in ./tools/m68k/hunk.py).
import type { Frame, ShapeNode, ShapeSet } from "./shape.ts";

export const VIM_WIDTH = 320;
export const VIM_HEIGHT = 200;

// h10:376c/h10:34a8: BACK1.DAT and *.vim are LZW compressed.
// A 4-byte LE uncompressed size, then LSB-first 9..12-bit codes: 256 = clear, 257 = end, first free code 258.
// The width grows when the next free code reaches 512/1024/2048 and stays at 12.
// Dictionary entries are (prefix code, suffix byte); a code >= the next free code is the KwKwK case.
export function unlzw(bytes: Uint8Array): Uint8Array {
  const size = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  const out = new Uint8Array(size);
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let pos = 0;
  let bit = 32;
  let width = 9;
  let limit = 512;
  let next = 258;
  let old = 0;
  let first = 0;

  const read = (): number => {
    const at = bit >> 3;
    const v = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) >>> (bit & 7);
    bit += width;
    return v & ((1 << width) - 1);
  };
  const emit = (b: number) => {
    if (pos >= size) throw new Error("LZW output overruns its declared size");
    out[pos++] = b;
  };

  for (;;) {
    if (bit + width > bytes.length * 8) throw new Error("LZW stream ends without an end code");
    let code = read();
    if (code === 257) break;
    if (code === 256) {
      width = 9;
      limit = 512;
      next = 258;
      code = read();
      old = first = code;
      emit(code);
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= next) {
      stack[sp++] = first;
      code = old;
    }
    while (code > 255) {
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = code;
    stack[sp++] = code;
    while (sp > 0) emit(stack[--sp]);
    // The original has no guard past 4096 entries (its table would overflow); the encoder clears before that.
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
    }
    next++;
    old = inCode;
    if (next >= limit && width !== 12) {
      width++;
      limit <<= 1;
    }
  }
  if (pos !== size) throw new Error(`LZW produced ${pos} bytes, header says ${size}`);
  return out;
}

// h0:cc28: *.vim is an LZW 320x200 image with 8 bitplanes, row-interleaved (row y, plane p at (y*8+p)*40),
// MSB = leftmost pixel. Returns chunky palette indices.
export function decodeVim(bytes: Uint8Array): Uint8Array {
  const planar = unlzw(bytes);
  const rowBytes = VIM_WIDTH / 8;
  if (planar.length !== rowBytes * 8 * VIM_HEIGHT) throw new Error(`vim holds ${planar.length} bytes`);
  const pixels = new Uint8Array(VIM_WIDTH * VIM_HEIGHT);
  for (let y = 0; y < VIM_HEIGHT; y++) {
    for (let p = 0; p < 8; p++) {
      const row = planar.subarray((y * 8 + p) * rowBytes, (y * 8 + p + 1) * rowBytes);
      for (let x = 0; x < VIM_WIDTH; x++) if (row[x >> 3] & (0x80 >> (x & 7))) pixels[y * VIM_WIDTH + x] |= 1 << p;
    }
  }
  return pixels;
}

// aga/*.aga sprite banks (loader h0:278, tree builder h0:424): the DOS VGA tree, big-endian.
// The 16-bit data size is truncated for B1.aga, whose data is 64K longer: h0:2ae flags that file by name and
// h0:4b4 adds 0x10000 to every leaf offset below 0xf000 once a leaf above 0xf000 has been seen in the file.
// Here the larger size is inferred from the file length.
//
// Frame (consumed by h0:d336 drawShape and the blitter h10:16): x, y, width, height bytes, a flags word whose
// low byte selects the stored bitplanes (bit p = plane p; the high byte is not read by the draw path), then
// planes back to back: a mask plane (1 = opaque), then each stored plane in ascending order.
// Each plane is height rows of rowBytes = (((width - 1) & 0xf0) + 16) / 8 bytes, MSB = leftmost pixel.
// h10:16 cookie-cuts stored planes (minterm 0xca) and clears missing planes under the mask (minterm 0x0a),
// so colour 0 is opaque where the mask is set. drawShape ignores x and y; callers apply them as on DOS
// (floor tiles, h0:eae4: left = cellX + x, top = cellY - height - y + 3).
export function parseAgaShapeFile(bytes: Uint8Array): ShapeSet[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (at: number) => view.getUint16(at, false);
  const headerSize = word(2);
  const declared = word(4);
  const large = headerSize + declared + 0x10000 <= bytes.length;
  const data = bytes.subarray(headerSize, headerSize + declared + (large ? 0x10000 : 0));
  let wrapped = false;
  let at = 8;

  const frame = (offset: number): Frame => {
    const width = data[offset + 2];
    const height = data[offset + 3];
    const planeMask = data[offset + 5];
    const rowBytes = (((width - 1) & 0xf0) + 16) >> 3;
    const planeSize = rowBytes * height;
    const pixels = new Uint8Array(width * height);
    const mask = new Uint8Array(width * height);
    let plane = offset + 6;
    const unpack = (into: Uint8Array, value: number) => {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[plane + y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) into[y * width + x] |= value;
        }
      }
      plane += planeSize;
    };
    unpack(mask, 1);
    for (let p = 0; p < 8; p++) if (planeMask & (1 << p)) unpack(pixels, 1 << p);
    if (plane > data.length) throw new Error(`shape frame at ${offset} runs past the data block`);
    return { x: data[offset], y: data[offset + 1], width, height, pixels, mask };
  };

  const leaf = (): Frame => {
    let offset = word(at);
    at += 2;
    if (offset > 0xf000) wrapped = true;
    if (large && wrapped && offset < 0xf000) offset += 0x10000;
    return frame(offset);
  };

  const node = (depth: number): ShapeNode[] => {
    const count = word(at);
    at += 2;
    const children: ShapeNode[] = [];
    for (let i = 0; i < count; i++) children.push(depth === 1 ? leaf() : node(depth - 1));
    return children;
  };

  const sets: ShapeSet[] = [];
  for (let i = word(6); i > 0; i--) {
    const id = word(at);
    const depth = word(at + 2);
    at += 4;
    sets.push({ id, root: node(depth) });
  }
  return sets;
}

// amiga.eff is headerless: all samples back to back, signed 8-bit. The sample table lives in the executable
// (h11:45e6, 8 bytes per sample: length in bytes, offset). h0:1551a plays sound id n by looking it up in the
// sound table (h11:44f6, 6 bytes per sound, ended by a negative id) and starts Paula through h10:37f6 with
// length/2 words, the period and the one-shot flag at volume 63 (h11:6200). Sound 23 plays at volume 31 and
// alternates with sound 51 on every call (h0:1554a); sound 0 stops all channels; sound 57 right after 22 is dropped.
// One-shot channels are stopped by the audio interrupt (h10:38dc) after the first pass, others loop.
export interface AmigaSample {
  offset: number;
  length: number;
  data: Int8Array;
}

export interface AmigaSound {
  id: number;
  sample: number;
  oneShot: boolean;
  period: number;
  volume: number;
}

// Paula clock (PAL) for converting periods to sample rates.
export const PAULA_CLOCK = 3546895;

// h11:45e6: [length, offset] of the 30 samples.
const SAMPLE_TABLE: [number, number][] = [
  [0x38e, 0x0], [0xb92, 0x38e], [0x29d2, 0xf20], [0xb2a, 0x38f2], [0x3692, 0x441c], [0x3692, 0x7aae],
  [0x1dea, 0xb140], [0x1df4, 0xcf2a], [0x80e, 0xed1e], [0x9fa, 0xf52c], [0x11ac, 0xff26], [0x342, 0x110d2],
  [0x6c, 0x11414], [0x21c8, 0x11480], [0xba4, 0x13648], [0xef8, 0x141ec], [0x3c7a, 0x150e4], [0x1f20, 0x18d5e],
  [0x7e6, 0x1ac7e], [0x33aa, 0x1b464], [0x3966, 0x1e80e], [0x5da, 0x22174], [0x274, 0x2274e], [0xaa6, 0x229c2],
  [0x282, 0x23468], [0xbbe, 0x236ea], [0x7ae8, 0x242a8], [0x5062, 0x2bd90], [0x550, 0x30df2], [0x1e2, 0x31342],
];

// h11:44f6: [sound id, sample, one-shot flag, period]; the fourth byte of each record is always 0 and unused.
const SOUND_TABLE: [number, number, number, number][] = [
  [1, 0, 1, 407], [2, 29, 1, 407], [3, 1, 1, 407], [4, 2, 1, 135], [5, 3, 1, 204], [6, 3, 1, 270],
  [9, 4, 1, 407], [10, 5, 1, 407], [7, 2, 1, 204], [8, 2, 1, 270], [12, 2, 1, 407], [13, 6, 1, 407],
  [14, 7, 1, 407], [17, 8, 1, 204], [57, 8, 1, 241], [16, 9, 1, 407], [58, 8, 1, 181], [18, 10, 1, 181],
  [23, 11, 1, 813], [22, 12, 1, 407], [20, 13, 1, 204], [37, 14, 1, 407], [25, 4, 1, 407], [28, 16, 1, 407],
  [29, 8, 1, 270], [15, 17, 1, 407], [59, 18, 1, 407], [11, 19, 1, 407], [26, 8, 1, 135], [32, 20, 1, 407],
  [33, 21, 0, 204], [19, 12, 1, 813], [24, 22, 1, 204], [34, 23, 1, 204], [27, 24, 1, 813], [36, 2, 1, 204],
  [21, 27, 1, 813], [48, 26, 0, 539], [51, 11, 1, 721],
];

export const AMIGA_SOUNDS: AmigaSound[] = SOUND_TABLE.map(([id, sample, oneShot, period]) => ({
  id,
  sample,
  oneShot: oneShot !== 0,
  period,
  volume: id === 23 ? 31 : 63,
}));

export function parseAmigaEffects(bytes: Uint8Array): AmigaSample[] {
  const [lastLength, lastOffset] = SAMPLE_TABLE[SAMPLE_TABLE.length - 1];
  if (bytes.length !== lastOffset + lastLength) throw new Error(`amiga.eff holds ${bytes.length} bytes`);
  return SAMPLE_TABLE.map(([length, offset]) => ({
    offset,
    length,
    data: new Int8Array(bytes.buffer, bytes.byteOffset + offset, length),
  }));
}
