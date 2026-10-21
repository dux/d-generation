import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { farBuffer } from "../runtime.ts";
import { restoreBackground, saveBackground } from "../vga.ts";

// Doors that slide open over the room save the screen under them first (up to 4 doors, DOOR +0x86/+0x87).
// Each slot of DS:61b0 is a far pointer into one block from farmalloc: x, y words, width, height bytes, pixels.

const SLOT_SIZE = 0x61aa;
const POOL = 0x61ac; // far pointer (off, seg at 61ae)
const SLOTS = 0x61b0; // 4 far pointers, 0 = slot empty
const FRAME = 0x6120;

// 0:6bd2 allocDoorSaves(): allocate the 4 save slots (VGA: 0x2a8 bytes each).
export function allocDoorSaves(m: Memory): void {
  m.set16(SLOT_SIZE, 0x2a8);
  const p = call(m, "0:efd5", (m.u16(SLOT_SIZE) << 2) & 0xffff, 0);
  m.set16(POOL + 2, p >>> 16);
  m.set16(POOL, p & 0xffff);
}

// 1485:02ed restoreRect(x, y, width, height, off, seg): put a saved rectangle back on screen.
export function restoreRect(m: Memory, x: number, y: number, w: number, h: number, off: number, seg: number): void {
  restoreBackground(m, x, y, w, h, off, seg);
}

// 1485:0354 saveRect(x, y, width, height, off, seg): copy a screen rectangle into a buffer; nonzero when off screen.
export function saveRect(m: Memory, x: number, y: number, w: number, h: number, off: number, seg: number): number {
  return saveBackground(m, x, y, w, h, off, seg);
}

// 1485:0008 swapDoorSave(door): restore what the door's slot holds, then save the area under the door's frame
// and set the door's dirty rectangles (+0x59, +0x41) to it.
export function swapDoorSave(m: Memory, door: number): void {
  const slot = m.s8(door + 0x87);
  const ptr = (SLOTS + slot * 4) & 0xffff;
  let off = m.u16(ptr);
  let seg = m.u16(ptr + 2);
  const old = off | seg ? [0, 0, 0, 0] : null;
  if (old) {
    const at = (o: number) => seg * 16 + (o & 0xffff);
    old[0] = m.bytes[at(off)] | (m.bytes[at(off + 1)] << 8);
    old[1] = m.bytes[at(off + 2)] | (m.bytes[at(off + 3)] << 8);
    old[2] = m.bytes[at(off + 4)];
    old[3] = m.bytes[at(off + 5)];
    restoreRect(m, old[0], old[1], old[2], old[3], off + 6, seg);
  }
  off = (m.u16(POOL) + slot * m.u16(SLOT_SIZE)) & 0xffff;
  seg = m.u16(POOL + 2);
  m.set16(ptr, off);
  m.set16(ptr + 2, seg);
  const frame = farBuffer(m, m.u16(door + 0x1d));
  m.set16(FRAME + 2, frame >>> 16);
  m.set16(FRAME, frame & 0xffff);
  const at = (o: number) => seg * 16 + (o & 0xffff);
  const x = m.u16(door + 0x71);
  const y = m.u16(door + 0x77);
  const fr = (frame >>> 16) * 16;
  const w = m.bytes[fr + ((frame + 2) & 0xffff)];
  const h = m.bytes[fr + ((frame + 3) & 0xffff)];
  m.bytes[at(off)] = x & 0xff;
  m.bytes[at(off + 1)] = x >> 8;
  m.bytes[at(off + 2)] = y & 0xff;
  m.bytes[at(off + 3)] = y >> 8;
  m.bytes[at(off + 4)] = w;
  m.bytes[at(off + 5)] = h;
  if (saveRect(m, x, y, w, h, off + 6, seg) & 0xffff) {
    m.set16(ptr + 2, 0);
    m.set16(ptr, 0);
  }
  if (!old) {
    m.set16(door + 0x59, x);
    m.set16(door + 0x5b, y);
    m.set16(door + 0x5d, w + x);
    m.set16(door + 0x5f, h + y);
  } else {
    // The dirty rectangle covers both the restored and the newly saved area (signed compares).
    const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
    const [ox, oy, ow, oh] = old;
    m.set16(door + 0x59, s16(x) <= s16(ox) ? x : ox);
    m.set16(door + 0x5b, s16(y) <= s16(oy) ? y : oy);
    m.set16(door + 0x5d, s16(ow + ox) < s16(w + x) ? w + x : ow + ox);
    m.set16(door + 0x5f, s16(oh + oy) < s16(h + y) ? h + y : oh + oy);
  }
  for (let i = 0; i < 8; i++) m.set8(door + 0x41 + i, m.u8(door + 0x59 + i));
}

register("0:6bd2", allocDoorSaves);
register("1485:02ed", restoreRect);
register("1485:0354", saveRect);
register("1485:0008", swapDoorSave);
