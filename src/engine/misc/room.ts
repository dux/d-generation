import { call, callNear, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { sprintf } from "../runtime.ts";
import { cellAt, cellOrigin, CURRENT_CELL, drawAllLowWalls, drawAllTallWalls, drawFloor, maskEdges, SHAPE_SEG } from "../geometry/room.ts";

// Room overlays: delta images (DLT chunks drawn over the backdrop), lines, drops, floor-edge lines and the
// edge list that masks objects behind the floor.

const DELTA_COUNT = 0x1969; // images in the loaded delta set
const DELTA_OFFSETS = 0x196b; // near array: per image, offset into the delta data
const DELTA_DATA = 0x196d; // far pointer (off, seg at 196f)
const DELTA_PLACE_COUNT = 0x1971;
const DELTA_PLACES = 0x1973; // 5-byte entries: image index (s8), x word, y word (bit 15 front layer, 14 keep)
const LINE_COUNT = 0x1975;
const LINES = 0x1977; // 10-byte entries: x0, y0, x1, y1 words, colors word
const DROP_COUNT = 0x1979;
const DROPS = 0x197b; // 8-byte entries
const ROOM_NAME = 0x199b; // room file name prefix (sprintf argument)
const LOADED_DELTA = 0x1fa0;
const BACKDROP_ON = 0x5f70;
const BACKDROP = 0x978a; // far pointer (off, seg at 978c) to the 320x200 backdrop (0x7d00 bytes, 4 pixels each)
const MASK_OBJECT = 0x6df4;
const EDGE_LIST = 0x6dfe;
const EDGE_COUNT = 0x6e76;
const EDGE_TABLE = 0x97b0; // edge list being built
const CELL_LIST = 0x979a; // pointer to the (row, col) pair list being built
const CELL_PAIRS = 0x979c;

const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;

// 0:bfd0 nothing()
export function nop_bfd0(_m: Memory): void {}

// 0:bfd1 nothing()
export function nop_bfd1(_m: Memory): void {}

// 0:bfd3 fn_0_bfd3(): message 0x1f70 through 0:cff8 (6, 0x10).
export function fn_0_bfd3(m: Memory): void {
  callNear(m, 0xcff8, 0x1f70, 6, 0x10);
}

// 0:bfe7 drawDrops(): drawDrop for every DS:197b entry.
export function drawDrops(m: Memory): void {
  let n = m.u16(DROP_COUNT);
  let p = m.u16(DROPS);
  while (n) {
    n = (n - 1) & 0xffff;
    drawDrop(m, p);
    p = (p + 8) & 0xffff;
  }
}

// 0:c015 drawDrop(rec): dotted diagonal from x rec+0 to rec+4 (step = bits 4-6 of rec+7 plus 1, bit 7 rising),
// starting at y rec+2; color rec+6, bits 0-3 of rec+7 passed to 0:084e.
export function drawDrop(m: Memory, rec: number): void {
  const b = m.u8(rec + 7);
  const n = ((b >> 4) & 7) + 1;
  const dy = b & 0x80 ? -n : n;
  const c = s8(b & 0xf);
  let x = m.u16(rec);
  let y2 = (m.u16(rec + 2) << 1) & 0xffff;
  while (m.s16(rec + 4) >= s16(x)) {
    callNear(m, 0x084e, x, (s16(y2) >> 1) & 0xffff, m.u8(rec + 6), c & 0xffff);
    x = (x + n) & 0xffff;
    y2 = (y2 + dy) & 0xffff;
  }
}

// 0:c093 drawLines(): drawLine for every DS:1977 entry.
export function drawLines(m: Memory): void {
  if (m.u16(LINE_COUNT) === 0) return;
  for (let i = 0; i < m.s16(LINE_COUNT); i++) drawLine(m, (m.u16(LINES) + i * 10) & 0xffff);
}

// 0:c0d2 drawLine(rec): diagonal line from (x0, y0) to (x1, y1) through 0:0776.
export function drawLine(m: Memory, rec: number): void {
  const x0 = m.u16(rec);
  const y0 = m.u16(rec + 2);
  let dx = s16(m.u16(rec + 4) - x0);
  const dy = s16(m.u16(rec + 6) - y0);
  let dir: number;
  if (dx < 0) {
    dir = dy >= 0 ? 5 : 7;
    dx = s16(-dx);
  } else {
    dir = dy >= 0 ? 3 : 1;
  }
  callNear(m, 0x0776, x0, (y0 + 1) & 0xffff, m.u8(rec + 9), m.u8(rec + 8), dir, ((dx >> 1) + 1) & 0xffff);
}

// 0:c174 drawDeltas(front): draws the placed delta images of one layer (bit 15 of the y word = front).
export function drawDeltas(m: Memory, front: number): void {
  if (m.u16(DELTA_PLACE_COUNT) === 0) return;
  for (let i = 0; i < m.s16(DELTA_PLACE_COUNT); i++) {
    const e = (m.u16(DELTA_PLACES) + i * 5) & 0xffff;
    const index = m.s8(e);
    if (index > m.s16(DELTA_COUNT)) continue;
    const rec = (e + 1) & 0xffff;
    const w = m.u16(rec + 2);
    const isFront = w & 0x8000 ? 1 : 0;
    if (front ? !isFront : isFront) continue;
    const y = isFront && w & 0x4000 ? w | 0x8000 : w & 0x7fff;
    const off = (m.u16(DELTA_DATA) + m.u16((m.u16(DELTA_OFFSETS) + index * 2) & 0xffff)) & 0xffff;
    drawDelta(m, m.u16(rec), y, off, m.u16(DELTA_DATA + 2));
  }
}

// Delta cursor (a stack struct in the original): x0 +0, x1 +2, y0 +4, y1 +6, x +0xc, y +0xe, count +0x10,
// color +0x12, column-major flag +0x13.
const DELTA_CURSOR_SIZE = 0x2e;

// 0:c244 drawDelta(x, y, off, seg): decodes one delta image: width, height, flag byte, then words
// 0 = run of count+color, 2000 = move+run, 4000 = literal bytes, 6000 = move+literal, 8000 = pixel,
// a000 = move+pixel, ffff = end.
export function drawDelta(m: Memory, x: number, y: number, off: number, seg: number): void {
  const at = () => seg * 16 + off;
  const word = () => {
    const v = m.bytes[at()] | (m.bytes[seg * 16 + ((off + 1) & 0xffff)] << 8);
    off = (off + 2) & 0xffff;
    return v;
  };
  const byte = () => {
    const v = m.bytes[at()];
    off = (off + 1) & 0xffff;
    return v;
  };
  const s = m.push(DELTA_CURSOR_SIZE);
  const w = word();
  const h = word();
  m.set8(s + 0x13, byte() & 0x80 ? 1 : 0);
  m.set16(s, x);
  m.set16(s + 0xc, x);
  m.set16(s + 2, x + w - 1);
  m.set16(s + 4, y);
  m.set16(s + 0xe, y);
  m.set16(s + 6, y + h - 1);
  const move = () => {
    const dx = word();
    const dy = byte();
    m.set16(s + 0xc, x + dx);
    m.set16(s + 0xe, y + dy);
  };
  for (;;) {
    const cmd = word();
    if (cmd === 0xffff) break;
    const op = cmd & 0xe000;
    if (op === 0x2000 || op === 0x6000 || op === 0xa000) move();
    if (op === 0 || op === 0x2000) {
      m.set16(s + 0x10, cmd & 0x1fff);
      m.set8(s + 0x12, byte());
      deltaRun(m, s);
    } else if (op === 0x4000 || op === 0x6000) {
      m.set16(s + 0x10, cmd & 0x1fff);
      deltaLiteral(m, s, off, seg);
      off = (off + (cmd & 0x1fff)) & 0xffff;
    } else if (op === 0x8000 || op === 0xa000) {
      m.set8(s + 0x12, cmd);
      deltaPixel(m, m.u16(s + 0xc), m.u16(s + 0xe), cmd & 0xff);
      deltaAdvance(m, s);
    } else break;
  }
  m.pop(DELTA_CURSOR_SIZE);
}

// 0:c45d deltaRun(cursor): count pixels of one color.
export function deltaRun(m: Memory, s: number): void {
  for (;;) {
    const n = m.u16(s + 0x10);
    m.set16(s + 0x10, n - 1);
    if (!n) return;
    deltaPixel(m, m.u16(s + 0xc), m.u16(s + 0xe), m.u8(s + 0x12));
    if (deltaAdvance(m, s)) return;
  }
}

// 0:c490 deltaLiteral(cursor, off, seg): count pixels read from the far data.
export function deltaLiteral(m: Memory, s: number, off: number, seg: number): void {
  for (;;) {
    const n = m.u16(s + 0x10);
    m.set16(s + 0x10, n - 1);
    if (!n) return;
    const c = m.bytes[seg * 16 + off];
    off = (off + 1) & 0xffff;
    deltaPixel(m, m.u16(s + 0xc), m.u16(s + 0xe), c);
    if (deltaAdvance(m, s)) return;
  }
}

// 0:c4cc deltaAdvance(cursor): next pixel in row (or column) order; 1 past the end of the image.
export function deltaAdvance(m: Memory, s: number): number {
  const [a, b] = m.u8(s + 0x13) ? [0xe, 0xc] : [0xc, 0xe];
  const [aMax, aMin, bMax] = m.u8(s + 0x13) ? [6, 4, 2] : [2, 0, 6];
  m.set16(s + a, m.u16(s + a) + 1);
  if (m.s16(s + a) > m.s16(s + aMax)) {
    m.set16(s + a, m.u16(s + aMin));
    m.set16(s + b, m.u16(s + b) + 1);
    if (m.s16(s + b) > m.s16(s + bMax)) return 1;
  }
  return 0;
}

// 0:c522 deltaPixel(x, y, color): plots through 0:07ee; color 0xfc shows the backdrop pixel when it is loaded.
export function deltaPixel(m: Memory, x: number, y: number, color: number): void {
  let c = color & 0xff;
  if (m.u16(BACKDROP_ON) && c === 0xfc) {
    const i = (((y << 8) & 0xff00) + ((y << 6) & 0xffff) + x) & 0xffff;
    c = m.bytes[m.u16(BACKDROP + 2) * 16 + ((m.u16(BACKDROP) + i) & 0xffff)];
  }
  callNear(m, 0x07ee, x, y, c);
}

// 0:c570 loadDeltas(set): loads DLTSET file `set` (offset table + data); 0 on success or when already loaded.
export function loadDeltas(m: Memory, set: number): number {
  if (m.u16(LOADED_DELTA) === set) return 0;
  let result = 1;
  m.set16(LOADED_DELTA, set);
  const frame = m.push(0x5a);
  const name = frame + 0xa;
  const header = frame + 2; // magic, count, data size
  sprintf(m, name, 0x1fa2, m.u16(ROOM_NAME), set);
  const fd = call(m, "0:f99c", name, 0);
  if (fd !== 0xffff) {
    if (call(m, "0:fd5d", fd, header, 6) === 6) {
      if (m.u16(DELTA_OFFSETS)) call(m, "0:f634", m.u16(DELTA_OFFSETS));
      const count = m.u16(header + 2);
      const table = call(m, "0:f536", (count << 1) & 0xffff);
      m.set16(DELTA_OFFSETS, table);
      if (table && call(m, "0:fd5d", fd, table, (count << 1) & 0xffff) === ((count << 1) & 0xffff)) {
        m.set16(DELTA_COUNT, count);
        if (m.u16(DELTA_DATA + 2) || m.u16(DELTA_DATA)) call(m, "0:f00b", m.u16(DELTA_DATA), m.u16(DELTA_DATA + 2));
        if (set === 0x15) {
          m.set16(DELTA_DATA, m.u16(0x2f04));
          m.set16(DELTA_DATA + 2, m.u16(0x2f06));
        } else {
          const p = call(m, "0:efd5", 0x4c2c, 0);
          m.set16(DELTA_DATA, p);
          m.set16(DELTA_DATA + 2, p >>> 16);
          if (!(p & 0xffff) && !(p >>> 16)) call(m, "0:f27d", 0x1fb2);
        }
        const size = m.u16(header + 4);
        if (call(m, "0:f0cf", 0x3f, fd, size, m.u16(DELTA_DATA), m.u16(DELTA_DATA + 2), 0, 0) === size) result = 0;
      }
    }
    call(m, "0:fd93", fd);
  }
  m.pop(0x5a);
  return result;
}

// 0:c6c6 loadBackdrop(n): reads the 0x7d00-byte backdrop file n into DS:978a when backdrops are on; 1 on success.
export function loadBackdrop(m: Memory, n: number): number {
  let result = 0;
  const frame = m.push(0x18);
  const name = frame + 4;
  sprintf(m, name, 0x1fc8, m.u16(ROOM_NAME), n);
  if (m.u16(BACKDROP_ON)) {
    const fd = call(m, "0:f99c", name, 0);
    if (fd !== 0xffff) {
      if (call(m, "0:f0cf", 0x3f, fd, 0x7d00, m.u16(BACKDROP), m.u16(BACKDROP + 2), 0, 0) === 0x7d00) result = 1;
      call(m, "0:fd93", fd);
    }
  }
  m.pop(0x18);
  return result;
}

// 0:c739 allocBackdrop(): farmalloc(0x7d00) into DS:978a; 1 on success.
export function allocBackdrop(m: Memory): number {
  const p = call(m, "0:efd5", 0x7d00, 0);
  m.set16(BACKDROP, p);
  m.set16(BACKDROP + 2, p >>> 16);
  return p ? 1 : 0;
}

// 0:c75b readJoystickButtons(): game port (0x201) button bits into DS:997c.
export function readJoystickButtons(m: Memory): void {
  m.set8(0x997c, call(m, "14c8:034f", 0x201) & 0xf0);
  m.set8(0x997d, 0);
  m.set8(0x997e, 1);
  m.set8(0x391e, 1);
}

// 0:e171 drawFloorEdges(pair, mask): edge lines of floor cell (row, col) for the sides in mask & cell byte 1.
export function drawFloorEdges(m: Memory, pair: number, mask: number): void {
  const c = m.push(0x24);
  const cur = c + 0xa; // cursor at bp-0x1a
  m.set8(cur + 0x10, m.u8(pair + 1));
  m.set8(cur + 0x11, m.u8(pair));
  cellOrigin(m, cur);
  m.set16(cur + 1, m.u16(cur + 1) + m.u16(0x30b8) + 8);
  m.set16(cur + 5, m.u16(cur + 5) + m.u16(0x30ba) + 0x11);
  const x = ((m.u8(cur) & 0x80 ? 1 : 0) + (m.u16(cur + 1) << 1)) & 0xffff;
  const y = m.u16(cur + 5);
  cellAt(m, cur);
  const bits = mask & m.u8(m.u16(CURRENT_CELL) + 1);
  for (let i = 0; i < 8; i++) {
    const bit = m.u8(0x2688 + i);
    if (!(bits & bit)) continue;
    const w = m.u16(m.u16(CURRENT_CELL) + 2);
    let k = 0;
    if (w & 0xff & bit) k++;
    if ((w >> 8) & bit) k += 2;
    if (((w & 0xff) << 1) & bit) k += 4;
    const color = m.s8(0x2680 + k);
    callNear(m, 0x0776, x, (y - 2) & 0xffff, color & 0xffff, (color + 1) & 0xffff, i, 8);
  }
  m.pop(0x24);
}

// 0:e2c0 drawAllFloorEdges(): drawFloorEdges for all 13x10 cells.
export function drawAllFloorEdges(m: Memory): void {
  const pair = m.push(2);
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 10; col++) {
      m.set8(pair, row);
      m.set8(pair + 1, col);
      drawFloorEdges(m, pair, 0xff);
    }
  }
  m.pop(2);
}

// 0:e2f6 drawAllFloors(): drawFloor for all 13x10 cells.
export function drawAllFloors(m: Memory): void {
  const pair = m.push(2);
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 10; col++) {
      m.set8(pair, row);
      m.set8(pair + 1, col);
      drawFloor(m, pair, 0xff);
    }
  }
  m.pop(2);
}

// 0:e32e drawRoomGrid(): floors, floor edges, low walls, tall walls.
export function drawRoomGrid(m: Memory): void {
  m.set16(0x3924, 0);
  drawAllFloors(m);
  drawAllFloorEdges(m);
  drawAllLowWalls(m);
  drawAllTallWalls(m);
}

// 0:b4d2 fn_0_b4d2(): 1 in room 0x22 when the player's (obj+8 - obj+0xa) diagonal is past 0x66 (half units).
export function fn_0_b4d2(m: Memory): number {
  if (m.u8(0x337e) !== 0x22) return 0;
  const o = m.u16(0x6e96);
  const v = ((m.u8(o + 8) - m.u8(o + 0xa) + 0x100) << 7) & 0xffff;
  return v >> 8 > 0x66 ? 1 : 0;
}

// 0:b510 table_17d8(i)
export function table_17d8(m: Memory, i: number): number {
  return m.u16(0x17d8 + ((i << 1) & 0xffff));
}

// 0:b522 table_1858(i)
export function table_1858(m: Memory, i: number): number {
  return m.u16(0x1858 + ((i << 1) & 0xffff));
}

// 0:bd8c findInGrid(value, pRow, pCol): searches the 39x11 byte grid at DS:5f72; 1 with *pRow/*pCol set on a match.
export function findInGrid(m: Memory, value: number, pRow: number, pCol: number): number {
  for (m.set16(pRow, 0); m.s16(pRow) < 0x27; m.set16(pRow, m.u16(pRow) + 1)) {
    for (m.set16(pCol, 0); m.s16(pCol) < 0xb; m.set16(pCol, m.u16(pCol) + 1)) {
      if (m.u8((m.u16(pRow) * 11 + m.u16(pCol) + 0x5f72) & 0xffff) === value) return 1;
    }
  }
  return 0;
}

// 0:b534 maskObjectByFloor(obj, flag): masks the object's frame with the floor edges in front of it.
export function maskObjectByFloor(m: Memory, obj: number, flag: number): void {
  m.set8(obj + 0x14, 0);
  if (m.u8(obj + 2) === 4) return;
  if (m.u8(obj + 0xc) > 8 && (!flag || m.u8(obj + 2) === 0xb)) return;
  const saved = m.u16(SHAPE_SEG);
  m.set16(SHAPE_SEG, m.u16(0x6e7e));
  m.set16(MASK_OBJECT, obj);
  const n = buildEdgeList(m, EDGE_LIST);
  m.set16(EDGE_COUNT, n);
  if (n) {
    if (s16(n) >= 10) call(m, "0:f27d", 0x19c8, n);
    m.set16(0x9716, m.u16(0x2ece));
    m.set16(0x9718, m.u16(0x2ed0));
    m.set16(0x971e, 0);
    m.set16(0x9720, 0);
    maskEdges(m);
  }
  m.set16(SHAPE_SEG, saved);
}

// 0:de72 buildEdgeList(table): edge entries (col, row, bits) for the floor cells around DS:6df4; returns the count.
export function buildEdgeList(m: Memory, table: number): number {
  m.set16(EDGE_COUNT, 0);
  m.set16(EDGE_TABLE, table);
  let n = cellsAroundObject(m, CELL_PAIRS);
  let i = 0;
  while (n) {
    const e = CELL_PAIRS + i * 2;
    i++;
    if ((m.s8(e + 1) + m.s8(e)) & 3) addEdgesAround(m, e);
    else addEdge(m, e, 0xaa);
    n = (n - 1) & 0xffff;
  }
  return m.u16(EDGE_COUNT);
}

// 0:deda addEdge(pair, bits): converts the pair to grid cell coordinates and ORs bits into its edge entry.
export function addEdge(m: Memory, pair: number, bits: number): void {
  toCell(m, pair);
  mergeEdge(m, pair, bits & 0xff);
}

// 0:def7 addEdgesAround(pair): the four neighbours two half-cells away, each with its facing edge bit.
export function addEdgesAround(m: Memory, pair: number): void {
  const p = m.push(2);
  const n: [number, number, number][] = [[-2, 0, 0x20], [0, 2, 0x80], [2, 0, 2], [0, -2, 8]];
  for (const [d0, d1, bits] of n) {
    m.set8(p + 1, m.u8(pair + 1) + d1);
    m.set8(p, m.u8(pair) + d0);
    addEdge(m, p, bits);
  }
  m.pop(2);
}

// 0:dff8 cellsAroundObject(out): odd half-cell positions along the near edges of DS:6df4's box that pass 0:d78a;
// (y, x) byte pairs, ff ff terminated; returns the count.
export function cellsAroundObject(m: Memory, out: number): number {
  m.set16(CELL_LIST, out);
  const o = m.u16(MASK_OBJECT);
  const conv = (f: number) => m.s8(0x16b5 + m.u8(o + f));
  const odd = (v: number) => (v & 1 ? v : v + 1);
  const x1 = odd(conv(0xbf) + 1);
  const y1 = odd(conv(0xc1) + 1);
  const x0 = odd(conv(0xbb));
  const y0 = odd(conv(0xbd));
  let n = 0;
  const put = (x: number, y: number) => {
    const e = (m.u16(CELL_LIST) + n * 2) & 0xffff;
    m.set8(e + 1, x);
    m.set8(e, y);
    n++;
  };
  for (let y = y0; y <= y1; y += 2) if (callNear(m, 0xd78a, x1 & 0xffff, y & 0xffff)) put(x1, y);
  for (let x = x0; x <= x1; x += 2) if (callNear(m, 0xd78a, x & 0xffff, y1 & 0xffff)) put(x, y1);
  const e = (m.u16(CELL_LIST) + n * 2) & 0xffff;
  m.set8(e, 0xff);
  m.set8(e + 1, 0xff);
  return n;
}

// 0:df81 mergeEdge(pair, bits): ORs bits into the DS:97b0 entry for (pair+1, pair+0), appending it if new.
export function mergeEdge(m: Memory, pair: number, bits: number): void {
  let i = 0;
  let e = m.u16(EDGE_TABLE);
  for (; i < m.s16(EDGE_COUNT); i++, e = (e + 3) & 0xffff) {
    if (m.u8(e) === m.u8(pair + 1) && m.u8(e + 1) === m.u8(pair)) {
      m.set8(e + 2, m.u8(e + 2) | bits);
      return;
    }
  }
  m.set8(e, m.u8(pair + 1));
  m.set8(e + 1, m.u8(pair));
  m.set8(e + 2, bits);
  m.set16(EDGE_COUNT, m.u16(EDGE_COUNT) + 1);
}

// 0:e11b toCell(pair): rotates to grid axes and divides by 4.
export function toCell(m: Memory, pair: number): void {
  rotate(m, pair);
  m.set8(pair + 1, m.s8(pair + 1) >> 2);
  m.set8(pair, m.s8(pair) >> 2);
}

// 0:e140 rotate(pair): (a = pair+1, b = pair+0) -> pair+1 = a - b + 0x14, pair+0 = a + b - 0x1a.
export function rotate(m: Memory, pair: number): void {
  const a = m.s8(pair + 1);
  const b = m.s8(pair);
  m.set8(pair, a + b - 0x1a);
  m.set8(pair + 1, a - b + 0x14);
}

register("0:bfd0", nop_bfd0);
register("0:bfd1", nop_bfd1);
register("0:bfd3", fn_0_bfd3);
register("0:bfe7", drawDrops);
register("0:c015", drawDrop);
register("0:c093", drawLines);
register("0:c0d2", drawLine);
register("0:c174", drawDeltas);
register("0:c244", drawDelta);
register("0:c45d", deltaRun);
register("0:c490", deltaLiteral);
register("0:c4cc", deltaAdvance);
register("0:c522", deltaPixel);
register("0:c570", loadDeltas);
register("0:c6c6", loadBackdrop);
register("0:c739", allocBackdrop);
register("0:c75b", readJoystickButtons);
register("0:e171", drawFloorEdges);
register("0:e2c0", drawAllFloorEdges);
register("0:e2f6", drawAllFloors);
register("0:e32e", drawRoomGrid);
register("0:b4d2", fn_0_b4d2);
register("0:b510", table_17d8);
register("0:b522", table_1858);
register("0:bd8c", findInGrid);
register("0:b534", maskObjectByFloor);
register("0:de72", buildEdgeList);
register("0:deda", addEdge);
register("0:def7", addEdgesAround);
register("0:dff8", cellsAroundObject);
register("0:df81", mergeEdge);
register("0:e11b", toCell);
register("0:e140", rotate);
