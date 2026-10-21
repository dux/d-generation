import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { OBJECT_COUNT, OBJECTS } from "./objects.ts";

// Draw ordering: objects that must be drawn in front go to DS:30ca (count DS:3322).
const FRONT = 0x30ca;
const FRONT_COUNT = 0x3322;

function pushFront(m: Memory, obj: number): void {
  const n = m.u16(FRONT_COUNT);
  m.set16(FRONT_COUNT, n + 1);
  m.set16(FRONT + ((n << 1) & 0xffff), obj);
}

// 0:2d8d orderObjects(): sorts the live objects (1485:03bb), moves forced ones and everything overlapping
// them to the front list, then clears DS:1996.
export function orderObjects(m: Memory): void {
  const list = m.push(0x40);
  let n = 0;
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const obj = m.u16(OBJECTS + i * 2);
    if (obj) m.set16(list + n++ * 2, obj);
  }
  n = call(m, "1485:03bb", list, n);
  n = splitForced(m, list, n);
  splitOverlapping(m, list, n);
  m.set8(0x1996, 0);
  m.pop(0x40);
}

// 0:2dfd splitForced(list, n): moves objects with DS:1996, +0xd6 or +3 set to the front list; returns what is left.
export function splitForced(m: Memory, list: number, n: number): number {
  let k = 0;
  for (let i = 0; i < (n << 16) >> 16; i++) {
    const obj = m.u16(list + i * 2);
    if (m.u8(0x1996) || m.u8(obj + 0xd6) || m.u8(obj + 3)) pushFront(m, obj);
    else m.set16(list + k++ * 2, obj);
  }
  return k;
}

// 0:2e66 splitOverlapping(list, n): repeatedly moves objects overlapping a front object to the front list.
export function splitOverlapping(m: Memory, list: number, n: number): number {
  let done = 0;
  let end = m.u16(FRONT_COUNT);
  let left = (n << 16) >> 16;
  while (done !== end) {
    for (let i = done; ((i << 16) >> 16) < ((end << 16) >> 16); i++) {
      const front = m.u16(FRONT + i * 2);
      let k = 0;
      for (let j = 0; j < left; j++) {
        const obj = m.u16(list + j * 2);
        if (overlaps(m, front, obj)) pushFront(m, obj);
        else m.set16(list + k++ * 2, obj);
      }
      left = k;
    }
    done = end;
    end = m.u16(FRONT_COUNT);
  }
  return left & 0xffff;
}

function within(a0: number, a1: number, b0: number, b1: number): boolean {
  return (a0 <= b0 && b0 <= a1) || (b0 <= a0 && a0 <= b1);
}

function boxesTouch(m: Memory, a: number, b: number): boolean {
  return (
    within(m.u16(a), m.u16(a + 4), m.u16(b), m.u16(b + 4)) &&
    within(m.u16(a + 2), m.u16(a + 6), m.u16(b + 2), m.u16(b + 6))
  );
}

// 0:2f11 overlaps(a, b): 1 if any active part box of a (+0x41 or +0x59) touches an active part box of b (+0x41);
// open doors (class 2, +0x86) never do.
export function overlaps(m: Memory, a: number, b: number): number {
  if (m.u8(b + 2) === 2 && m.u8(b + 0x86)) return 0;
  for (let i = 0; i < 3; i++) {
    if (!m.u8(a + 0xcb + i) && !m.u8(a + 0xce + i)) continue;
    for (let j = 0; j < 3; j++) {
      if (!m.u8(b + 0xcb + j) && !m.u8(b + 0xce + j)) continue;
      const bb = b + 0x41 + j * 8;
      if (boxesTouch(m, a + 0x41 + i * 8, bb) || boxesTouch(m, a + 0x59 + i * 8, bb)) return 1;
    }
  }
  return 0;
}

register("0:2d8d", orderObjects);
register("0:2dfd", splitForced);
register("0:2e66", splitOverlapping);
register("0:2f11", overlaps);
