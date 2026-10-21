import type { Memory } from "../memory.ts";
import { hline, setCrtc04, setCrtc10, setPalette } from "../vga.ts";
import { blit, FRAME, SHAPE_SEG } from "./room.ts";
import { register } from "../dispatch.ts";

const DRAW_BUFFER = 0x2e60; // far pointer to the buffer being drawn into
const SAVED_BUFFER = 0x6e7a; // saved DS:2e60 far pointer and DS:2efa
const SAVED_SHAPES = 0x6e7e;
const PANEL_BUFFER = 0x2ef0; // far pointer + shape segment (2ef8) of the panel layer
const PANEL_SHAPES = 0x2ef8;
const FRONT_BUFFER = 0x2ee6; // far pointer + shape segment (2eee) of the front layer
const FRONT_SHAPES = 0x2eee;
const BLIT_SHADOW = 0x3924;
const CLIP_BOTTOM = 0x3a7e;
const SCREEN_BOTTOM = 0x309e;
const CLIP_RIGHT = 0x30a0;
const FONT_FRAMES = 0x2eb6; // frame handles per character from 0x20
const FONT_ADVANCE = 0x119e; // signed extra advance per character
const TEXT_COLORS = 0x120d;
const TEXT_COLOR = 0x6225;
const BOX_FRAMES = 0x2eb8;
const TALL_BOX_FRAMES = 0x2ebc;
const BAR_CHOICE = 0x12ae; // last (a, b, c) palette selection
const BAR_PALETTES_A = 0x21cc;
const BAR_PALETTES_B = 0x21ae;
const TITLE_ENABLED = 0x1993;
const TITLE_FRAMES = 0x2e9c;
const CRTC10_SCRIPT = 0x5f6c; // word lists terminated by 0x80
const CRTC04_SCRIPT = 0x5f6a;

const s8 = (v: number) => (v << 24) >> 24;

function setFrame(m: Memory, handle: number): void {
  m.set16(FRAME, handle);
  m.set16(FRAME + 2, m.u16(SHAPE_SEG));
}

function frameByte(m: Memory, i: number): number {
  return m.bytes[m.u16(FRAME + 2) * 16 + ((m.u16(FRAME) + i) & 0xffff)];
}

function blitFrame(m: Memory, x: number, y: number, shift: number, flip: number, low: number): void {
  blit(m, x, y, m.u16(FRAME) + 2, m.u16(FRAME + 2), shift, flip, low);
}

function redirect(m: Memory, buffer: number, shapes: number): void {
  if (!m.u16(0x2e5c)) return;
  m.set16(SAVED_BUFFER + 2, m.u16(DRAW_BUFFER + 2));
  m.set16(SAVED_BUFFER, m.u16(DRAW_BUFFER));
  m.set16(SAVED_SHAPES, m.u16(SHAPE_SEG));
  m.set16(DRAW_BUFFER + 2, m.u16(buffer + 2));
  m.set16(DRAW_BUFFER, m.u16(buffer));
  m.set16(SHAPE_SEG, m.u16(shapes));
}

// fff:2825 drawToPanel(): save the draw target and draw into the panel layer.
export function drawToPanel(m: Memory): void {
  redirect(m, PANEL_BUFFER, PANEL_SHAPES);
}

// fff:27f5 drawToFront(): save the draw target and draw into the front layer.
export function drawToFront(m: Memory): void {
  redirect(m, FRONT_BUFFER, FRONT_SHAPES);
}

// fff:2855 restoreDrawTarget(): undo drawToPanel/drawToFront.
export function restoreDrawTarget(m: Memory): void {
  if (!m.u16(0x2e5c)) return;
  m.set16(DRAW_BUFFER + 2, m.u16(SAVED_BUFFER + 2));
  m.set16(DRAW_BUFFER, m.u16(SAVED_BUFFER));
  m.set16(SHAPE_SEG, m.u16(SAVED_SHAPES));
}

// fff:21e2 hbar(x, y, color, width): VGA horizontal run of width & ~1 pixels.
export function hbar(m: Memory, x: number, y: number, color: number, width: number): void {
  hline(m, x & 0xffff, y & 0xffff, width & 0xfffe, s8(color) & 0xffff);
}

// fff:20e8 fillRows(x, y, width, rows, color): rows hbars going down from y.
export function fillRows(m: Memory, x: number, y: number, width: number, rows: number, color: number): void {
  for (let i = 0; i < (rows & 0xffff); i++) hbar(m, x, y + i, color, width);
}

// fff:2012 drawBox(x, y, width, color): 14-pixel box: color 7 border lines, filled body, end cap frames.
export function drawBox(m: Memory, x: number, y: number, width: number, color: number): void {
  hbar(m, x, y, 7, width);
  hbar(m, x, y + 0xd, 7, width);
  fillRows(m, x, y + 1, width, 0xc, color);
  const frames = m.u16(BOX_FRAMES);
  setFrame(m, m.u16(frames));
  blitFrame(m, x, y, 0, 0, 0);
  setFrame(m, m.u16(frames + 2));
  blitFrame(m, x + width - 1, y, 0, 0, 0);
}

// fff:2113 drawTallBox(x, y, width, color): 29-pixel box on the panel layer, the end cap mirrored on the right.
export function drawTallBox(m: Memory, x: number, y: number, width: number, color: number): void {
  m.set16(BLIT_SHADOW, 0);
  hbar(m, x, y, 7, width);
  hbar(m, x, y + 0x1c, 7, width);
  fillRows(m, x, y + 1, width, 0x1b, color);
  const frames = m.u16(TALL_BOX_FRAMES);
  drawToPanel(m);
  setFrame(m, m.u16(frames));
  blitFrame(m, x, y, 0, 0, 0);
  blitFrame(m, x + width - 1, y, 0, 1, 0);
  restoreDrawTarget(m);
}

// fff:2c6c selectBarPalette(a, b, c): load 4-color palettes for a and b at DAC c+0xc0 / c+0xc4 unless unchanged.
export function selectBarPalette(m: Memory, a: number, b: number, c: number): void {
  if (a !== m.u16(BAR_CHOICE) || b !== m.u16(BAR_CHOICE + 2) || m.u16(BAR_CHOICE + 4) !== c) {
    setPalette(m, m.u16(BAR_PALETTES_A + a * 2), (c + 0xc0) & 0xffff, 4);
    setPalette(m, m.u16(BAR_PALETTES_B + b * 2), (c + 0xc4) & 0xffff, 4);
  }
  m.set16(BAR_CHOICE, a);
  m.set16(BAR_CHOICE + 2, b);
  m.set16(BAR_CHOICE + 4, c);
}

// fff:0421 drawText(pos, str, skipColors): draw a string at pos (x, y words). Control: '\n' new line, '@' 1-pixel
// space, '`' 5-pixel line feed, '|' color byte (skipped when skipColors), '{' column byte (x = 25n - 1200).
// Wraps at DS:30a0. Returns the final x.
export function drawText(m: Memory, pos: number, str: number, skipColors: number): number {
  return drawTextAt(m, m.u16(pos), m.u16(pos + 2), str, skipColors);
}

export function drawTextAt(m: Memory, left: number, top: number, str: number, skipColors: number): number {
  m.set16(BLIT_SHADOW, 0);
  const savedClip = m.u16(CLIP_BOTTOM);
  m.set16(CLIP_BOTTOM, m.u16(SCREEN_BOTTOM));
  const savedBuffer = m.u16(0x27cc);
  m.set16(0x27cc, m.u16(0x27ca));
  const font = m.u16(FONT_FRAMES);
  let x = left;
  let y = top;
  for (;;) {
    let c = m.s8(str);
    str = (str + 1) & 0xffff;
    if (!c) break;
    if (c === 0xa) {
      y = (y + 0xb) & 0xffff;
      x = left;
      continue;
    }
    if (c < 0x20) c = 0x20;
    else if (c === 0x40) {
      x = (x + 1) & 0xffff;
      continue;
    } else if (c === 0x60) {
      y = (y + 5) & 0xffff;
      continue;
    } else if (c === 0x7c) {
      if (skipColors & 0xff) str = (str + 1) & 0xffff;
      else {
        m.set8(TEXT_COLOR, m.u8(TEXT_COLORS + m.s8(str)));
        str = (str + 1) & 0xffff;
      }
      continue;
    } else if (c === 0x7b) {
      x = (m.s8(str) * 25 + 0xfb50) & 0xffff;
      str = (str + 1) & 0xffff;
      continue;
    }
    const handle = m.u16((font + c * 2 - 0x40) & 0xffff);
    const seg = m.u16(SHAPE_SEG);
    const glyph = (i: number) => m.bytes[seg * 16 + ((handle + i) & 0xffff)];
    const w = glyph(0);
    const advance = m.s8(FONT_ADVANCE + c);
    if (((advance + x + w) << 16) >> 16 > m.s16(CLIP_RIGHT)) {
      y = (y + 0xb) & 0xffff;
      x = left;
    }
    const dy = 0xb - glyph(1) - glyph(3);
    const saved = m.u16(0x282b);
    m.set16(0x282b, m.u16(0x2829));
    blit(m, x + w, y + dy, handle + 2, seg, m.s8(TEXT_COLOR) - 15, 0, 0);
    m.set16(0x282b, saved);
    m.set16(0x2827, 0);
    x = (x + w + advance + 1) & 0xffff;
    if (c === 0x69 || c === 0x6c || c === 0x31) x = (x + 1) & 0xffff;
  }
  m.set16(CLIP_BOTTOM, savedClip);
  m.set16(0x27cc, savedBuffer);
  return x;
}

// fff:0639 wrapText(pos, str, draw, margin): word-wrap str at DS:30a0 + margin - 7 (cutting at spaces in place,
// restored afterwards), drawing each line with drawText when draw is set. Returns the number of lines.
export function wrapText(m: Memory, pos: number, str: number, draw: number, margin: number): number {
  const font = m.u16(FONT_FRAMES);
  const left = m.u16(pos);
  let lines = 0;
  let x = left;
  let y = m.u16(pos + 2);
  let line = str;
  let space = 0;
  const flush = (cut: number, restore: number) => {
    m.set8(cut, 0);
    if (draw & 0xff) drawTextAt(m, left, y, line, s8(margin));
    m.set8(cut, restore);
  };
  for (;;) {
    let c = m.s8(str);
    if (!c) break;
    str = (str + 1) & 0xffff;
    if (c === 0x20) space = (str - 1) & 0xffff;
    else if (c === 0xa) {
      flush(str, m.u8(str));
      line = str;
      y = (y + 0xb) & 0xffff;
      lines++;
      x = left;
      continue;
    } else if (c < 0x20) c = 0x20;
    else if (c === 0x40) {
      x = (x + 1) & 0xffff;
      continue;
    } else if (c === 0x60) {
      y = (y + 5) & 0xffff;
      continue;
    } else if (c === 0x7c) {
      str = (str + 1) & 0xffff;
      continue;
    } else if (c === 0x7b) {
      x = (m.s8(str) * 25 + 0xfb50) & 0xffff;
      str = (str + 1) & 0xffff;
      continue;
    }
    const handle = m.u16((font + c * 2 - 0x40) & 0xffff);
    const w = m.bytes[m.u16(SHAPE_SEG) * 16 + handle];
    x = (w + x + m.s8(FONT_ADVANCE + c) + 1) & 0xffff;
    if (c === 0x69 || c === 0x6c || c === 0x31) x = (x + 1) & 0xffff;
    if (((s8(margin) + m.u16(CLIP_RIGHT) - 7) << 16) >> 16 >= (x << 16) >> 16) continue;
    flush(space, 0x20);
    line = (space + 1) & 0xffff;
    str = line;
    y = (y + 0xb) & 0xffff;
    lines++;
    x = left;
  }
  if (m.u8(line)) {
    lines++;
    if (draw & 0xff) drawTextAt(m, left, y, line, s8(margin));
  }
  return s8(lines) & 0xffff;
}

// fff:0e74 drawTitleBar(wide): row of title frames across the screen (wide: from x 5 to 250 plus an end frame).
export function drawTitleBar(m: Memory, wide: number): void {
  if (!m.u8(TITLE_ENABLED)) return;
  m.set16(BLIT_SHADOW, 0);
  const frames = m.u16(TITLE_FRAMES);
  setFrame(m, m.u16(frames + 2));
  if (wide & 0xff) {
    let y = 2;
    let x = 5;
    do {
      blitFrame(m, x, y, 0, 0, 0);
      y++;
      x += 5;
    } while (x <= 0xfa);
    x -= 4;
    y -= 3;
    setFrame(m, m.u16(frames + 4));
    blitFrame(m, x, y, 0, 0, 0);
  } else {
    let y = 0x1d;
    let x = 0x8c;
    do {
      blitFrame(m, x, y, 0, 0, 0);
      y++;
      x += 5;
    } while (x <= 0xc8);
  }
}

// fff:0f9f crtc10(value): VGA path of the vertical retrace/CRTC 10h write.
export function crtc10(m: Memory, value: number): void {
  setCrtc10(m, s8(value) & 0xffff);
}

// fff:1000 crtc04(value): VGA path of the CRTC 04h write.
export function crtc04(m: Memory, value: number): void {
  setCrtc04(m, s8(value) & 0xffff);
}

// fff:0f61 stepCrtcScripts(): play the next word of the CRTC 10h and 04h scripts (0x80 = finished).
export function stepCrtcScripts(m: Memory): void {
  const a = m.u16(m.u16(CRTC10_SCRIPT));
  if (a !== 0x80) {
    crtc10(m, a);
    m.set16(CRTC10_SCRIPT, m.u16(CRTC10_SCRIPT) + 2);
  }
  const b = m.u16(m.u16(CRTC04_SCRIPT));
  if (b !== 0x80) {
    crtc04(m, b);
    m.set16(CRTC04_SCRIPT, m.u16(CRTC04_SCRIPT) + 2);
  }
}

register("fff:2825", drawToPanel);
register("fff:27f5", drawToFront);
register("fff:2855", restoreDrawTarget);
register("fff:21e2", hbar);
register("fff:20e8", fillRows);
register("fff:2012", drawBox);
register("fff:2113", drawTallBox);
register("fff:2c6c", selectBarPalette);
register("fff:0421", drawText);
register("fff:0639", wrapText);
register("fff:0e74", drawTitleBar);
register("fff:0f9f", crtc10);
register("fff:1000", crtc04);
register("fff:0f61", stepCrtcScripts);
