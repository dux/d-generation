import { drawDelta } from "../../formats/delta.ts";
import type { Frame } from "../../formats/shape.ts";
import { Screen } from "../../render/screen.ts";
import { GAME_FONT } from "../render/gfx.ts";
import type { Game } from "../core/game.ts";
import type { AgaAssets } from "../render/assets.ts";
import { uiPalette, uiVim, type UiAssets } from "./assets.ts";
import type { DrawOp, PaletteLoad, ScreenState } from "./screen.ts";
import { drawTitleObjects } from "./title-picture.ts";

// g:873a: right edge of the view; g:873c: the clip h0:dcb4 sets for glyphs.
const VIEW_RIGHT = 319;
const TEXT_CLIP = 199;

// The displayed picture (g:de50) of a ScreenState and its 256 colour registers as 8-bit RGB.
export function renderScreen(screen: Screen, s: ScreenState, assets: UiAssets, objects?: { game: Game; assets: AgaAssets }): Uint8Array {
  if (screen.width !== 320 || screen.height !== 200) throw new Error("renderScreen needs a 320x200 screen");
  screen.pixels.set(bitmap(s.bitmaps.de50, assets, new Map()).pixels);
  if (s.objectsVisible) {
    if (!objects) throw new Error("screen object picture needs game and AGA assets");
    drawTitleObjects(screen, s, objects.assets, bitmap(s.bitmaps.de58, assets, new Map()));
  }
  return renderScreenPalette(s, assets);
}

// Replays a bitmap's ops from a cleared bitmap. Copy sources are shared arrays, rendered once per call.
function bitmap(ops: readonly DrawOp[], assets: UiAssets, cache: Map<readonly DrawOp[], Screen>): Screen {
  const cached = cache.get(ops);
  if (cached) return cached;
  const out = new Screen();
  for (const op of ops) {
    switch (op.op) {
      case "vim":
        out.pixels.set(uiVim(assets, op.name));
        break;
      case "copy": {
        const source = bitmap(op.source, assets, cache).pixels;
        for (let row = op.y; row < op.y + op.height; row++) {
          const at = row * out.width + op.x;
          out.pixels.set(source.subarray(at, at + op.width), at);
        }
        break;
      }
      case "delta": {
        const entry = assets.deltaSets.get(op.set)?.entries[op.entry];
        if (!entry) throw new Error(`delta ${op.set}:${op.entry} is not in the UI assets`);
        // h0:d1d2 skips plots below g:8c68; colour 0xfc stays a colour (no UI set uses the h3:34 backdrop).
        out.bottom = Math.min(op.clip, out.height - 1);
        drawDelta(out, entry, op.x, op.y);
        out.bottom = out.height - 1;
        break;
      }
      case "text":
        text(out, assets, op.x, op.y, op.text, op.wide);
        break;
    }
  }
  cache.set(ops, out);
  return out;
}

const signed = (byte: number) => byte << 24 >> 24;

function glyph(assets: UiAssets, code: number): Frame {
  const frame = assets.font[code - 32];
  if (!frame || Array.isArray(frame)) throw new Error(`font has no glyph ${code}`);
  return frame;
}

function advance(code: number): number {
  const value = GAME_FONT.advances[code];
  if (value === undefined) throw new Error(`font advance ${code} not loaded`);
  return value;
}

// h0:de2a drawText(pos, text, 1): measures word by word (advance - 1 + bearing + g:3b22 per glyph) and, once x
// passes g:873a - 10, draws up to the last space with h0:dcb4, then restarts 11 rows lower after that space.
// A newline draws the line so far (newline included) and moves 11 rows down.
function text(out: Screen, assets: UiAssets, left: number, top: number, value: string, wide: number): void {
  const bytes = Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff);
  let x = left, y = top, start = 0, space = -1, i = 0;
  while (i < bytes.length && bytes[i]) {
    const c = signed(bytes[i++]!);
    let code = c;
    if (c === 0x0a) {
      line(out, assets, bytes.subarray(start, i), left, y, wide);
      y += 11;
      x = left;
      start = i;
      continue;
    }
    if (c === 0x20) space = i - 1;
    else if (c < 0x20) code = 0x20;
    else if (c === 0x40) { x++; continue; }
    else if (c === 0x60) { y += 6; continue; }
    else if (c === 0x7c) { i++; continue; }
    else if (c === 0x7b) { x = (signed(bytes[i++] ?? 0) - 0x30) * 25; continue; }
    x += advance(code) - 1 + glyph(assets, code).x + wide;
    if (x > VIEW_RIGHT - 10) {
      if (space < start) throw new Error(`text line without a space to wrap at: ${JSON.stringify(value)}`);
      line(out, assets, bytes.subarray(start, space), left, y, wide);
      start = i = space + 1;
      y += 11;
      x = left;
    }
  }
  if (start < bytes.length && bytes[start]) line(out, assets, bytes.subarray(start), left, y, wide);
}

// h0:dcb4 drawLine(pos, text): glyph g at x + bearing, y + 11 - g.y - g.height; x advances by advance + bearing
// + g:3b22 - 1; a glyph past g:873a starts a new line (2 * g:3b22 + 11 lower). Codes below 0x20 (and bytes
// with bit 7, signed) are spaces; "@" adds 1 to x, "`" 6 to y, "{d" sets x = (d - 0x30) * 25, "|c" a colour.
function line(out: Screen, assets: UiAssets, bytes: Uint8Array, left: number, top: number, wide: number): void {
  let x = left, y = top;
  for (let i = 0; i < bytes.length && bytes[i]; i++) {
    const c = signed(bytes[i]!);
    let code = c;
    if (c === 0x0a) { y += 11; x = left; continue; }
    if (c < 0x20) code = 0x20;
    else if (c === 0x40) { x++; continue; }
    else if (c === 0x60) { y += 6; continue; }
    else if (c === 0x7c) { i++; continue; }
    else if (c === 0x7b) { x = (signed(bytes[++i] ?? 0) - 0x30) * 25; continue; }
    const g = glyph(assets, code), step = advance(code);
    if (x + step + g.x > VIEW_RIGHT) { y += wide * 2 + 11; x = left; }
    blitGlyph(out, g, x + g.x, y + 11 - g.y - g.height);
    x += step + g.x + wide - 1;
  }
}

// h0:d336 -> h10:16: masked blit of every plane (unstored planes cleared under the mask), rows from 0 up to
// the g:873c clip row (exclusive), columns 0..319. The glyph keeps its own colours; g:dc28 is not used.
function blitGlyph(out: Screen, frame: Frame, x: number, y: number): void {
  for (let row = Math.max(0, y); row < Math.min(TEXT_CLIP, y + frame.height); row++) {
    for (let col = Math.max(0, x); col < Math.min(out.width, x + frame.width); col++) {
      const at = (row - y) * frame.width + (col - x);
      if (frame.mask ? frame.mask[at] : frame.pixels[at]) out.pixels[row * out.width + col] = frame.pixels[at]!;
    }
  }
}

// h0:cc9a tables hold each component v = byte << 2 as the long v * 0x01010101; LoadRGB32 keeps the top byte.
// h10:fe8 clamps the longs to the fade level (unsigned), h10:f70 subtracts it (0 on borrow).
export function renderScreenPalette(s: ScreenState, assets: UiAssets): Uint8Array {
  const r = s.palette.registers;
  const out = load(r, assets);
  if (r.white15) out.fill(0xff, 15 * 3, 16 * 3);
  return out;
}

function load(table: PaletteLoad, assets: UiAssets): Uint8Array {
  const out = new Uint8Array(768);
  if (table.file === null) return out;
  const bytes = uiPalette(assets, table.file);
  if (!bytes.length) throw new Error(`${table.file}: empty palette`);
  let byte = 0;
  for (let i = 0; i < out.length; i++) {
    // h0:ccf0 ignores fread's return; its one-byte stack slot already holds the previous shifted byte.
    byte = (((i < bytes.length ? bytes[i]! : byte) << 2) & 0xff);
    let value = (byte * 0x01010101) >>> 0;
    if (table.op === "min") value = value < table.level ? value : table.level;
    else if (table.op === "sub") value = value >= table.level ? value - table.level : 0;
    if (table.clamp !== undefined) value = Math.min(value, table.clamp);
    out[i] = value >>> 24;
  }
  return out;
}
