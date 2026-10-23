import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// 8-bit PNG of `channels` bytes per pixel: 1 grey, 2 grey + alpha, 4 RGBA.
function encode(width: number, height: number, data: Uint8Array | Uint8ClampedArray, channels: 1 | 2 | 4): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, { 1: 0, 2: 4, 4: 6 }[channels], 0, 0, 0], 8);

  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function encodePNG(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  return encode(width, height, rgba, 4);
}

// Palette indexes as grey; with a mask, grey + alpha (alpha 255 where the mask is set). See ./src/formats/png.ts.
export function encodeIndexedPNG(width: number, height: number, pixels: Uint8Array, mask?: Uint8Array): Uint8Array {
  if (!mask) return encode(width, height, pixels, 1);
  const data = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    data[i * 2] = pixels[i]!;
    data[i * 2 + 1] = mask[i] ? 255 : 0;
  }
  return encode(width, height, data, 2);
}
