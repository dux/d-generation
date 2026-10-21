import type { Memory } from "./memory.ts";
import { register } from "./dispatch.ts";

// VGA driver, code segment 23ac. Drawing goes to the back buffer, not to A000.

export const BACKGROUND_BUFFER = 0x27ce; // segment of the clean background copy
export const DRAW_BUFFER = 0x27cc; // segment of the 320x200 back buffer everything is drawn into
export const FRONT_BUFFER = 0x27ca; // segment of the second full-screen buffer cleared by 23ac:0060/0084
export const CLIP_BOTTOM = 0x3a7e; // last visible row
export const CLIP_TOP = 0x5f60; // first visible row for sprites
export const CLIP_RIGHT = 0x30be; // rectangle copies start only left of this column
export const SPRITE_MASKED = 0x3924; // bit 0: sprites are ANDed with the driver's mask buffer
export const SPRITE_SKIP = 0x11bd; // nonzero: sprites skip the columns below
export const SPRITE_SKIP_LEFT = 0x6238;
export const SPRITE_SKIP_RIGHT = 0x6236;
const VGA = 0x2e5c;

// The mask buffer (2 bytes width/height, 2 unused, then one mask byte per pixel) lives in the driver's code
// segment at cs:15fa, and the sprite and rectangle blitters patch a `ret` into their unrolled loops.
const MASK = 0x15fa;
const COPY_ROWS = 0xfb1; // 8 bytes per row: mov cx,dx / rep movsb / add si,bx / add di,bx
const PIXEL_PLAIN = 0x5fc; // 9 bytes per pixel
const PIXEL_SHIFT = 0x765; // 12 bytes
const PIXEL_SHIFT_LOW = 0x946; // 16 bytes
const PIXEL_MASKED = 0xbc7; // 11 bytes
const PIXEL_MASKED_SHIFT = 0xd80; // 14 bytes

export function driverSegment(m: Memory): number {
  return (m.ds - 0x254b + 0x23ac) & 0xffff;
}

function rowOffset(y: number): number {
  return ((y & 0xff) * 320) & 0xffff;
}

function put(m: Memory, seg: number, off: number, v: number): void {
  m.bytes[seg * 16 + (off & 0xffff)] = v & 0xff;
}

function get(m: Memory, seg: number, off: number): number {
  return m.bytes[seg * 16 + (off & 0xffff)];
}

// 23ac:000d setCrtc10(value): CRTC register 10h = table[0x28ec] + value (port I/O only, no memory effect).
export function setCrtc10(_m: Memory, _value: number): void {}

// 23ac:0024 setCrtc04(value): CRTC register 04h = table[0x28e0] + value (port I/O only, no memory effect).
export function setCrtc04(_m: Memory, _value: number): void {}

// 23ac:003b setPalette(palette, first, count): load count RGB triples from DS:palette into the DAC from first.
export function setPalette(m: Memory, palette: number, first: number, count: number): void {
  if (!m.u8(VGA)) return;
  let w = (first & 0xff) * 3;
  let n = (count * 3) & 0xffff || 0x10000;
  for (let bx = palette; n; n--, bx++) {
    if (w < 768) m.dac[w++] = m.u8(bx) & 0x3f;
  }
}

function clearBuffer(m: Memory, global: number): void {
  const at = m.u16(global) * 16;
  m.bytes.fill(0, at, at + 0xfa00);
}

// 23ac:0060 clearBuffers(): zero both full-screen buffers.
export function clearBuffers(m: Memory): void {
  clearBuffer(m, FRONT_BUFFER);
  clearBuffer(m, DRAW_BUFFER);
}

// 23ac:0084 clearFrontBuffer(): zero the buffer at DS:27ca.
export function clearFrontBuffer(m: Memory): void {
  clearBuffer(m, FRONT_BUFFER);
}

// 23ac:009a clearDrawBuffer(): zero the back buffer.
export function clearDrawBuffer(m: Memory): void {
  clearBuffer(m, DRAW_BUFFER);
}

// 23ac:00b0 maskBuffer(): far pointer to the sprite mask buffer (cs:15fa).
export function maskBuffer(m: Memory): number {
  return ((driverSegment(m) << 16) | MASK) >>> 0;
}

// 23ac:00b6 putPixel(x, y, color): clipped to x 0..319, y 0..[3a7e].
export function putPixel(m: Memory, x: number, y: number, color: number): void {
  if (y & 0x8000 || y > m.u16(CLIP_BOTTOM)) return;
  if (x & 0x8000 || x > 0x13f) return;
  put(m, m.u16(DRAW_BUFFER), x + rowOffset(y), color);
}

// 23ac:00fb hline(x, y, length, color): unclipped run of length & ~1 pixels.
export function hline(m: Memory, x: number, y: number, length: number, color: number): void {
  const seg = m.u16(DRAW_BUFFER);
  let di = (x + rowOffset(y)) & 0xffff;
  for (let n = (length & 0xffff) >> 1; n; n--, di += 2) {
    put(m, seg, di, color);
    put(m, seg, di + 1, color);
  }
}

// 23ac:012f dropColumn(x, y, color, flags): dotted vertical trail from (x, y), down to the clip bottom or up
// (flags bit 3) y rows; it paints through empty (0) and 0xfd pixels and skips up to (flags & 7) + 1 others.
export function dropColumn(m: Memory, x: number, y: number, color: number, flags: number): void {
  const seg = m.u16(DRAW_BUFFER);
  let di = (x + rowOffset(y)) & 0xffff;
  let si = y & 0xffff;
  let step = 0x140;
  let al = flags & 0xff;
  if (al & 8) {
    al &= 7;
    step = 0xfec0;
  } else {
    si = (m.u16(CLIP_BOTTOM) - si + 1) & 0xffff;
  }
  if ((al << 24) >> 24 < 7) al = (al + 1) & 0xff;
  const skip = al;
  const pix = () => get(m, seg, di);
  for (;;) {
    if (si & 0x8000) return;
    if (pix() !== 0 && pix() !== 0xfd) return;
    put(m, seg, di, color);
    let cx = skip;
    for (;;) {
      di = (di + step) & 0xffff;
      si = (si - 1) & 0xffff;
      cx = (cx - 1) & 0xffff;
      if (cx && pix() === 0) continue;
      if (cx === 0 || pix() !== 0xfd) break;
    }
  }
}

// 23ac:01ac copyRect(x, y, width, rows, srcSeg, dstSeg): copy a rectangle between two 320-wide buffers at the
// same offset, clipped to rows 0..[3a7e] and to x < [30be] on the right edge of the start column.
export function copyRect(m: Memory, x: number, y: number, width: number, rows: number, src: number, dst: number): void {
  let dy = (y << 16) >> 16;
  let cx = width & 0xffff;
  let bx = (rows << 16) >> 16;
  const bottom = m.s16(CLIP_BOTTOM);
  if (dy > bottom) return;
  if (bx > ((bottom - dy) << 16) >> 16) bx = ((bottom - dy) << 16) >> 16;
  if (dy < 0) {
    bx = ((bx + dy) << 16) >> 16;
    if (bx < 0) return;
    dy = 0;
  }
  let ax = (x << 16) >> 16;
  if (ax >= m.s16(CLIP_RIGHT)) return;
  if (ax < 0) {
    cx = (cx + ax) & 0xffff;
    if (cx & 0x8000) return;
    ax = 0;
  }
  let off = (rowOffset(dy) + ax) & 0xffff;
  const skip = (0x140 - cx) & 0xffff;
  for (let row = 0; row < bx; row++) {
    for (let i = 0; i < cx; i++) put(m, dst, off + i, get(m, src, off + i));
    off = (off + cx + skip) & 0xffff;
  }
  const cs = driverSegment(m);
  const patch = (COPY_ROWS + ((bx << 3) & 0xffff)) & 0xffff;
  put(m, cs, patch, 0x8b);
  put(m, cs, patch + 1, 0xca);
}

// Clip for 23ac:0502/057f: rows 0..199, start column < [30be]. Returns [offset, width, rows] or null.
function clipBackgroundRect(m: Memory, x: number, y: number, width: number, height: number): number[] | null {
  let dy = (y << 16) >> 16;
  let cx = width & 0xff;
  let bx = height & 0xff;
  if (dy > 0xc7) return null;
  if (bx > 0xc7 - dy) bx = 0xc7 - dy;
  if (dy < 0) {
    bx = ((bx + dy) << 16) >> 16;
    if (bx < 0) return null;
    dy = 0;
  }
  let ax = (x << 16) >> 16;
  if (ax >= m.s16(CLIP_RIGHT)) return null;
  if (ax < 0) {
    cx = (cx + ax) & 0xffff;
    if (cx & 0x8000) return null;
    ax = 0;
  }
  return [(rowOffset(dy) + ax) & 0xffff, cx, bx & 0xffff];
}

// 23ac:0502 saveBackground(x, y, width, height, off, seg): copy a rect of the clean background (DS:27ce) to a
// packed far buffer. Returns 0, or -1 when clipped away.
export function saveBackground(m: Memory, x: number, y: number, w: number, h: number, off: number, seg: number): number {
  const clip = clipBackgroundRect(m, x, y, w, h);
  if (!clip) return 0xffff;
  let [si, cx, rows] = clip;
  const src = m.u16(BACKGROUND_BUFFER);
  let di = off & 0xffff;
  do {
    for (let i = 0; i < cx; i++) put(m, seg, di++, get(m, src, si++));
    si = (si + 0x140 - cx) & 0xffff;
    rows = (rows - 1) & 0xffff;
  } while (rows);
  return 0;
}

// 23ac:057f restoreBackground(x, y, width, height, off, seg): copy a packed far buffer back into the clean
// background (DS:27ce). Returns 0, or -1 when clipped away.
export function restoreBackground(m: Memory, x: number, y: number, w: number, h: number, off: number, seg: number): number {
  const clip = clipBackgroundRect(m, x, y, w, h);
  if (!clip) return 0xffff;
  let [di, cx, rows] = clip;
  const dst = m.u16(BACKGROUND_BUFFER);
  let si = off & 0xffff;
  do {
    for (let i = 0; i < cx; i++) put(m, dst, di++, get(m, seg, si++));
    di = (di + 0x140 - cx) & 0xffff;
    rows = (rows - 1) & 0xffff;
  } while (rows);
  return 0;
}

// 23ac:022d maskWithFrame(maskX, maskY, frameOff, frameSeg, frameX, frameY): AND the overlapping part of the
// mask buffer (cs:15fc width, height, pixels; placed at maskX, maskY) with a frame placed at frameX, frameY.
export function maskWithFrame(
  m: Memory,
  maskX: number,
  maskY: number,
  frameOff: number,
  frameSeg: number,
  frameX: number,
  frameY: number,
): void {
  const cs = driverSegment(m);
  let si = frameOff & 0xffff;
  const fw = get(m, frameSeg, si++);
  const fh = get(m, frameSeg, si++);
  const mw = get(m, cs, MASK + 2);
  const mh = get(m, cs, MASK + 3);
  let di = MASK + 4;
  if (((frameX + mw) & 0xffff) <= (maskX & 0xffff) || ((maskX + fw) & 0xffff) <= (frameX & 0xffff)) return;
  if (((frameY + mh) & 0xffff) <= (maskY & 0xffff) || ((maskY + fh) & 0xffff) <= (frameY & 0xffff)) return;
  let frameSkipX = 0;
  let maskSkipX = 0;
  let frameSkipY = 0;
  let maskSkipY = 0;
  const dx = (frameX - maskX) & 0xffff;
  if (dx & 0x8000) maskSkipX = -dx & 0xff;
  else frameSkipX = dx & 0xff;
  const dy = (frameY - maskY) & 0xffff;
  if (!(dy & 0x8000)) {
    frameSkipY = dy & 0xff;
    if (dy) si = (si + (dy & 0xff) * fw) & 0xffff;
  } else {
    maskSkipY = -dy & 0xff;
    di = (di + maskSkipY * mw) & 0xffff;
  }
  const fr = (fh - frameSkipY) & 0xff;
  const mr = (mh - maskSkipY) & 0xff;
  let rows = mr < fr ? mr : fr;
  si = (si + frameSkipX) & 0xffff;
  di = (di + maskSkipX) & 0xffff;
  const fc = (fw - frameSkipX) & 0xff;
  const mc = (mw - maskSkipX) & 0xff;
  const cols = fc < mc ? fc : mc;
  const frameStride = (fw - cols) & 0xffff;
  const maskStride = (mw - cols) & 0xffff;
  do {
    for (let i = 0; i < (cols || 0x10000); i++) {
      put(m, cs, di, get(m, cs, di) & get(m, frameSeg, si));
      si = (si + 1) & 0xffff;
      di = (di + 1) & 0xffff;
    }
    si = (si + frameStride) & 0xffff;
    di = (di + maskStride) & 0xffff;
    rows = (rows - 1) & 0xff;
  } while (rows);
}

// 23ac:0340 drawSprite(x, y, frameOff, frameSeg, shift, flip, lowShift): blit a frame (width, height, pixels;
// 0 = transparent) into the back buffer. Rows are clipped to [5f60]..[3a7e], columns are not. shift is added to
// every color (only to colors <= 0x4f when lowShift bit 0 is set); masked mode ANDs each pixel with cs:15fe;
// [11bd] skips [6238] columns on the left and [6236] on the right; flip mirrors horizontally.
export function drawSprite(
  m: Memory,
  x: number,
  y: number,
  frameOff: number,
  frameSeg: number,
  shift: number,
  flip: number,
  lowShift: number,
): void {
  const masked = m.u16(SPRITE_MASKED) & 1;
  const top = m.u16(CLIP_TOP);
  let skipRight = 0;
  let skipLeft = 0;
  if (m.u8(SPRITE_SKIP)) {
    skipRight = m.u8(SPRITE_SKIP_RIGHT);
    skipLeft = m.u8(SPRITE_SKIP_LEFT);
  }
  const skipBoth = (skipLeft + skipRight) & 0xff;
  y &= 0xffff;
  const below = (m.u16(CLIP_BOTTOM) - y) & 0xffff;
  if (below === 0 || below & 0x8000) return;
  let clipped = 0;
  const fromTop = (y - top) & 0xffff;
  if (fromTop & 0x8000) {
    clipped = -fromTop & 0xff;
    y = top;
  }
  let si = frameOff & 0xffff;
  let mask = MASK + 4;
  const width = get(m, frameSeg, si++);
  const visible = (width - skipRight - skipLeft) & 0xff;
  let height = get(m, frameSeg, si++);
  if (height > ((below << 16) >> 16)) height = below;
  let rows = height & 0xff;
  let ax = 0;
  if (clipped) {
    const left = ((rows << 24) >> 24) - ((clipped << 24) >> 24);
    if (left <= 0) return;
    rows = left & 0xff;
    ax = width * clipped;
  }
  ax = (ax + skipLeft) & 0xffff;
  si = (si + ax) & 0xffff;
  mask = (mask + ax) & 0xffff;

  let advance = skipBoth;
  let dir = 1;
  if (flip & 0xff) {
    si = (si + ((skipRight + visible - 1 - skipLeft) & 0xff)) & 0xffff;
    advance = (((visible << 24) >> 24) * 2 + skipBoth) & 0xffff;
    dir = -1;
  }

  let template: number;
  let unit: number;
  const shifted = shift & 0xff;
  if (!masked) {
    if (shifted) [template, unit] = lowShift & 1 ? [PIXEL_SHIFT_LOW, 16] : [PIXEL_SHIFT, 12];
    else [template, unit] = [PIXEL_PLAIN, 9];
  } else {
    [template, unit] = shifted ? [PIXEL_MASKED_SHIFT, 14] : [PIXEL_MASKED, 11];
  }
  const cs = driverSegment(m);
  const dst = m.u16(DRAW_BUFFER);
  let di = (rowOffset(y) + skipLeft + x) & 0xffff;
  const stride = (0x140 - visible) & 0xffff;
  do {
    for (let i = 0; i < visible; i++) {
      let al = get(m, frameSeg, si);
      si = (si + dir) & 0xffff;
      if (masked) {
        al &= get(m, cs, mask);
        mask = (mask + 1) & 0xffff;
      }
      if (al) {
        if (shifted && (masked || !(lowShift & 1) || al <= 0x4f)) al += shifted;
        put(m, dst, di, al);
      }
      di = (di + 1) & 0xffff;
    }
    si = (si + advance) & 0xffff;
    mask = (mask + skipBoth) & 0xffff;
    di = (di + stride) & 0xffff;
    rows = (rows - 1) & 0xff;
  } while (rows);
  put(m, cs, template + unit * visible, 0xac);
}

register("23ac:000d", setCrtc10);
register("23ac:0024", setCrtc04);
register("23ac:003b", setPalette);
register("23ac:0060", clearBuffers);
register("23ac:0084", clearFrontBuffer);
register("23ac:009a", clearDrawBuffer);
register("23ac:00b0", maskBuffer);
register("23ac:00b6", putPixel);
register("23ac:00fb", hline);
register("23ac:012f", dropColumn);
register("23ac:01ac", copyRect);
register("23ac:022d", maskWithFrame);
register("23ac:0340", drawSprite);
register("23ac:0502", saveBackground);
register("23ac:057f", restoreBackground);
