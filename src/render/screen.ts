import type { Palette } from "../formats/palette.ts";
import type { Frame } from "../formats/shape.ts";

export const WIDTH = 320;
export const HEIGHT = 200;

// 320x200 mode 13h framebuffer: one palette index per pixel.
export class Screen {
  readonly pixels: Uint8Array;

  constructor(
    readonly width = WIDTH,
    readonly height = HEIGHT,
  ) {
    this.pixels = new Uint8Array(width * height);
  }

  clear(color = 0): void {
    this.pixels.fill(color);
  }

  get(x: number, y: number): number {
    return this.pixels[y * this.width + x];
  }

  plot(x: number, y: number, color: number): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) this.pixels[y * this.width + x] = color;
  }

  // Sprite blit with color 0 as transparent (GAME.EXE VGA driver 23ac:0340).
  blit(frame: Frame, x: number, y: number): void {
    const { width, height, pixels } = frame;
    for (let row = 0; row < height; row++) {
      const sy = y + row;
      if (sy < 0 || sy >= this.height) continue;
      for (let col = 0; col < width; col++) {
        const color = pixels[row * width + col];
        const sx = x + col;
        if (color !== 0 && sx >= 0 && sx < this.width) this.pixels[sy * this.width + sx] = color;
      }
    }
  }

  // RGBA bytes; transparentZero leaves index 0 fully transparent (sprite sheets).
  toRGBA(palette: Palette, transparentZero = false, out = new Uint8ClampedArray(this.pixels.length * 4)): Uint8ClampedArray {
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] * 3;
      out[i * 4] = palette[c];
      out[i * 4 + 1] = palette[c + 1];
      out[i * 4 + 2] = palette[c + 2];
      out[i * 4 + 3] = transparentZero && this.pixels[i] === 0 ? 0 : 255;
    }
    return out;
  }
}
