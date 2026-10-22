import { GAME_FONT } from "../../render/gfx.ts";

// Text layout facts the game logic needs: message-box heights come from h0:de2a's line count.

// x bearing (first frame byte) of the set 36 FONT glyphs for codes 0x20..0x7a, as h0:de2a adds it per glyph.
const FONT_BEARINGS = [
  0, 2, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 0, 1, 0, 1,
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

// g:1e80..g:1e9f: message colours (g:1e80), fill bytes (g:1e8b) and the style -> colour index table (g:1e91).
const STYLE_BYTES = [
  96, 185, 123, 84, 143, 127, 108, 252, 133, 133, 7, 29, 131, 131, 131, 0,
  139, 0, 0, 6, 8, 9, 3, 0, 32, 32, 64, 64, 64, 76, 105, 118,
];
// g:1e50: colour selectors of the "|" code (h0:dcb4 stores g:1e50[byte] in g:dc28).
const SELECTORS = [
  0, 60, 29, 140, 0, 60, 27, 0, 0, 60, 27, 248, 16, 32, 16, 32, 32, 16, 16, 32, 64, 128, 16, 32, 32, 16, 16, 32, 128, 64, 16, 32,
  32, 16, 16, 32, 64, 128, 16, 32, 32, 16, 16, 32, 0, 0, 0, 0,
];

function styleByte(offset: number): number {
  const value = STYLE_BYTES[offset];
  if (value === undefined) throw new Error(`AGA message style table read g:${(0x1e80 + offset).toString(16)} outside g:1e80..g:1e9f`);
  return value;
}

// g:1e8b[style]: the panel fill byte h0:b89e passes to h0:dfda.
export function styleFill(style: number): number {
  return styleByte(0x0b + style);
}

// g:1e80[g:1e91[style]]: the text colour h0:b89e stores in g:dc28.
export function styleColor(style: number): number {
  return styleByte(styleByte(0x11 + style));
}

// g:1e80[0] and g:1e89: the colours h0:b89e and h0:b9d6 store before their panels.
export const BOX_COLOR = STYLE_BYTES[0]!;
export const PROMPT_COLOR = STYLE_BYTES[9]!;

const signed = (byte: number) => byte << 24 >> 24;

// h0:dcb4 drawLine: the only state it changes is g:dc28, through "|c" codes. Returns the last colour.
export function lineColor(text: string, color: number): number {
  for (let i = 0; i < text.length && text.charCodeAt(i); i++) {
    if (text.charCodeAt(i) !== 0x7c) continue;
    const selector = SELECTORS[signed(text.charCodeAt(++i))];
    if (selector === undefined) throw new Error(`text colour selector ${signed(text.charCodeAt(i))} is outside the ported g:1e50 table`);
    color = selector;
  }
  return color;
}

// h0:de2a drawText(pos, text, 0) measure: the number of lines (a byte) the word wrap at g:873a - 10 produces.
// x advances by g:3b03[code] - 1 + bearing + g:3b22 per glyph; only a literal space is a break point.
export function measureLines(text: string, left: number, wide: number): number {
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0) & 0xff);
  let x = left, lines = 0, start = 0, space = -1, i = 0;
  while (i < bytes.length && bytes[i]) {
    const c = signed(bytes[i++]!);
    let code = c;
    if (c === 0x20) space = i - 1;
    else if (c === 0x0a) { lines++; x = left; start = i; continue; }
    else if (c < 0x20) code = 0x20;
    else if (c === 0x40) { x++; continue; }
    else if (c === 0x60) continue;
    else if (c === 0x7c) { i++; continue; }
    else if (c === 0x7b) { x = (signed(bytes[i++] ?? 0) - 0x30) * 25; continue; }
    const bearing = FONT_BEARINGS[code - 0x20], advance = GAME_FONT.advances[code];
    if (bearing === undefined || advance === undefined) throw new Error(`AGA font has no glyph ${code} (h0:de2a)`);
    x += advance - 1 + bearing + wide;
    if (x > 319 - 10) {
      if (space < start) throw new Error(`AGA h0:de2a wraps a line without a space: ${JSON.stringify(text)}`);
      lines++;
      start = i = space + 1;
      x = left;
    }
  }
  if (start < bytes.length && bytes[start]) lines++;
  return lines & 0xff;
}

// h0:dcb4 drawLine(pos, text) returns the x after the last glyph: advance + bearing + g:3b22 - 1 per glyph, back
// to `left` (one row lower) when a glyph would pass g:873a.
export function lineEnd(text: string, left: number, wide: number): number {
  let x = left;
  for (let i = 0; i < text.length && text.charCodeAt(i); i++) {
    let code = signed(text.charCodeAt(i));
    if (code === 0x0a) { x = left; continue; }
    else if (code < 0x20) code = 0x20;
    else if (code === 0x40) { x++; continue; }
    else if (code === 0x60) continue;
    else if (code === 0x7c) { i++; continue; }
    else if (code === 0x7b) { x = (signed(text.charCodeAt(++i)) - 0x30) * 25; continue; }
    const bearing = FONT_BEARINGS[code - 0x20], advance = GAME_FONT.advances[code];
    if (bearing === undefined || advance === undefined) throw new Error(`AGA font has no glyph ${code} (h0:dcb4)`);
    if (x + advance + bearing > 319) x = left;
    x += advance + bearing + wide - 1;
  }
  return x;
}
