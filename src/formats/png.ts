// The game's pictures are PNGs whose grey value is the palette index (assets/, written by
// ./tools/extract-assets.ts): grey (colour type 0) for full pictures, grey + alpha (type 4) for sprites and
// delta images, where alpha 0 is transparent. Canvas decoding would turn them into colours, so they are decoded
// here: 8-bit, non-interlaced, all five row filters.

export interface IndexedImage {
  width: number;
  height: number;
  pixels: Uint8Array; // palette indexes
  mask: Uint8Array | null; // 1 = opaque; null for pictures without alpha
}

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array): Promise<IndexedImage> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) throw new Error("not a PNG file");
  let width = 0, height = 0, type = -1;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      type = body[9]!;
      if (body[8] !== 8 || (type !== 0 && type !== 4) || body[12] !== 0) throw new Error("expected an 8-bit grey or grey+alpha PNG without interlacing");
    } else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    at += 12 + length;
  }
  const channels = type === 4 ? 2 : 1, stride = width * channels;
  const compressed = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  idat.reduce((at, part) => (compressed.set(part, at), at + part.length), 0);
  const raw = await inflate(compressed);
  if (raw.length < height * (stride + 1)) throw new Error("PNG image data is short");
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[dst + x - channels]! : 0;
      const b = y ? rows[dst - stride + x]! : 0;
      const c = y && x >= channels ? rows[dst - stride + x - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      rows[dst + x] = (raw[src + x]! + predictor) & 0xff;
    }
  }
  if (channels === 1) return { width, height, pixels: rows, mask: null };
  const pixels = new Uint8Array(width * height), mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    pixels[i] = rows[i * 2]!;
    mask[i] = rows[i * 2 + 1] ? 1 : 0;
  }
  return { width, height, pixels, mask };
}
