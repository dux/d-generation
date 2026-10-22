import type { Frame, ShapeNode } from "../../formats/shape.ts";
import { Screen } from "../../render/screen.ts";

export interface Clip { left: number; top: number; right: number; bottom: number }
export interface SpriteOptions {
  mirror?: boolean;
  clip?: Clip;
  // h2:4 after h0:f6c0: screen-oriented mask over the frame's 16-pixel-rounded rows, 0 hides the pixel.
  occlusion?: Uint8Array;
}

// Pixels a frame row covers on the blitter: its width rounded up to whole 16-pixel words.
export const frameSpan = (frame: Frame) => ((frame.width - 1) & 0xf0) + 16;

export interface GameFont {
  set: number;
  advances: readonly number[];
}

// h0:dcb4: set36 FONT and glyph advances g:3b03 (codes 32..127; the bytes before them are other data).
export const GAME_FONT: GameFont = {
  set: 36,
  advances: [...Array<number>(32).fill(0), 5,2,3,5,5,5,5,3,3,3,5,5,4,4,2,4,6,3,6,6,7,6,6,6,6,6,2,3,4,5,4,6,4,6,6,6,6,6,6,6,6,4,6,6,6,8,6,6,6,6,6,6,6,6,6,8,6,8,6,5,5,9,5,5,5,6,5,5,5,5,5,5,5,2,3,5,2,8,5,5,5,5,5,5,4,6,6,6,6,5,5,15,0,0,0,0],
};

// h0:3b1a / h0:e2b2: immediate indexed drawing; the host owns the buffers.
export class Gfx {
  private target: Screen;
  private readonly targets: Screen[] = [];

  constructor(readonly screen: Screen, readonly shapes: ReadonlyMap<number, ShapeNode[]>, readonly font: GameFont = GAME_FONT) {
    this.target = screen;
  }

  frame(set: number, path: readonly number[]): Frame {
    let node: ShapeNode | undefined = this.shapes.get(set);
    for (const index of path) {
      if (!Array.isArray(node)) throw new Error(`shape ${set}:${path.join("/")} not found`);
      node = node[index];
    }
    if (!node || Array.isArray(node)) throw new Error(`shape ${set}:${path.join("/")} is not a frame`);
    return node;
  }

  // h10:16 blitShape (via h0:d336): where the mask is set every bitplane is written, so colour 0 is opaque;
  // rows stop above screen.bottom (g:8c68). h10:262 mirrors a row by reversing its 16-pixel-rounded span and
  // rotating it left by the padding, but only for spans of one or two words: wider frames are not rotated and
  // land `padding` pixels to the right.
  blit(frame: Frame, x: number, y: number, options: SpriteOptions = {}): void {
    const target = this.target, clip = options.clip, span = frameSpan(frame);
    const left = Math.max(0, clip?.left ?? 0, x);
    const right = Math.min(target.width - 1, clip?.right ?? target.width - 1, x + span - 1);
    const top = Math.max(0, clip?.top ?? 0, y);
    const bottom = Math.min(target.bottom - 1, clip?.bottom ?? target.bottom - 1, y + frame.height - 1);
    const mirrorEnd = span <= 32 ? frame.width - 1 : span - 1;
    for (let sy = top; sy <= bottom; sy++) {
      const row = (sy - y) * frame.width;
      for (let sx = left; sx <= right; sx++) {
        const col = options.mirror ? mirrorEnd - (sx - x) : sx - x;
        if (col < 0 || col >= frame.width) continue;
        const source = row + col;
        const color = frame.pixels[source]!;
        if (frame.mask ? !frame.mask[source] : color === 0) continue;
        if (options.occlusion && !options.occlusion[(sy - y) * span + sx - x]) continue;
        target.pixels[sy * target.width + sx] = color;
      }
    }
  }

  sprite(set: number, path: readonly number[], x: number, y: number, options: SpriteOptions = {}): void {
    const frame = this.frame(set, path);
    this.blit(frame, Math.trunc(x - frame.x), Math.trunc(y - frame.y), options);
  }

  // h0:3164: clipped, half-open filled rectangle in screen-pixel coordinates.
  bar(x: number, y: number, width: number, height: number, color: number): void {
    const target = this.target;
    const left = Math.max(0, x), right = Math.min(target.width, x + width);
    const top = Math.max(0, y), bottom = Math.min(target.bottom + 1, y + height);
    if (right <= left) return;
    for (let row = top; row < bottom; row++) target.pixels.fill(color, row * target.width + left, row * target.width + right);
  }

  box(x: number, y: number, width: number, height: number, border: number, fill?: number): void {
    if (fill !== undefined) this.bar(x + 1, y + 1, width - 2, height - 2, fill);
    this.bar(x, y, width, 1, border);
    this.bar(x, y + height - 1, width, 1, border);
    this.bar(x, y + 1, 1, height - 2, border);
    this.bar(x + width - 1, y + 1, 1, height - 2, border);
  }

  // h0:dcb4 drawText(): glyphs keep their stored colours (the "|" colour byte g:dc28 only reaches the unused
  // scheme argument of h0:d336) and clip at the last screen row (g:873c), whatever the current view clip is.
  text(text: string, left: number, top: number): { x: number; y: number } {
    const target = this.target, bottom = target.bottom;
    target.bottom = target.height - 1;
    let x = left, y = top;
    try {
      for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i) & 255;
        if (!code) break;
        if (code === 10) { x = left; y += 11; continue; }
        if (code === 64) { x++; continue; }
        if (code === 96) { y += 6; continue; }
        if (code === 124) { i++; continue; }
        if (code === 123) { x = (text.charCodeAt(++i) << 24 >> 24) * 25 - 1200; continue; }
        if ((code << 24 >> 24) < 32) code = 32;
        const glyph = this.frame(this.font.set, [code - 32]);
        const advance = this.font.advances[code];
        if (advance === undefined) throw new Error(`font advance ${code} not loaded`);
        if (x + advance + glyph.x > target.width - 1) { x = left; y += 11; }
        this.blit(glyph, x + glyph.x, y + 11 - glyph.y - glyph.height);
        x += glyph.x + advance - 1;
      }
    } finally {
      target.bottom = bottom;
    }
    return { x, y };
  }

  // h0:de2a wrapText(): lays text out from (left, top), breaking lines at the last space once a line passes
  // x 309 (g:873a - 10), and draws each line with text() when `draw` is set. Returns the line count and the
  // largest x reached (g:db1c), including the glyph that forced a break.
  wrapText(text: string, left: number, top: number, draw: boolean): { lines: number; width: number } {
    let width = 0, lines = 0, x = left, y = top, start = 0, space = 0, i = 0;
    const line = (end: number) => {
      if (draw) this.text(text.slice(start, end), left, y);
      y += 11;
      lines++;
      x = left;
    };
    while (i < text.length) {
      let code = text.charCodeAt(i++) & 255;
      if (!code) break;
      if (code === 32) space = i - 1;
      else if (code === 10) { line(i); start = i; continue; }
      else if ((code << 24 >> 24) < 32) code = 32;
      else if (code === 64) { x++; continue; }
      else if (code === 96) { y += 6; continue; }
      else if (code === 124) { i++; continue; }
      else if (code === 123) { x = (text.charCodeAt(i++) << 24 >> 24) * 25 - 1200; continue; }
      const advance = this.font.advances[code];
      if (advance === undefined) throw new Error(`font advance ${code} not loaded`);
      x += advance - 1 + this.frame(this.font.set, [code - 32]).x;
      if (x > width) width = x;
      if (x > this.target.width - 1 - 10) {
        line(space);
        i = start = space + 1;
      }
    }
    if (start < text.length && text.charCodeAt(start)) {
      lines++;
      if (draw) this.text(text.slice(start), left, y);
    }
    return { lines, width };
  }

  // Panel/front redirection is scoped: exceptions cannot leak the draw target.
  layer<T>(screen: Screen, draw: () => T): T {
    this.targets.push(this.target);
    this.target = screen;
    try { return draw(); }
    finally { this.target = this.targets.pop()!; }
  }

  composite(layer: Screen, transparent = 0): void {
    if (layer.width !== this.target.width || layer.height !== this.target.height) throw new Error("layer geometry mismatch");
    for (let i = 0; i < layer.pixels.length; i++) if (layer.pixels[i] !== transparent) this.target.pixels[i] = layer.pixels[i];
  }
}
