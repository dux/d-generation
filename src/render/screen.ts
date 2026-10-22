import type { Palette } from "../formats/palette.ts";
import type { Frame } from "../formats/shape.ts";

export const WIDTH = 320;
export const HEIGHT = 200;

export interface BlitOptions {
  shift?: number;
  schemeOnly?: boolean;
  skipLeft?: number;
  skipRight?: number;
}

// 320x200 mode 13h framebuffer: one palette index per pixel.
export class Screen {
  readonly pixels: Uint8Array;
  // Clip row from GAME.EXE DS:3a7e: plots reach it, blits stop one row above. The play view uses 181.
  bottom: number;

  constructor(
    readonly width = WIDTH,
    readonly height = HEIGHT,
  ) {
    this.pixels = new Uint8Array(width * height);
    this.bottom = height - 1;
  }

  clear(color = 0): void {
    this.pixels.fill(color);
  }

  get(x: number, y: number): number {
    return this.pixels[y * this.width + x];
  }

  plot(x: number, y: number, color: number): void {
    if (x >= 0 && x < this.width && y >= 0 && y <= this.bottom) this.pixels[y * this.width + x] = color;
  }

  // Sprite blit with color 0 as transparent (GAME.EXE VGA driver 23ac:0340), or the frame mask when it has one.
  // shift is added to every color, or only to scheme colors (<= 0x4f) when schemeOnly;
  // skipLeft/skipRight drop source columns (wall joins).
  blit(frame: Frame, x: number, y: number, { shift = 0, schemeOnly = false, skipLeft = 0, skipRight = 0 }: BlitOptions = {}): void {
    const { width, height, pixels, mask } = frame;
    for (let row = 0; row < height; row++) {
      const sy = y + row;
      if (sy < 0 || sy >= this.bottom) continue;
      for (let col = skipLeft; col < width - skipRight; col++) {
        let color = pixels[row * width + col];
        const sx = x + col;
        if ((mask ? !mask[row * width + col] : color === 0) || sx < 0 || sx >= this.width) continue;
        if (!schemeOnly || color <= 0x4f) color = (color + shift) & 0xff;
        this.pixels[sy * this.width + sx] = color;
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
