import { call, register } from "../dispatch.ts";
import { boxesOverlap, findCollision, turnAround } from "../geometry/objects.ts";
import { cellOrigin } from "../geometry/room.ts";
import type { Memory } from "../memory.ts";
import { memset, sprintf } from "../runtime.ts";

// Room occupancy bitmap: 7 bytes per row, one bit per cell column (bit 7 = column 0).
const OCCUPANCY = 0x5de4;
const CELL_COORD = 0x16b5; // pixel -> cell coordinate (signed byte)
const BIT_CLEAR = 0x26f0; // per column: mask clearing its bit
const BIT_SET = 0x26f8; // per column: its bit
const OBJECTS = 0x33ac; // 30 object pointers
const OBJECT_COUNT = 0x1e;
const PLAYER = 0x3400;

const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const s16 = (v: number): number => ((v & 0xffff) ^ 0x8000) - 0x8000;

// 0:d424 blocked(obj, outDir): 1 if an idle, live object collides with an object, the occupancy map or the room edge.
export function blocked(m: Memory, obj: number, out: number): number {
  if (m.u8(obj + 0x18) !== 0 || m.u8(obj + 3) !== 0) return 0;
  if (findCollision(m, obj, out) || hitsOccupied(m, obj, out) || hitsRoomEdge(m, obj, out)) return 1;
  return 0;
}

// 0:d470 hitsOccupied(obj, out): 1 (and *out = 1) if the object's cell box overlaps a set occupancy bit.
export function hitsOccupied(m: Memory, obj: number, out: number): number {
  if (m.u8(obj + 2) === 0xb) {
    const mode = m.u8(obj + 0x85);
    if (mode !== 5 && mode !== 7) return 0;
  }
  const x0 = m.s8(CELL_COORD + m.u8(obj + 0xc3));
  const y0 = m.s8(CELL_COORD + m.u8(obj + 0xc5));
  const x1 = m.s8(CELL_COORD + m.u8(obj + 0xc7));
  const y1 = m.s8(CELL_COORD + m.u8(obj + 0xc9));
  const masks = m.u16(0x26d0 + (((x1 - x0) << 1) & 0xffff));
  const mask = m.u16((masks + (x0 & 7) * 2) & 0xffff);
  let row = (y0 * 7 + (x0 >> 3) + OCCUPANCY) & 0xffff;
  let rows = s8(y1 - y0);
  for (;;) {
    if (m.u16(row) & mask) {
      m.set8(out, 1);
      return 1;
    }
    row = (row + 7) & 0xffff;
    rows = rows - 1;
    if (rows < 0) return 0;
    rows = s8(rows);
  }
}

// 0:d551 hitsRoomEdge(obj, outDir): 1 if the object leaves the room box; *out = 0x21..0x24 edge code.
export function hitsRoomEdge(m: Memory, obj: number, out: number): number {
  const top = m.u16(0x30b6);
  const left = m.u16(0x30b4);
  let code = 0;
  if (s16(m.u8(obj + 0xa) - m.u8(obj + 0xc)) < s16(top + 4)) code = 0x21;
  else if (m.u8(obj + 0xa) >= s16(top + m.u16(0x309c) - 10)) code = 0x23;
  else if (m.u8(obj + 8) < s16(left + 8)) code = 0x24;
  else if (m.u8(obj + 8) >= s16(left + m.u16(0x30bc) - 8)) code = 0x22;
  if (!code) return 0;
  m.set8(out, code);
  noop();
  return 1;
}

// 0:d5fa noop(): empty.
export function noop(): void {}

// 0:d5fb placeInCell(obj): snaps an object with a footprint to its cell and marks it in the occupancy map.
export function placeInCell(m: Memory, obj: number): void {
  if (m.u8(m.u16(obj + 0x16)) === 0) return;
  cellToScreen(m, obj);
  m.set16(obj + 8, (((m.u16(obj + 1) + m.u16(obj + 5)) << 7) + 0x80) & 0xffff);
  m.set16(obj + 0xa, (((m.u16(obj + 5) - m.u16(obj + 1)) << 7) + 0x8080) & 0xffff);
  m.set8(obj + 0x14, m.u8(CELL_COORD + m.u8(obj + 9)));
  m.set8(obj + 0x15, m.u8(CELL_COORD + m.u8(obj + 0xb)));
  markFootprint(m, obj, m.s8(0x5f5e));
}

// 0:d65b markFootprint(obj, value): writes value into the occupancy bits of the object's footprint.
export function markFootprint(m: Memory, obj: number, value: number): void {
  let bits = m.u8(m.u16(obj + 0x16)) & 0xaa;
  if (!bits) return;
  const x = (m.u8(obj + 0x14) - 1) & 0xff;
  const y = m.u8(obj + 0x15);
  const v = s8(value);
  for (let i = 0; i < 4; i++) {
    if (bits & 2) {
      const offs = m.u16(0x26e8 + i * 2);
      for (let j = 0; j < 4; j += 2) {
        setCell(m, s8(m.u8(offs + j) + x), s8(m.u8(offs + j + 1) + y), v);
      }
    }
    bits = (bits >> 2) & 0xff;
  }
  setCell(m, s8(x) + 3, s8(y), v);
}

// 0:d724 setCell(x, y, value): sets the occupancy bit of (x, y) to value's bit.
export function setCell(m: Memory, x: number, y: number, value: number): void {
  const sx = s16(x);
  const addr = (s16(y) * 7 + (sx >> 3) + OCCUPANCY) & 0xffff;
  const b = sx & 7;
  m.set8(addr, (m.u8(BIT_CLEAR + b) & m.u8(addr)) | (m.u8(BIT_SET + b) & value & 0xff));
}

// 0:d78a cellOccupied(x, y): 1 if the occupancy bit of (x, y) is set.
export function cellOccupied(m: Memory, x: number, y: number): number {
  const sx = s16(x);
  const addr = (s16(y) * 7 + (sx >> 3) + OCCUPANCY) & 0xffff;
  return m.u8(addr) & m.u8(BIT_SET + (sx & 7)) ? 1 : 0;
}

// 0:d7e0 bumpObjects(obj): sends a bump message to both sides of every overlap with another object.
export function bumpObjects(m: Memory, obj: number): number {
  let hit = 0;
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const o = m.u16(OBJECTS + i * 2);
    if (!o) continue;
    const cls = m.u8(o + 2);
    if (cls === 4 || cls === 2) continue;
    if (m.u8(obj + 0x18) === 0 && m.u8(o + 0x18) === 0) continue;
    if (m.u16(obj) === m.u16(o)) continue;
    if (m.u8(obj + 2) === m.u8(o + 0x17)) continue;
    if (m.u8(o + 3) !== 0) continue;
    if (boxesOverlap(m, obj, o)) {
      bumpPair(m, obj, o);
      hit = 1;
    }
  }
  return hit;
}

// 0:d87f collide(obj, code): dispatches a collision code (high 3 bits: 0 map, 0x20 room edge, 0x60 player).
export function collide(m: Memory, obj: number, code: number): number {
  const kind = code & 0xe0;
  if (kind === 0) return collideMap(m, obj);
  if (kind === 0x20) return collideEdge(m, obj);
  if (kind === 0x60) return collidePlayer(m, obj);
  return 0;
}

// 0:d8cf collideMap(obj): handles hitting occupied cells (pushes blocks, turns the object around).
export function collideMap(m: Memory, obj: number): number {
  const bp = m.push(0x32) + 0x32;
  let r = 0;
  if (hitsOccupied(m, obj, bp - 0x23)) {
    const cells = bp - 0x22;
    const n = occupiedCells(m, obj, cells);
    pushBlocks(m, obj, cells);
    m.set8(obj + 7, 0x80);
    m.set8(obj + 9, 0x80);
    call(m, "0:2c34", obj);
    for (let i = 0; i < n; i++) {
      if (!turnAround(m, obj, cells + i * 2, bp - 0x2d)) break;
    }
    m.set16(bp - 0x2f, obj);
    call(m, "0:2c71", 8, bp - 0x31);
    r = 1;
  }
  m.pop(0x32);
  return r;
}

// 0:d968 collideEdge(obj): bounces an object off the room edge; class 0 leaves the room, class 9 scores.
export function collideEdge(m: Memory, obj: number): number {
  const bp = m.push(2) + 2;
  if (!hitsRoomEdge(m, obj, bp - 1)) {
    m.pop(2);
    return 0;
  }
  const code = m.u8(bp - 1) & 0xf;
  m.set8(bp - 1, code);
  call(m, "0:2c34", obj);
  let d = m.u8(obj + 0x13);
  if (!(d & 1)) d += 4;
  else if (code === 1) d = d === 7 ? d - 2 : d + 2;
  else if (code === 2) d = d === 3 ? d + 2 : d - 2;
  else if (code === 3) d = d === 3 ? d - 2 : d + 2;
  else if (code === 4) d = d === 7 ? d + 2 : d - 2;
  d &= 7;
  const cls = m.u8(obj + 2);
  if (cls === 0x13 || cls === 0x14) m.set8(obj + 3, 2);
  setDirection(m, obj, d);
  m.set16(0x33f2, 0);
  const kind = m.s8(obj + 2);
  if (kind === 0) {
    call(m, "0:4385", obj, (code - 1) & 0xffff);
  } else if (kind === 9) {
    if (m.s8(obj + 0x91) === code - 1) {
      m.set8(obj + 3, m.u8(0x18f3));
      m.set8(0x3363, m.u8(0x3363) + 1);
      m.set8(0x3362, m.u8(0x3362) + 1);
      const word = m.u8(0x3363) === 1 ? 0x271f : 0x2726;
      sprintf(m, 0x6144, 0x2700, m.s8(0x3363) & 0xffff, word);
      call(m, "0:cff8", 0x6144, 4, 0x10);
      call(m, "0:b5c3", 0x1d16);
    }
  }
  m.pop(2);
  return 1;
}

// 0:dad0 collidePlayer(obj): 1 if an idle object touching the player exchanged hit messages with it.
export function collidePlayer(m: Memory, obj: number): number {
  if (m.u8(obj + 3) !== 0 || m.u8(obj + 0x18) !== 0 || m.u8(obj + 0xd5) !== 0) return 0;
  if (!boxesOverlap(m, obj, m.u16(0x6e78))) return 0;
  call(m, "0:2c34", obj);
  return hitPair(m, obj, m.u16(0x6e78));
}

// 0:db1c occupiedCells(obj, list): lists occupied cells under the object's box as (y, x) pairs, 0xff-terminated.
export function occupiedCells(m: Memory, obj: number, list: number): number {
  const x0 = m.s8(CELL_COORD + m.u8(obj + 0xc3));
  let y = m.s8(CELL_COORD + m.u8(obj + 0xc5));
  const x1 = m.s8(CELL_COORD + m.u8(obj + 0xc7));
  const y1 = m.s8(CELL_COORD + m.u8(obj + 0xc9));
  let n = 0;
  do {
    let x = x0;
    do {
      if (cellOccupied(m, x & 0xffff, y & 0xffff)) {
        const at = list + s8(n) * 2;
        m.set8(at + 1, x);
        m.set8(at, y);
        n = (n + 1) & 0xff;
      }
      x = s8(x + 1);
    } while (x <= x1);
    y = s8(y + 1);
  } while (y <= y1);
  const at = list + s8(n) * 2;
  m.set8(at, 0xff);
  m.set8(at + 1, 0xff);
  return s8(n) & 0xffff;
}

// 0:dbda markCells(list, value): writes value into the occupancy bits of up to 6 listed (y, x) cells.
export function markCells(m: Memory, list: number, value: number): void {
  for (let i = 0; i < 6; i++) {
    const x = m.u8(list + i * 2 + 1) & 0x7f;
    if (!x) return;
    const y = m.u8(list + i * 2) & 0x7f;
    setCell(m, x, y, value);
  }
}

// 0:dc27 pushBlocks(obj, cells): sends message 0 to every pushable block (class 4) covering one of the cells.
export function pushBlocks(m: Memory, obj: number, cells: number): void {
  const bp = m.push(0x14) + 0x14;
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const o = m.u16(OBJECTS + i * 2);
    if (!o || m.u8(o + 2) !== 4) continue;
    const p = m.u16(o + 0x3c);
    if (!(m.u8(p + 1) & 0x80)) continue;
    if (!cellListsMeet(m, p, cells)) continue;
    m.set16(bp - 0x14, obj);
    m.set16(bp - 0x12, o);
    call(m, "0:2c71", 0, bp - 0x14);
  }
  m.pop(0x14);
}

// 0:dc94 cellListsMeet(a, b): 1 if the 6-entry cell lists share a cell (a's flag bits ignored).
export function cellListsMeet(m: Memory, a: number, b: number): number {
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const x = m.u8(a + i * 2 + 1) & 0x7f;
      if (!x) return 0;
      if (x === m.u8(b + j * 2 + 1) && (m.u8(a + i * 2) & 0x7f) === m.s8(b + j * 2)) return 1;
    }
  }
  return 0;
}

// 0:dcfc anyOnOccupied(): 1 if some solid object overlaps the occupancy map.
export function anyOnOccupied(m: Memory): number {
  const bp = m.push(6) + 6;
  let r = 0;
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const o = m.u16(OBJECTS + i * 2);
    if (!o) continue;
    const cls = m.s8(o + 2);
    if (cls !== 0 && m.u8(m.u16(0x191d + ((cls * 2) & 0xffff)) + 8) === 0) continue;
    if (hitsOccupied(m, o, bp - 5)) {
      r = 1;
      break;
    }
  }
  m.pop(6);
  return r;
}

// 0:dd61 clearCells(obj): zeroes the 12-byte cell list at obj+0x3c.
export function clearCells(m: Memory, obj: number): number {
  return memset(m, m.u16(obj + 0x3c), 0, 0xc);
}

// 0:dd7c hitPair(a, b): sends message 0 (hit) to b from a and to a from b; returns the OR of the results.
export function hitPair(m: Memory, a: number, b: number): number {
  if (m.u8(a + 3) !== 0) return 0;
  const bp = m.push(0x1c) + 0x1c;
  m.set16(bp - 0xc, a);
  m.set16(bp - 0x1c, a);
  m.set16(bp - 0x1a, b);
  m.set16(bp - 0xe, b);
  m.set8(bp - 0xa, m.u8(b + 0x3b) ? m.u8(b + 0x13) : (m.s8(a + 0x13) + 4) & 7);
  m.set8(bp - 0x18, m.u8(a + 0x13));
  const r1 = call(m, "0:2c71", 0, bp - 0xe);
  const r2 = call(m, "0:2c71", 0, bp - 0x1c);
  m.pop(0x1c);
  return (r1 | r2) & 0xffff;
}

// 0:ddee setDirection(obj, dir): sends message 8 (turn) with the new direction.
export function setDirection(m: Memory, obj: number, dir: number): number {
  const bp = m.push(0xe) + 0xe;
  m.set16(bp - 0xc, obj);
  m.set8(bp - 0xa, dir);
  const r = call(m, "0:2c71", 8, bp - 0xe);
  m.pop(0xe);
  return r;
}

// 0:de14 bumpPair(a, b): sends message 6 (bump) to each object from the other.
export function bumpPair(m: Memory, a: number, b: number): void {
  const bp = m.push(0x1c) + 0x1c;
  m.set16(bp - 0x1a, a);
  m.set16(bp - 0xe, a);
  m.set16(bp - 0xc, b);
  m.set16(bp - 0x1c, b);
  call(m, "0:2c71", 6, bp - 0xe);
  call(m, "0:2c71", 6, bp - 0x1c);
  m.pop(0x1c);
}

// 0:de4c cellToScreen(obj): cell origin of the object plus the room's screen offset.
export function cellToScreen(m: Memory, obj: number): void {
  cellOrigin(m, obj);
  m.set16(obj + 1, m.u16(obj + 1) + m.u16(0x30b0));
  m.set16(obj + 5, m.u16(obj + 5) + m.u16(0x30b2) + 6);
}

// 0:affa listItems(): lists the carried item kinds (counts DS:336b..336f) at DS:6ea6, 0xff-terminated.
export function listItems(m: Memory): number {
  let n = 0;
  m.set8(0x6eac, 0);
  for (let i = 0; i < 5; i++) {
    if (m.u8(0x336b + i) !== 0) {
      n = m.u8(0x6eac);
      m.set8(0x6eac, n + 1);
      m.set8(0x6ea6 + s8(n), i);
    }
  }
  n = m.s8(0x6eac);
  m.set8((0x6ea6 + n) & 0xffff, 0xff);
  return n & 0xffff;
}

// 0:b0f3 useItem(): lets the player pick a carried item and uses it.
export function useItem(m: Memory): void {
  if (m.u16(PLAYER) === 0) return;
  call(m, "0:b5c3", 0x1c3e);
  if (!listItems(m)) {
    call(m, "0:cff8", 0x16b2, 3, 0x10);
    return;
  }
  const sel = call(m, "0:b280") & 0xff;
  if (sel === 0xff) return;
  const bp = m.push(8) + 8;
  const item = m.u8((0x6ea6 + s8(sel)) & 0xffff);
  if (item === 3 && m.u8(0x336e) !== 0) {
    m.set16(0x34b0, m.u16(PLAYER));
    const p = call(m, "0:59cd", m.s8(m.u16(PLAYER) + 0x16) & 0xffff, 0xff85) & 0xffff;
    m.set16(0x5468, p);
    if (p) {
      m.set16(p + 0x3f, m.u16(m.u16(PLAYER)));
      if (findCollision(m, p, bp - 3)) {
        collide(m, m.u16(0x5468), m.s8(bp - 3) & 0xffff);
        m.set8(0x336e, m.u8(0x336e) - 1);
      } else if (blocked(m, m.u16(0x5468), bp - 3)) {
        call(m, "0:2656", m.u16(0x5468));
        call(m, "0:b5c3", 0x1a0a);
      } else {
        m.set16(m.u16(0x5468) + 0x3f, 0xffff);
        call(m, "0:b5c3", 0x19ee);
        m.set8(0x336e, m.u8(0x336e) - 1);
      }
    }
  }
  if (item === 2 && m.u8(0x336d) !== 0) {
    m.set8(0x3375, 1);
    m.set16(0x3378, 2);
    m.set16(0x3376, 0xbc00);
    m.set8(0x336d, m.u8(0x336d) - 1);
    const lo = m.u16(0x2efc);
    const hi = m.u16(0x2efe);
    m.set16(0x2e62, hi);
    m.set16(0x2e60, lo);
    m.set16(0x2ec0, hi);
    m.set16(0x2ebe, lo);
    call(m, "0:06a6", 1);
  }
  if (item === 1 && m.u8(0x336c) !== 0) {
    m.set8(0x337a, 1);
    m.set8(0x3370, 1);
    m.set16(0x3373, 1);
    m.set16(0x3371, 0x2c00);
    m.set8(0x336c, m.u8(0x336c) - 1);
    call(m, "0:b5c3", 0x1bd6);
  }
  if (item === 0 && m.u8(0x336b) !== 0) {
    const player = m.u16(PLAYER);
    m.set8(bp - 6, m.u8(player + 8));
    m.set8(bp - 5, m.u8(player + 0xa));
    m.set8(bp - 7, 0xb);
    m.set8(bp - 4, 7);
    if (call(m, "0:2818", bp - 7)) m.set8(0x336b, m.u8(0x336b) - 1);
  }
  m.pop(8);
}

register("0:d424", blocked);
register("0:d470", hitsOccupied);
register("0:d551", hitsRoomEdge);
register("0:d5fa", noop);
register("0:d5fb", placeInCell);
register("0:d65b", markFootprint);
register("0:d724", setCell);
register("0:d78a", cellOccupied);
register("0:d7e0", bumpObjects);
register("0:d87f", collide);
register("0:d8cf", collideMap);
register("0:d968", collideEdge);
register("0:dad0", collidePlayer);
register("0:db1c", occupiedCells);
register("0:dbda", markCells);
register("0:dc27", pushBlocks);
register("0:dc94", cellListsMeet);
register("0:dcfc", anyOnOccupied);
register("0:dd61", clearCells);
register("0:dd7c", hitPair);
register("0:ddee", setDirection);
register("0:de14", bumpPair);
register("0:de4c", cellToScreen);
register("0:affa", listItems);
register("0:b0f3", useItem);
