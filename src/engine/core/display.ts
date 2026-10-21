import { call, register } from "../dispatch.ts";
import { drawToFront, drawToPanel, restoreDrawTarget, selectBarPalette } from "../geometry/draw.ts";
import type { Memory } from "../memory.ts";
import { farToLinear, free, malloc, memcpy, sprintf, timerEnable, timerFreeze, timerGet, timerSet, timerThaw } from "../runtime.ts";
import { clearBuffers, clearDrawBuffer, clearFrontBuffer, copyRect, dropColumn, driverSegment, maskBuffer, putPixel, setPalette } from "../vga.ts";

// Buffers: DS:30a6 front buffer, DS:30ac back buffer copy source, DS:30ae saved background.
export const FRONT_SEGMENT = 0x30a6;
export const SCREEN_SEGMENT = 0x30ac;
export const BACKGROUND_SEGMENT = 0x30ae;
// Dirty rectangles of the frame: { x, y, width byte, height byte } at DS:3106, count at DS:18f4.
export const DIRTY_RECTS = 0x3106;
export const DIRTY_COUNT = 0x18f4;
export const FLASH_COLOR = 0x18f6; // flash palette index, 0xff when none
export const FLASH_TIMER = 0x3412; // timer slot of the flash
export const SHAPE_PTR = 0x2e60; // far pointer where the next shape bank is loaded
export const LOADED_PANEL_SET = 0x1953;
export const LOADED_FRONT_SET = 0x1954;

// 0:07ee plot(x, y, color)
export function plot(m: Memory, x: number, y: number, color: number): void {
  putPixel(m, x, y, (color << 24) >> 24);
}

// 0:0776 drawDottedTrail(x, y, edge, middle, direction, count): count 3-pixel runs (edge, middle, edge) stepping by
// the signed (dy, dx) byte pair at DS:7e + 2 * direction.
export function drawDottedTrail(m: Memory, x: number, y: number, edge: number, middle: number, direction: number, count: number): void {
  y = (y - 1) & 0xffff;
  const step = m.u16(0x7e + ((direction << 24) >> 24) * 2);
  const dy = (step << 24) >> 24;
  const dx = (step << 16) >> 24;
  for (; count & 0xffff; count--) {
    plot(m, x, y, middle);
    x = (x + 1) & 0xffff;
    plot(m, x, y, edge);
    x = (x + 1) & 0xffff;
    plot(m, x, y, middle);
    x = (x + dx - 2) & 0xffff;
    y = (y + dy) & 0xffff;
  }
}

// 0:084e drawDropColumn(x, y, color, flags)
export function drawDropColumn(m: Memory, x: number, y: number, color: number, flags: number): void {
  dropColumn(m, x, y, color, flags);
}

// 0:0339 / 0:03b6 CGA and Tandy lookup tables: nothing in VGA mode.
export function cgaTables(_m: Memory): void {}

// 0:04fa allocBanks(): far blocks of 0xfff0 bytes for the shape banks (DS:2eda, also the load pointer DS:2e60),
// 0xb1d0 at DS:2ee6 and 0x7d00 at DS:2ef0, each followed by its linear end and its segment (DS:2ee2/2efa for the
// first). The current size is kept in DS:2ede. Returns 1 when a block could not be allocated.
export function allocBanks(m: Memory): number {
  const set32 = (at: number, v: number): void => {
    m.set16(at, v & 0xffff);
    m.set16(at + 2, v >>> 16);
  };
  const alloc = (size: number, at: number, end: number): number => {
    set32(0x2ede, size);
    const p = call(m, "0:efd5", size, 0) >>> 0;
    set32(at, p);
    set32(end, (farToLinear(m, p & 0xffff, p >>> 16) + size) >>> 0);
    return p;
  };
  const banks = alloc(0xfff0, 0x2eda, 0x2ee2);
  set32(SHAPE_PTR, banks);
  for (const [size, at] of [[0xb1d0, 0x2ee6], [0x7d00, 0x2ef0]]) {
    const p = alloc(size, at, at + 4);
    m.set16(at + 8, p >>> 16);
    if (!p) return 1;
  }
  m.set16(0x2efa, banks >>> 16);
  return banks ? 0 : 1;
}

// 0:04a8 setupMaskBuffer(): the driver mask buffer as far pointer DS:2ece, size DS:2ed2.
export function setupMaskBuffer(m: Memory): void {
  const p = maskBuffer(m);
  m.set16(0x2ed0, p >>> 16);
  m.set16(0x2ece, p & 0xffff);
  m.set16(0x2ed2, 0x3e8);
}

// 0:0ab1 clearScreens()
export function clearScreens(m: Memory): void {
  m.set16(0x27ca, m.u16(FRONT_SEGMENT));
  clearBuffers(m);
}

// 0:0b15 clearFront()
export function clearFront(m: Memory): void {
  m.set16(0x27ca, m.u16(FRONT_SEGMENT));
  clearFrontBuffer(m);
}

// 0:0b79 clearBack()
export function clearBack(m: Memory): void {
  clearDrawBuffer(m);
}

// 0:0bc6 showRect(x, y, width, rows): copies a back buffer rectangle to the front buffer (width 0 counts as 1).
export function showRect(m: Memory, x: number, y: number, width: number, rows: number): void {
  copyRect(m, x, y, width || 1, rows, m.u16(SCREEN_SEGMENT), m.u16(FRONT_SEGMENT));
}

// 0:0c81 saveRect(x, y, width, rows): copies a back buffer rectangle to the background buffer.
export function saveRect(m: Memory, x: number, y: number, width: number, rows: number): void {
  copyRect(m, x, y, width || 1, rows, m.u16(SCREEN_SEGMENT), m.u16(BACKGROUND_SEGMENT));
}

// 0:11cc isUnmergedClass(cls): 1 when cls is in the -1 terminated word list at DS:f6.
export function isUnmergedClass(m: Memory, cls: number): number {
  const c = (cls << 24) >> 24;
  for (let p = 0xf6; ; p += 2) {
    const v = m.u16(p);
    if (v === 0xffff) return 0;
    if (((v << 16) >> 16) === c) return 1;
  }
}

// 0:10ea mergeDirtyRect(obj, rect, part): grows the rectangle linked from obj+0xd7[part] to cover rect and drops
// rect (the last one added), unless the class is listed at DS:f6.
export function mergeDirtyRect(m: Memory, obj: number, rect: number, part: number): void {
  if (isUnmergedClass(m, m.u8(obj + 2))) return;
  const link = obj + 0xd7 + ((part << 24) >> 24) * 2;
  const other = m.u16(link);
  if (!other) return;
  let left = m.s16(rect);
  let right = (left + m.u8(rect + 4)) << 16 >> 16;
  let top = m.s16(rect + 2);
  let bottom = (top + m.u8(rect + 5)) << 16 >> 16;
  const oLeft = m.s16(other);
  const oRight = (oLeft + m.u8(other + 4)) << 16 >> 16;
  const oTop = m.s16(other + 2);
  const oBottom = (oTop + m.u8(other + 5)) << 16 >> 16;
  if (left > oLeft) left = oLeft;
  if (right < oRight) right = oRight;
  if (top > oTop) top = oTop;
  if (bottom < oBottom) bottom = oBottom;
  m.set16(other, left);
  m.set16(other + 2, top);
  m.set8(other + 4, right - left);
  m.set8(other + 5, bottom - top);
  m.set16(DIRTY_COUNT, m.u16(DIRTY_COUNT) - 1);
  m.set16(link, 0);
}

// 0:0f4a restoreBackgrounds(): for the 3 parts of every drawn object, copies its last drawn box (+0x41 + 8 * part:
// left, top, right, bottom) from the background buffer and records it as a dirty rectangle; counts down the part
// timers at +0xce and the global DS:8e.
export function restoreBackgrounds(m: Memory): void {
  m.set16(0x191b, 0);
  const count = m.s16(0x3322);
  for (let i = 0; i < count; i++) {
    const obj = m.u16(0x30ca + i * 2);
    if (!obj) continue;
    for (let part = 0; part < 3; part++) {
      if (m.u8(obj + 0xce + part)) m.set8(obj + 0xce + part, m.u8(obj + 0xce + part) - 1);
      const box = obj + 0x41 + part * 8;
      if (!m.u16(box + 4)) continue;
      const n = m.u16(DIRTY_COUNT);
      m.set16(DIRTY_COUNT, n + 1);
      const rect = (DIRTY_RECTS + n * 6) & 0xffff;
      m.set16(rect, m.u16(box));
      m.set16(rect + 2, m.u16(box + 2));
      m.set8(rect + 4, m.u16(box + 4) - m.u16(box));
      m.set8(rect + 5, m.u16(box + 6) - m.u16(box + 2));
      if (!m.u8(rect + 4)) m.set8(rect + 4, 1);
      copyRect(m, m.u16(rect), m.u16(rect + 2), m.u8(rect + 4), m.u8(rect + 5), m.u16(BACKGROUND_SEGMENT), m.u16(SCREEN_SEGMENT));
      if (m.u8(obj + 0xd6) && !m.u8(0x8e)) mergeDirtyRect(m, obj, rect, part);
    }
  }
  if (m.u8(0x8e)) m.set8(0x8e, m.u8(0x8e) - 1);
}

// 0:11fe showDirtyRects(): copies every dirty rectangle (x = -1 marks a dropped one) to the front buffer.
export function showDirtyRects(m: Memory): void {
  for (let i = 0; i < m.s16(DIRTY_COUNT); i++) {
    const rect = (DIRTY_RECTS + i * 6) & 0xffff;
    if (m.u16(rect) === 0xffff) continue;
    showRect(m, m.u16(rect), m.u16(rect + 2), m.u8(rect + 4), m.u8(rect + 5));
  }
  m.set16(DIRTY_COUNT, 0);
}

// 0:149a setRoomPalette(n): palette 0, 1 or 3 (DS:30c4, 30c8, 30c6) into the master palette at [30c2] + 0x60 and
// DAC colors 0x20..0x4f.
export function setRoomPalette(m: Memory, n: number): void {
  const p = n === 0 ? m.u16(0x30c4) : n === 1 ? m.u16(0x30c8) : n === 3 ? m.u16(0x30c6) : -1;
  if (p < 0) return;
  memcpy(m, m.u16(0x30c2) + 0x60, p, 0x90);
  setPalette(m, p, 0x20, 0x30);
}

// 0:14fb setEgaRoomPalette(n): copies the 16-color table 0, 1 or 3 to DS:2fbc (not VGA, kept for 0:238a).
export function setEgaRoomPalette(m: Memory, n: number): void {
  const p = n === 0 ? 0x2f6c : n === 1 ? 0x2f3c : n === 3 ? 0x2f0c : -1;
  if (p >= 0) memcpy(m, 0x2fbc, p, 0x30);
}

// 0:1da4 endFlash(): restores colors 0 and 0xfd from DS:402 when the flash timer ran out.
export function endFlash(m: Memory): void {
  if (m.u8(FLASH_COLOR) === 0xff || timerGet(m, m.s8(FLASH_TIMER))) return;
  setPalette(m, 0x402, 0, 1);
  setPalette(m, 0x402, 0xfd, 1);
  m.set8(FLASH_COLOR, 0xff);
}

// 0:1de6 flash(color, time): sets colors 0 and 0xfd to the RGB at [DS:414 + 2 * color] for time ticks.
export function flash(m: Memory, color: number, time: number): void {
  m.set8(FLASH_COLOR, color);
  const rgb = m.u16(0x414 + color * 2);
  setPalette(m, rgb, 0, 1);
  setPalette(m, rgb, 0xfd, 1);
  const slot = m.s8(FLASH_TIMER);
  timerThaw(m, slot);
  timerSet(m, slot, time);
  timerEnable(m, slot, 1);
  timerFreeze(m, slot);
}

// 0:2358 selectFloorPalette(n): bar palettes n + 0xb and n + 0xd at DAC 0xc0 unless n is current (DS:3b8).
export function selectFloorPalette(m: Memory, n: number): void {
  if ((n & 0xff) === m.u8(0x3b8)) return;
  const v = (n << 24) >> 24;
  selectBarPalette(m, v + 0xb, v + 0xd, 0);
  m.set8(0x3b8, n);
}

// 0:023f readShapeTree(next, end, count, out): fills count pointers at out from the shape table at [DS:2e6a]. While
// next < end an entry is the size of a sub-table (allocated when DS:1955 is set, else reused from out) filled
// recursively; otherwise it is a frame offset relocated by DS:2e68. Returns the next index minus 1.
export function readShapeTree(m: Memory, next: number, end: number, count: number, out: number): number {
  for (let i = 0; i < ((count << 16) >> 16); i++) {
    if (((next << 16) >> 16) < ((end << 16) >> 16)) {
      const n = m.u16(m.u16(0x2e6a));
      m.set16(0x2e6a, m.u16(0x2e6a) + 2);
      let p: number;
      if (m.u8(0x1955)) {
        p = malloc(m, (n * 2) & 0xffff);
        if (!p) fatal(m, 0xa, 0);
        m.set16(out + i * 2, p);
      } else {
        p = m.u16(out + i * 2);
      }
      next = readShapeTree(m, (next + 1) & 0xffff, end, n, p);
    } else {
      m.set16(out + i * 2, m.u16(m.u16(0x2e6a)) + m.u16(0x2e68));
      m.set16(0x2e6a, m.u16(0x2e6a) + 2);
    }
  }
  return (next - 1) & 0xffff;
}

// 0:02f8 fatal(code, arg): shuts down, prints the message for code 0xa (memory) or 0xc (file arg) and exits.
export function fatal(m: Memory, code: number, arg: number): void {
  call(m, "0:31fd");
  if (code === 0xa) call(m, "0:f27d", 0x17);
  else if (code === 0xc) {
    call(m, "0:f27d", 0x2f);
    call(m, "0:f27d", 0x4a, arg);
  }
  call(m, "0:fd35", code);
}

// 0:0000 loadShapes(name): loads "<name>.VG?" (header: type, table size, bank size, set count; then the offset
// table, then the frame bank read to the far pointer DS:2e60). Each set's pointer tree goes to DS:2e6e[id] and to
// the class descriptor +3. Returns 1 on a short header.
export function loadShapes(m: Memory, name: number): number {
  const local = m.push(0x3a);
  const path = local + 2;
  const header = local + 0x32;
  const ext = 2;
  sprintf(m, path, 0xe, ext, name, ext);
  const fd = call(m, "0:f99c", path, 0) & 0xffff;
  if (fd === 0xffff) {
    fatal(m, 0xc, path);
    m.pop(0x3a);
    return 0;
  }
  if ((call(m, "0:fd5d", fd, header, 8) & 0xffff) !== 8) {
    call(m, "0:fd93", fd);
    m.pop(0x3a);
    return 1;
  }
  const size = (m.u16(header + 2) - 8) & 0xffff;
  const table = malloc(m, size);
  if (!table) fatal(m, 0xa, 0);
  if ((call(m, "0:fd5d", fd, table, size) & 0xffff) !== size) fatal(m, 0xa, 0);
  if (m.u16(header) === 1) fatal(m, 0xb, 0);
  const bank = m.u16(header + 4);
  call(m, "0:f0cf", 0x3f, fd, bank, m.u16(SHAPE_PTR), m.u16(SHAPE_PTR + 2), 0, 0);
  call(m, "0:fd93", fd);
  m.set16(0x2e68, m.u16(SHAPE_PTR));
  m.set16(0x2e6a, table);
  const sets = m.s16(header + 6);
  for (let i = 0; i < sets; i++) {
    const p = m.u16(0x2e6a);
    const id = m.u16(p);
    m.set16(0x2e6a, p + 4);
    m.set16(0x2e6c, p + 4);
    readShapeTree(m, 0, m.u16(p + 2), 1, (0x2e6e + id * 2) & 0xffff);
    if (((id << 16) >> 16) < 0x1b) m.set16(m.u16(0x191d + id * 2) + 3, m.u16(0x2e6e + id * 2));
  }
  m.set16(SHAPE_PTR, m.u16(SHAPE_PTR) + bank);
  const result = free(m, table);
  m.pop(0x3a);
  return result;
}

// 0:06a6 loadPanelShapes(set): loads shape file DS:[54 + 2 * set] into the panel bank (DS:2efc) unless loaded.
export function loadPanelShapes(m: Memory, set: number): void {
  if (m.s8(LOADED_PANEL_SET) === ((set << 16) >> 16)) return;
  drawToPanel(m);
  m.set16(SHAPE_PTR, m.u16(0x2efc));
  m.set16(SHAPE_PTR + 2, m.u16(0x2efe));
  m.set16(0x2ebe, m.u16(0x2efc));
  m.set16(0x2ec0, m.u16(0x2efe));
  loadShapes(m, m.u16(0x54 + set * 2));
  restoreDrawTarget(m);
  m.set8(LOADED_PANEL_SET, set);
}

// 0:06ea loadFrontShapes(set): set 0 loads ANM, CGEN, SUR, SHEAD; 1 DGEN; 3 ANM into the front bank (DS:2f04).
export function loadFrontShapes(m: Memory, set: number): void {
  if (m.s8(LOADED_FRONT_SET) === ((set << 16) >> 16)) return;
  drawToFront(m);
  m.set16(0x2f00, m.u16(0x2eea));
  m.set16(0x2f02, m.u16(0x2eec));
  m.set16(SHAPE_PTR, m.u16(0x2f04));
  m.set16(SHAPE_PTR + 2, m.u16(0x2f06));
  m.set16(0x2ebe, m.u16(0x2f04));
  m.set16(0x2ec0, m.u16(0x2f06));
  if (set === 0) for (const name of [0x62, 0x66, 0x6b, 0x6f]) loadShapes(m, name);
  else if (set === 1) loadShapes(m, 0x75);
  else if (set === 3) loadShapes(m, 0x7a);
  restoreDrawTarget(m);
  m.set8(LOADED_FRONT_SET, set);
}

// 0:0dcc loadFile(name, buf, size): reads size bytes of the data file name into buf.
export function loadFile(m: Memory, name: number, buf: number, size: number): void {
  const path = m.push(0x20);
  sprintf(m, path, 0xa4, m.u16(0x199b), name);
  const fp = call(m, "0:f1b3", path, 0xae) & 0xffff;
  if (fp) call(m, "0:e7b1", buf, 1, size, fp);
  call(m, "0:f326", fp);
  m.pop(0x20);
}

// 0:1543 loadPalette(buf, colors, name): reads colors RGB triples of a palette file into buf.
export function loadPalette(m: Memory, buf: number, colors: number, name: number): void {
  const path = m.push(0x20);
  sprintf(m, path, 0x102, m.u16(0x199b), name);
  const fp = call(m, "0:f1b3", path, 0x108) & 0xffff;
  if (fp) {
    const size = (colors * 3) & 0xffff;
    if ((call(m, "0:e7b1", buf, 1, size, fp) & 0xffff) === size) call(m, "0:f326", fp);
  }
  m.pop(0x20);
}

// 0:0e18 initVga(restore): screen geometry globals, mode 13h (driver, not ported), the palette buffers DS:30c0..30c8
// loaded from their files, the master palette into the DAC.
export function initVga(m: Memory, restore: number): void {
  m.set16(0x30b0, 0x3b);
  m.set16(0x30b2, 0x20);
  m.set16(0x30b4, 0x31);
  m.set16(0x30b6, 0x1c);
  m.set16(0x30b8, 0xa);
  m.set16(0x30ba, 4);
  m.set16(0x309c, 0xc8);
  m.set16(0x30bc, 0xa0);
  m.set16(0x30be, 0x140);
  if (restore) call(m, "fff:2bd5");
  m.set16(0x30c0, malloc(m, 0x300));
  m.set16(0x30c2, malloc(m, 0x300));
  m.set16(0x30c4, malloc(m, 0x90));
  m.set16(0x30c6, malloc(m, 0x90));
  m.set16(0x30c8, malloc(m, 0x90));
  if (!m.u16(0x30c0) || !m.u16(0x30c2) || !m.u16(0x30c4) || !m.u16(0x30c6) || !m.u16(0x30c8)) fatal(m, 0x10, 0);
  loadPalette(m, m.u16(0x30c0), 0x100, 0xc0);
  loadPalette(m, m.u16(0x30c2), 0x100, 0xca);
  loadPalette(m, m.u16(0x30c6), 0x30, 0xd3);
  loadPalette(m, m.u16(0x30c8), 0x30, 0xdb);
  loadPalette(m, m.u16(0x30c4), 0x30, 0xe5);
  setPalette(m, m.u16(0x30c2), 0, 0x100);
}

// 0:08b1 initDisplay(restore): VGA setup, then the text window (DS:309e last row, DS:30a0 right edge).
export function initDisplay(m: Memory, restore: number): void {
  initVga(m, restore);
  m.set16(0x309e, m.u16(0x309c) - 1);
  m.set16(0x30a0, 0x13f);
}

// 0:0947 allocScreens(): front buffer at DS:28ce, back buffer in a far block, background buffer in the unused EGA
// driver segment 1504.
export function allocScreens(m: Memory): void {
  const front = m.u16(0x28ce);
  m.set16(0x27ca, front);
  m.set16(FRONT_SEGMENT, front);
  const block = call(m, "0:efd5", 0xfa10, 0) >>> 0;
  if (!block) fatal(m, 0xa, 0);
  m.set16(0x27cc, (farToLinear(m, block & 0xffff, block >>> 16) >>> 4) + 1);
  const ega = (driverSegment(m) - 0x23ac + 0x1504) & 0xffff;
  m.set16(0x27ce, (farToLinear(m, 0x2b, ega) >>> 4) + 1);
  m.set16(0x30aa, ega);
  m.set16(0x30a8, 0x2b);
  m.set16(SCREEN_SEGMENT, m.u16(0x27cc));
  m.set16(BACKGROUND_SEGMENT, m.u16(0x27ce));
}

register("0:07ee", plot);
register("0:0776", drawDottedTrail);
register("0:084e", drawDropColumn);
register("0:0339", cgaTables);
register("0:03b6", cgaTables);
register("0:04fa", allocBanks);
register("0:04a8", setupMaskBuffer);
register("0:0ab1", clearScreens);
register("0:0b15", clearFront);
register("0:0b79", clearBack);
register("0:0bc6", showRect);
register("0:0c81", saveRect);
register("0:11cc", isUnmergedClass);
register("0:10ea", mergeDirtyRect);
register("0:0f4a", restoreBackgrounds);
register("0:11fe", showDirtyRects);
register("0:149a", setRoomPalette);
register("0:14fb", setEgaRoomPalette);
register("0:1da4", endFlash);
register("0:1de6", flash);
register("0:2358", selectFloorPalette);
register("0:023f", readShapeTree);
register("0:02f8", fatal);
register("0:0000", loadShapes);
register("0:06a6", loadPanelShapes);
register("0:06ea", loadFrontShapes);
register("0:0dcc", loadFile);
register("0:1543", loadPalette);
register("0:0e18", initVga);
register("0:08b1", initDisplay);
register("0:0947", allocScreens);
