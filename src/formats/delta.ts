import type { Screen } from "../render/screen.ts";

// Delta images: the DLTSET*.DAT run-length entries (drawer h0:11f24), stored as assets/deltas/dltset<n>.png by
// ./tools/extract-assets.ts. Each entry is the final pixels its commands write, placed at (dx, dy) relative to the
// drawing position; mask marks the written pixels (any colour, 0 included).

export interface DeltaImage {
  dx: number;
  dy: number;
  width: number;
  height: number;
  pixels: Uint8Array;
  mask: Uint8Array; // 1 = written
}

export interface DeltaSet {
  entries: DeltaImage[];
}

// Color 0xfc shows the backdrop image (BACK1.DAT) through the delta (h0:1221e).
export const BACKDROP_COLOR = 0xfc;

// Draws an entry at (x, y). With a backdrop, colour 0xfc copies the backdrop pixel at (y * 320 + x) as a
// sign-extended 16-bit offset into the 32000-byte BACK1 buffer (h0:1221e); rows 100 and up read memory outside
// it, which is undefined, and draw colour 0. Without one, 0xfc is drawn as it is.
export function drawDelta(screen: Screen, image: DeltaImage, x: number, y: number, backdrop?: Uint8Array): void {
  for (let row = 0; row < image.height; row++) {
    const py = y + image.dy + row;
    for (let col = 0; col < image.width; col++) {
      const at = row * image.width + col;
      if (!image.mask[at]) continue;
      const px = x + image.dx + col;
      let color = image.pixels[at]!;
      if (color === BACKDROP_COLOR && backdrop) {
        const offset = ((py * 320 + px) << 16) >> 16;
        color = offset >= 0 && offset < backdrop.length ? backdrop[offset]! : 0;
      }
      screen.plot(px, py, color);
    }
  }
}
