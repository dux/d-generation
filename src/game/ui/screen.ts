// Pictures drawn outside room play (title, story, attract and ending cards) as plain, structured-cloneable data.
// The primitives record what the original drew; ./src/game/ui/render.ts turns the record into pixels and colours.
//
// Bitmaps: the original keeps three interleaved 320x200x8 bitmaps. Harness-observed at every title card:
//   g:de50 = g:daec = planes of g:defc, the displayed View bitmap,
//   g:de5c = g:87fa = planes of g:df00, the back buffer vims and deltas are drawn into,
//   g:de58 = g:87fe = planes of g:df04, the second back buffer (genoq during the intro).
// h0:3164 "fill" and h0:31a6 "copy" are both BltBitMap copies onto g:daec (from g:87fa and g:87fe).
//
// Palettes: LoadRGB32 tables (h0:cc9a, 256 colours) named after their globals, the colour registers, and the
// h10 fade machine (working table h10:324, level h10:f60, counters h10:f5e / h10:fda) stepped by paletteVblank.

import type { TitleSprite } from "./title-picture.ts";

export type Bitmap = "de5c" | "de58" | "de50";
// "vim" g:e0b4 (palette of the last h0:cc28 load), "title" g:daf6, "dgen" g:47e8, "base" g:dafa, "bombed" g:db0a.
export type PaletteTable = "vim" | "title" | "dgen" | "base" | "bombed";

export type DrawOp =
  | { op: "vim"; name: string } // h0:da5c: the whole bitmap from <name>.vim
  | { op: "copy"; source: DrawOp[]; x: number; y: number; width: number; height: number } // BltBitMap, source as it was
  | { op: "delta"; set: number; entry: number; x: number; y: number; clip: number } // h0:11f24 plots, clip g:8c68
  | { op: "text"; x: number; y: number; text: string; wide: number }; // h0:de2a lines through h0:dcb4, g:3b22

// A colour table as loaded into the registers or the fade working table: every component long of the file's
// table (h0:cc9a: v = byte << 2, replicated to 4 bytes) optionally clamped (h10:fe8) or reduced (h10:f70) by level.
export interface PaletteLoad {
  file: string | null; // null: all zero
  op: "none" | "min" | "sub";
  level: number; // u32
  clamp?: number; // a fade-out may clamp the fade-in's subtracted working table
}

export interface ScreenState {
  mode: "room" | "screen";
  objectsVisible: boolean; // h0:b6c has composed its first object picture
  objectFrames: TitleSprite[][];
  // h0:1dd2 in room play: the explosion plotted into the view g:87fa, which h0:1628 also copied over the display
  // below the view clip, shown under bombed.pal; the next room load (h0:1250) replaces all three.
  bombed: { set: number; entry: number; x: number; y: number; clip: number } | null;
  bitmaps: Record<Bitmap, DrawOp[]>;
  clip: number; // g:8c68, bottom clip row of fills and delta plots
  deltaSet: number; // g:2b44, set loaded by h0:ca2a (-1 none)
  textColor: number; // g:dc28
  wideLines: number; // g:3b22: +1 pixel per glyph, 13-pixel wrap, text into g:de5c instead of g:de50
  palette: {
    tables: Record<PaletteTable, string | null>; // palette file loaded into each table
    registers: PaletteLoad & { white15: boolean };
    working: PaletteLoad; // h10:324
    level: number; // h10:f60, shared by both fades
    fadeInSource: string | null; // h10:3476
    fadeInCounter: number; // h10:f5e, negative when idle
    fadeOutCounter: number; // h10:fda, negative when idle
  };
}

// g:873a / g:8734: right edge and height of the view.
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 200;
const FADE_START = 0xf0f0f0f0;
const FADE_STEP = 0x10101010;
// g:1e50: colour selectors of the "|" text code, indexed by the raw byte after it.
const TEXT_COLORS = [
  0, 60, 29, 140, 0, 60, 27, 0, 0, 60, 27, 248, 16, 32, 16, 32, 32, 16, 16, 32, 64, 128, 16, 32, 32, 16, 16, 32, 128, 64, 16, 32,
  32, 16, 16, 32, 64, 128, 16, 32, 32, 16, 16, 32, 0, 0, 0, 0, 96, 185, 123, 84, 143, 127, 108, 252, 133, 133, 7, 29, 131, 131, 131, 0,
];

export function createScreenState(): ScreenState {
  return {
    mode: "room",
    objectsVisible: false,
    objectFrames: [],
    bombed: null,
    bitmaps: { de5c: [], de58: [], de50: [] },
    clip: VIEW_HEIGHT - 1,
    deltaSet: -1,
    textColor: 0,
    wideLines: 0,
    palette: {
      // h0:ada2 loads DGEN.PAL into g:dafa and g:47e8 at startup.
      tables: { vim: null, title: null, dgen: "DGEN.PAL", base: "DGEN.PAL", bombed: null },
      registers: { file: null, op: "none", level: 0, white15: false },
      working: { file: null, op: "none", level: 0 },
      level: 0,
      fadeInSource: null,
      fadeInCounter: -1,
      fadeOutCounter: -1,
    },
  };
}

function table(s: ScreenState, name: PaletteTable): string {
  const file = s.palette.tables[name];
  if (file === null) throw new Error(`palette table ${name} is not loaded`);
  return file;
}

// h0:d58e blitRect(src, dst, x, y, width, height): BltBitMap of the same rectangle, clipped at g:8c68 below
// (height clamps to clip - y, so the clip row itself is not copied), at 0 above and left, skipped from x 320.
function blitRect(s: ScreenState, from: Bitmap, to: Bitmap, x: number, y: number, width: number, height: number): void {
  const clip = s.clip;
  if (y > clip) return;
  if (height > clip - y) height = clip - y;
  if (y < 0) { height += y; y = 0; }
  if (x >= VIEW_WIDTH) return;
  if (x < 0) { width += x; x = 0; }
  if (height <= 0 || width <= 0) return;
  width = Math.min(width, VIEW_WIDTH - x);
  const source = s.bitmaps[from];
  if (x === 0 && y === 0 && width === VIEW_WIDTH && height === VIEW_HEIGHT) {
    s.bitmaps[to] = [...source];
    return;
  }
  const ops = s.bitmaps[to], last = ops[ops.length - 1];
  // The same rectangle copied again from an unchanged source changes nothing (h0:b6c copies every pass).
  if (last?.op === "copy" && last.x === x && last.y === y && last.width === width && last.height === height &&
    last.source.length === source.length && last.source.every((op, i) => op === source[i])) return;
  ops.push({ op: "copy", source: [...source], x, y, width, height });
}

// h0:ad8a clearScreen() -> h0:d15c: g:de50 = g:daec, then BltClear of g:de50 and g:de5c (0xfa00 bytes each).
export function clearScreen(s: ScreenState): void {
  s.bitmaps.de50 = [];
  s.bitmaps.de5c = [];
  s.objectFrames = [];
}

// h0:ad9c restoreView() -> h0:d1b0: BltClear of g:de5c.
export function restoreView(s: ScreenState): void {
  s.bitmaps.de5c = [];
  s.objectFrames = [];
}

// h0:1628 clearView(): with the clip opened to g:8734, copies g:de5c over the display (h0:3164) and over g:de58
// (h0:2144 -> h0:1229a), 320 by 200 from (0, 0) (g:873a + 1), then restores the clip.
export function clearView(s: ScreenState): void {
  const clip = s.clip;
  s.clip = VIEW_HEIGHT;
  blitRect(s, "de5c", "de50", 0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  blitRect(s, "de5c", "de58", 0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  s.clip = clip;
}

// h0:3152 -> h0:cc28 loadVim(name, bitmap): LZW-decodes DATA/<name>.vim over the bitmap (h0:da5c) and loads
// <name>.pal (256 colours) into g:e0b4.
export function loadVim(s: ScreenState, name: string, target: Bitmap): void {
  s.bitmaps[target] = [{ op: "vim", name }];
  s.palette.tables.vim = `${name}.pal`;
}

// h0:2f9e showVim(name, mode): loads the vim into g:de5c; mode 0 applies its palette and copies it to the
// display, any other mode copies it and fades in. Returns the ticks of the h10:f64 wait (0 for mode 0).
export function showVim(s: ScreenState, name: string, mode: number): number {
  loadVim(s, name, "de5c");
  if (mode) {
    fillRect(s, 0, 0, VIEW_WIDTH - 1, VIEW_HEIGHT);
    fadeInPrepare(s, "vim");
    return fadeIn(s);
  }
  applyPalette(s, "vim");
  fillRect(s, 0, 0, VIEW_WIDTH - 1, VIEW_HEIGHT);
  return 0;
}

// h0:3164 -> h0:12268 fillRect(x, y, width, height): copies that rectangle of g:87fa (g:de5c) onto the display
// g:daec; a width of 0 copies one column.
export function fillRect(s: ScreenState, x: number, y: number, width: number, height: number): void {
  blitRect(s, "de5c", "de50", x, y, width || 1, height);
}

// h0:31a6 -> h0:122cc copyRect(x, y, width, height): the same copy from g:87fe (g:de58).
export function copyRect(s: ScreenState, x: number, y: number, width: number, height: number): void {
  blitRect(s, "de58", "de50", x, y, width || 1, height);
}

// h0:3122 -> h0:ca2a loadDeltaSet(n): reads DATA/DLTSET<n>.DAT unless set n is already loaded (g:2b44); the
// entry offsets go to g:4b8, the data to h1:0. Loading set 0x22 also sets g:49f to 0xff (core state).
export function loadDeltaSet(s: ScreenState, set: number): void {
  s.deltaSet = set;
}

// h0:3188 -> h0:11f24 blitDelta(data, x, y): plots delta entry g:4b8[entry] of the loaded set into g:de5c
// (the title points g:de5c at g:de50 for one blit), each pixel clipped by h0:d1d2 at g:8c68.
export function blitDelta(s: ScreenState, set: number, entry: number, x: number, y: number, target: Bitmap = "de5c"): void {
  if (s.deltaSet !== set) throw new Error(`delta set ${set} is not loaded (g:2b44 = ${s.deltaSet})`);
  s.bitmaps[target].push({ op: "delta", set, entry, x, y, clip: s.clip });
}

// h0:dcb4 "|" codes: each stores g:1e50[next byte] in g:dc28; returns g:dc28 after drawing `text`.
export function textColorAfter(text: string, color: number): number {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0x7c) continue;
    const index = text.charCodeAt(++i) << 24 >> 24;
    const selected = TEXT_COLORS[index];
    if (selected === undefined) throw new Error(`text colour selector ${index} is outside the ported g:1e50 table`);
    color = selected;
  }
  return color;
}

// h0:780a -> h0:de2a drawText(pos, text, 1): word-wraps at g:873a - 10 and draws each line with h0:dcb4, which
// draws into g:de5c while g:3b22 is set and into g:de50 otherwise.
export function drawText(s: ScreenState, x: number, y: number, text: string): void {
  s.bitmaps[s.wideLines ? "de5c" : "de50"].push({ op: "text", x, y, text, wide: s.wideLines });
  s.textColor = textColorAfter(text, s.textColor);
}

// h0:3170 -> h10:fb0 fadeOut(table) + h0:31ac -> h10:fdc: copies the table to the working table, level
// 0xf0f0f0f0, 0x11 more steps. Returns the ticks the h10:fdc wait lasts.
export function fadeOut(s: ScreenState, palette: PaletteTable): number {
  const p = s.palette;
  p.working = { file: table(s, palette), op: "none", level: 0 };
  p.level = FADE_START;
  p.fadeOutCounter = 0x11;
  return p.fadeOutCounter + 1;
}

// h0:312e -> h10:f2c fadeInPrepare(table): remembers the table, clears the working table, level 0xf0f0f0f0,
// 0x0f more steps. The steps start on the next vblank.
export function fadeInPrepare(s: ScreenState, palette: PaletteTable): void {
  const p = s.palette;
  p.fadeInSource = table(s, palette);
  p.working = { file: null, op: "none", level: 0 };
  p.level = FADE_START;
  p.fadeInCounter = 0x0f;
}

// h0:30fe -> h10:f64 fadeIn(): waits until the fade-in counter goes negative. Returns the ticks that takes.
export function fadeIn(s: ScreenState): number {
  return Math.max(0, s.palette.fadeInCounter + 1);
}

// h10:212 vblank server, its two palette calls (once per tick, before the timers):
// h10:f70 fade-in step: working = table - level (0 on borrow), level -= 0x10101010, LoadRGB32(working);
// h10:fe8 fade-out step: level -= 0x10101010, LoadRGB32(working), working = min(working, level).
export function paletteVblank(s: ScreenState): void {
  const p = s.palette;
  if (p.fadeInCounter >= 0) {
    p.fadeInCounter--;
    p.working = { file: p.fadeInSource, op: "sub", level: p.level };
    p.level = (p.level - FADE_STEP) >>> 0;
    p.registers = { ...p.working, white15: false };
  }
  if (p.fadeOutCounter >= 0) {
    p.fadeOutCounter--;
    p.level = (p.level - FADE_STEP) >>> 0;
    p.registers = { ...p.working, white15: false };
    const w = p.working;
    if (w.file !== null) {
      if (w.op === "sub") p.working = { ...w, clamp: w.clamp === undefined ? p.level : Math.min(w.clamp, p.level) };
      else p.working = { file: w.file, op: "min", level: w.op === "min" && w.level < p.level ? w.level : p.level };
    }
  }
}

// h0:77fe -> h0:146d2 applyPalette(table): LoadRGB32 on the view port g:47bc.
export function applyPalette(s: ScreenState, palette: PaletteTable): void {
  s.palette.registers = { file: table(s, palette), op: "none", level: 0, white15: false };
}

// h0:77f2 -> h0:14698 setColor15White(): SetRGB32(g:47bc, 15, ~0, ~0, ~0).
export function setColor15White(s: ScreenState): void {
  s.palette.registers.white15 = true;
}

// h0:315e -> h0:cc9a loadPalette(table, file, 256): reads DATA/<file> into a LoadRGB32 table.
export function loadPalette(s: ScreenState, file: string, target: PaletteTable): void {
  s.palette.tables[target] = file;
}
