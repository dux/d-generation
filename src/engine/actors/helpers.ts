import { call, register } from "../dispatch.ts";
import { angle, distance, nextObjectOfClass } from "../geometry/math.ts";
import { boxesOverlap, drawPart, updateBox } from "../geometry/objects.ts";
import { cellAt, CURRENT_CELL, FRAME, FRAME_Y, worldToCell } from "../geometry/room.ts";
import type { Memory } from "../memory.ts";
import { farBuffer, memset, timerSet } from "../runtime.ts";

// Shared object helpers of segment 0 (0:3e23..0:5fff) used by the class code.

export const UPDATE_OBJECT = 0x34b0; // object being updated (class slot +0x0a)
export const DRAW_OBJECT = 0x3360; // object being drawn (slot +0x10)
export const POST_OBJECT = 0x546a; // object of the post-update (slot +0x0e)
export const MESSAGE_SELF = 0x546c; // receiver of a message (slot +0x0c)
export const MESSAGE_OTHER = 0x546e; // the object that sent it / collided
export const FRAME_TIME = 0x3408; // time step of this frame (0x100 = one tick)
export const ROOM = 0x337e;
const CURRENT_PART = 0x6128;
const SPEED_STEPS = 0x61e; // steps per speed for moveToward
const ROOM_EXITS = 0x626; // (dcol, drow) byte pairs per exit direction
const ROOM_GRID = 0x5f72; // 11-byte rows of room numbers, 0xff = none
const VISITED = 0x3414;
const EXIT_SIDES = 0x62e;
const FOREACH_COUNT = 0x612c;
const NUDGE_TURNS = 0x632; // facing offsets, negative-terminated
const NUDGE_STEPS = 0x639;
const SPAWN_OFFSETS = 0x660; // (dy, dx) byte pairs per direction
const SOUND_SPAWN = 0x1a4e;
const SOUND_STEP = 0x1c66;
export const DEAD_MARK = 0x18f3; // value written to obj+3 to remove an object
const PART_X = 0x6124; // screen x of the part being drawn (y at FRAME_Y)

export const s8 = (v: number) => (v << 24) >> 24;
export const s16 = (v: number) => (v << 16) >> 16;

// Stack frame like the original's (saved BP, then n bytes of locals); returns BP so uninitialised locals read
// the same stack bytes as the original when called from the recorded entry SP.
export function enter(m: Memory, n: number): number {
  m.push(2);
  return m.push(n) + n;
}

export function leave(m: Memory, n: number): void {
  m.pop(n);
  m.pop(2);
}

export function sound(m: Memory, id: number): void {
  call(m, "0:b5c3", id);
}

// 0:3e23 roomInList(list): 1 if the room number + 1 is in the negative-terminated byte list.
export function roomInList(m: Memory, list: number): number {
  const room = (m.u8(ROOM) + 1) & 0xff;
  for (let p = list; ; p++) {
    const e = m.s8(p);
    if (e < 0) return 0;
    if (e === room) return 1;
  }
}

// 0:3e5f moveCurrent(dx*, dy*, steps): move the updated object (0:29b3), then resolve collisions (0:3e95).
export function moveCurrent(m: Memory, px: number, py: number, steps: number): number {
  const n = s8(steps);
  if (!call(m, "0:29b3", m.u16(UPDATE_OBJECT), px, py, n & 0xffff)) return 0;
  return resolveMove(m, px, py, n & 0xffff);
}

// 0:3e95 resolveMove(dx*, dy*, steps): if the updated object now collides, back off one step at a time (up to
// steps times) until it is free. Returns (hit class << 8) | collision result.
export function resolveMove(m: Memory, px: number, py: number, steps: number): number {
  const bp = enter(m, 6);
  const hit = bp - 1;
  m.set8(hit, 0);
  let r = 0;
  const x = bp - 4;
  const y = bp - 6;
  m.set16(x, m.u16(px));
  m.set16(y, m.u16(py));
  let n = steps & 0xff;
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 3) === 0) {
    updateBox(m, obj);
    call(m, "0:bfd1", obj);
    r = call(m, "0:d424", obj, hit) & 0xff;
    if (r) {
      call(m, "0:2c34", obj);
      for (;;) {
        const t = n;
        n = (n - 1) & 0xff;
        if (t === 0) break;
        if (call(m, "0:29b3", obj, x, y, 1)) {
          updateBox(m, obj);
          if (call(m, "0:d87f", obj, m.s8(hit) & 0xffff)) {
            call(m, "0:2c34", obj);
            break;
          }
        }
      }
    }
    call(m, "0:d7e0", obj);
  }
  m.set16(px, m.u16(x));
  m.set16(py, m.u16(y));
  const result = ((m.u8(hit) << 8) | (s8(r) & 0xffff)) & 0xffff;
  leave(m, 6);
  return result;
}

// 0:3f81 drawObjectPart(obj, part): draw one active part (+0xcb) at its placed position, keeping its rect.
export function drawObjectPart(m: Memory, obj: number, part: number): void {
  const p = s8(part);
  if (m.u8(obj + 0xcb + p) === 0) return;
  const frame = farBuffer(m, m.u16(obj + 0x1d + 2 * p));
  m.set16(FRAME + 2, frame >>> 16);
  m.set16(FRAME, frame & 0xffff);
  m.set16(PART_X, m.u16(obj + 0x71 + 2 * p));
  m.set16(FRAME_Y, m.u16(obj + 0x77 + 2 * p));
  const base = (obj + 8 * p) & 0xffff;
  for (let i = 0; i < 8; i++) m.set8(base + 0x41 + i, m.u8(base + 0x59 + i));
  m.set16(CURRENT_PART, p & 0xffff);
  call(m, "0:b534", obj, p & 0xffff);
  drawPart(m, obj, p & 0xffff);
}

// 0:4027 chase(target, range, speed): moveToward with the direction toward the target.
export function chase(m: Memory, target: number, range: number, speed: number): number {
  return moveToward(m, target, range, 0xffff, s8(speed) & 0xffff);
}

// 0:4043 moveToward(target, range, dir, speed): step the updated object along dir (-1: toward the target, 0..63)
// when the target is within range; returns the direction used if it reached the target, else -1. The position
// is restored afterwards (only the probe matters) with the old one in +0x19/+0x1b.
export function moveToward(m: Memory, target: number, range: number, dir: number, speed: number): number {
  if (!inRange(m, target, range)) return 0xffff;
  let me = m.u16(UPDATE_OBJECT);
  const x = m.u16(me + 7);
  const y = m.u16(me + 9);
  let d = dir & 0xffff;
  if (d === 0xffff) d = angle(m, (m.u16(target + 7) - x) & 0xffff, (m.u16(target + 9) - y) & 0xffff) & 0xffff;
  const c = call(m, "0:b510", d) & 0xffff;
  const s = call(m, "0:b522", d) & 0xffff;
  const sp = s8(speed);
  const r = probeMove(m, (sp * s16(c)) & 0xffff, (sp * s16(s)) & 0xffff, m.s8(SPEED_STEPS + sp) & 0xffff, target);
  let result: number;
  if (r === 0 || r === 2) result = 0xffff;
  else if (r === 1) result = d;
  else {
    call(m, "0:2c34", m.u16(UPDATE_OBJECT));
    const r2 = probeMove(m, c, s, sp & 0xffff, target);
    result = r2 === 1 || r2 === 3 ? d : 0xffff;
  }
  me = m.u16(UPDATE_OBJECT);
  m.set16(me + 0x19, x);
  m.set16(me + 0x1b, y);
  call(m, "0:2c34", me);
  return result;
}

// 0:414b inRange(other, range): 1 if other is set and within range on both position high bytes.
export function inRange(m: Memory, other: number, range: number): number {
  if (other === 0) return 0;
  const me = m.u16(UPDATE_OBJECT);
  const r = s16(range);
  if (Math.abs(m.u8(me + 8) - m.u8(other + 8)) > r) return 0;
  if (Math.abs(m.u8(me + 0xa) - m.u8(other + 0xa)) > r) return 0;
  return 1;
}

// 0:41c6 probeMove(dx, dy, count, target): step the updated object up to count times; 3 blocked touching the
// target, 2 blocked, 1 touching the target, 0 free.
export function probeMove(m: Memory, dx: number, dy: number, count: number, target: number): number {
  const bp = enter(m, 2);
  let n = s16(count);
  let result = 0;
  for (;;) {
    const me = m.u16(UPDATE_OBJECT);
    m.set16(me + 0x19, m.u16(me + 7));
    m.set16(me + 0x1b, m.u16(me + 9));
    m.set16(me + 7, m.u16(me + 7) + dx);
    m.set16(me + 9, m.u16(me + 9) + dy);
    updateBox(m, me);
    if (call(m, "0:d470", m.u16(UPDATE_OBJECT), bp - 1)) {
      result = boxesOverlap(m, m.u16(UPDATE_OBJECT), target) ? 3 : 2;
      break;
    }
    if (boxesOverlap(m, m.u16(UPDATE_OBJECT), target)) {
      result = 1;
      break;
    }
    n = s16(n - 1);
    if (n <= 0) break;
  }
  leave(m, 2);
  return result;
}

// 0:4242 teleportTo(pos): move the message receiver to pos+5/+7 unless it collides there; 1 if moved.
export function teleportTo(m: Memory, pos: number): number {
  const bp = enter(m, 6);
  let me = m.u16(MESSAGE_SELF);
  const x = m.u16(me + 7);
  const y = m.u16(me + 9);
  m.set16(me + 7, m.u16(pos + 5));
  m.set16(me + 9, m.u16(pos + 7));
  updateBox(m, me);
  let result: number;
  if (call(m, "0:d424", m.u16(MESSAGE_SELF), bp - 5)) {
    me = m.u16(MESSAGE_SELF);
    m.set16(me + 7, x);
    m.set16(me + 9, y);
    updateBox(m, me);
    result = 0;
  } else {
    me = m.u16(MESSAGE_SELF);
    m.set8(me + 0x35, 0);
    updateBox(m, me);
    result = 1;
  }
  leave(m, 6);
  return result;
}

// 0:42bd spawnFrom(src, owner, dir, speed): remove src and spawn a class 1 object (record 0x81, src position)
// with its height, facing and speed. owner -1 sets +0x85, else +0xd1 = owner * 4. Returns the new object.
export function spawnFrom(m: Memory, src: number, owner: number, dir: number, speed: number): number {
  const bp = enter(m, 8);
  const rec = bp - 4;
  m.set8(rec, 0x81);
  m.set8(rec + 1, m.u8(src + 8));
  m.set8(rec + 2, m.u8(src + 0xa));
  let z = (m.u8(src + 0xc) - 8) & 0xff;
  if (z & 0x80) z = 0;
  m.set8(src + 3, m.u8(DEAD_MARK));
  m.set8(src + 0x18, 1);
  const obj = call(m, "0:2818", rec) & 0xffff;
  if (owner === 0xffff) m.set8(obj + 0x85, 1);
  else m.set8(obj + 0xd1, owner << 2);
  m.set8(obj + 0xc, z);
  m.set8(obj + 0x16, dir);
  m.set8(obj + 0x13, dir);
  m.set8(obj + 0x3b, speed);
  m.set8(obj + 0x86, m.u8(src + 2));
  sound(m, SOUND_SPAWN);
  leave(m, 8);
  return obj;
}

// 0:434f angleBetween(a, b): angle of a - b.
export function angleBetween(m: Memory, a: number, b: number): number {
  return angle(m, (m.u16(a + 7) - m.u16(b + 7)) & 0xffff, (m.u16(a + 9) - m.u16(b + 9)) & 0xffff);
}

// 0:4385 leaveRoom(obj, exit): switch to the room beyond exit (0:4407); 1 if there is one.
export function leaveRoom(m: Memory, obj: number, exit: number): number {
  const bp = enter(m, 8);
  const loc = bp - 8;
  m.set8(bp - 5, exit);
  call(m, "0:5fe8");
  call(m, "0:6017");
  if (m.u8(0x33ee) === 0) m.set8(0x340c, 0);
  let result = 0;
  if (nextRoom(m, loc)) {
    call(m, "0:1ea4");
    call(m, "0:185d");
    m.set8(0x3c0, 1);
    m.set8(VISITED + m.u8(ROOM), 1);
    m.set16(0x337c, m.u16(loc));
    m.set16(0x337e, m.u16(loc + 2));
    m.set16(0x3380, m.u16(loc + 4));
    setEntry(m, obj, exit);
    m.set16(0x33f2, 1);
    result = 1;
    m.set8(0x3368, 0);
  }
  leave(m, 8);
  return result;
}

// 0:4407 nextRoom(loc): loc = (col, row, room) of the room beyond exit loc[3]; room 0x71 always leads to 0x79.
export function nextRoom(m: Memory, loc: number): number {
  const bp = enter(m, 6);
  let result = 0;
  if (m.u8(ROOM) === 0x71) {
    call(m, "0:bd8c", 0x79, bp - 4, bp - 6);
    m.set8(loc, m.u8(bp - 4));
    m.set8(loc + 1, m.u8(bp - 6));
    m.set8(loc + 2, 0x79);
    m.set8(0x3c3, 1);
    m.set8(0x3c4, 1);
    result = 1;
  } else {
    const d = m.s8(loc + 3);
    m.set8(loc + 1, m.u8(ROOM_EXITS + 1 + 2 * d) + m.u8(0x337d));
    m.set8(loc, m.u8(ROOM_EXITS + 2 * d) + m.u8(0x337c));
    const row = m.s8(loc + 1);
    const col = m.s8(loc);
    if (row >= 0 && row < 0xb && col >= 0 && col < 0x27) {
      const v = m.u8(ROOM_GRID + col * 11 + row);
      m.set8(loc + 2, v);
      if (v !== 0xff) result = 1;
    }
  }
  leave(m, 6);
  return result;
}

// 0:44ca setEntry(obj, exit): DS:3381 = entry side for exit, DS:3380 = the object's facing.
export function setEntry(m: Memory, obj: number, exit: number): void {
  m.set8(0x3381, m.u8(EXIT_SIDES + (exit & 0xffff)));
  m.set8(0x3380, m.u8(obj + 0x16));
}

// 0:44e4 setTargetPos(src): message receiver +0xd/+0xf = src+9/+0xb.
export function setTargetPos(m: Memory, src: number): void {
  const me = m.u16(MESSAGE_SELF);
  m.set16(me + 0xd, m.u16(src + 9));
  m.set16(me + 0xf, m.u16(src + 0xb));
}

// 0:4505 setCellWalls(obj, bits): set the wall bits of the grid edge the object (a door/bar) stands on.
export function setCellWalls(m: Memory, obj: number, bits: number): void {
  const bp = enter(m, 6);
  const pair = bp - 2;
  const x8 = m.u8(obj + 8);
  m.set8(bp - 5, x8);
  worldToCell(m, x8, m.u8(obj + 0xa), pair);
  const rem = (x8 - 1) % 14;
  const row = m.s8(pair);
  const col = m.s8(pair + 1);
  const b = bits & 0xff;
  if (m.u8(obj + 0x16) === 1) {
    if (rem) setCellBits(m, col, row, 0x22, b);
    else {
      setCellBits(m, col + 1, row, 0x20, b);
      setCellBits(m, col, row + 1, 2, b);
    }
  } else if (rem) setCellBits(m, col, row, 0x88, b);
  else {
    setCellBits(m, col, row, 8, b);
    setCellBits(m, col + 1, row + 1, 0x80, b);
  }
  leave(m, 6);
}

// 0:45f7 setCellBits(col, row, mask, bits): cell byte 0 = (byte & ~mask) | (bits & mask).
export function setCellBits(m: Memory, col: number, row: number, mask: number, bits: number): void {
  const bp = enter(m, 0x1a);
  const cursor = bp - 0x1a;
  m.set8(bp - 0xa, col);
  m.set8(bp - 9, row);
  cellAt(m, cursor);
  const cell = m.u16(CURRENT_CELL);
  const k = mask & 0xff;
  m.set8(cell, (~k & m.u8(cell)) | (k & bits & 0xff));
  leave(m, 0x1a);
}

// 0:4642 writeRecord(obj, rec): room record of the object: class (bit 4 -> bit 7) | facing << 4, x, y.
export function writeRecord(m: Memory, obj: number, rec: number): void {
  const t = m.s8(obj + 2);
  m.set8(rec, (t & 0xf) | ((t & 0x10) << 3) | (m.s8(obj + 0x13) << 4));
  m.set8(rec + 1, m.u8(obj + 8));
  m.set8(rec + 2, m.u8(obj + 0xa));
}

// 0:4693 writeRecordFine(obj, rec): record with the position fractions (rounded by +8) packed into byte 0 bits
// 4-6 and byte 3 (x bit 7 -> bit 3, y high nibble).
export function writeRecordFine(m: Memory, obj: number, rec: number): void {
  m.set16(obj + 7, m.u16(obj + 7) + 8);
  m.set16(obj + 9, m.u16(obj + 9) + 8);
  const t = m.s8(obj + 2);
  const fx = m.u8(obj + 7);
  m.set8(rec, (t & 0xf) | ((t & 0x10) << 3) | (fx & 0x70));
  m.set8(rec + 3, (m.u8(obj + 9) & 0xf0) | ((fx >> 4) & 8) | m.s8(rec + 3));
  m.set8(rec + 1, m.u8(obj + 8));
  m.set8(rec + 2, m.u8(obj + 0xa));
}

// 0:471d readRecordFine(obj, rec): inverse of writeRecordFine for the fractions.
export function readRecordFine(m: Memory, obj: number, rec: number): void {
  m.set8(obj + 7, ((m.s8(rec + 3) & 8) << 4) | (m.s8(rec) & 0x70));
  m.set8(obj + 9, m.s8(rec + 3) & 0xf0);
}

// 0:4757 setSpeed(obj, v): +0x3b = v, scaled by 180/128 on diagonal facings.
export function setSpeed(m: Memory, obj: number, v: number): void {
  if (m.s8(obj + 0x16) & 1) m.set8(obj + 0x3b, Math.floor((s16(v) * 0xb4) / 128));
  else m.set8(obj + 0x3b, v);
}

// 0:478e objectDistance(a, b): twice the distance of the halved high-byte deltas.
export function objectDistance(m: Memory, a: number, b: number): number {
  const dx = Math.abs(m.u8(a + 8) - m.u8(b + 8)) >> 1;
  const dy = Math.abs(m.u8(a + 0xa) - m.u8(b + 0xa)) >> 1;
  return (distance(m, dx, dy) << 1) & 0xffff;
}

// 0:47e7 countDown(timer*): subtract the frame time; 1 when it reaches zero (then cleared), 0 otherwise.
export function countDown(m: Memory, p: number): number {
  const v = m.u16(p);
  if (v === 0) return 0;
  const n = s16(v - m.u16(FRAME_TIME));
  if (n <= 0) {
    m.set16(p, 0);
    return 1;
  }
  m.set16(p, n);
  return 0;
}

// 0:481a startGame(room): clear the visited and object state tables and enter room (1-based).
export function startGame(m: Memory, room: number): void {
  memset(m, VISITED, 0, 0x96);
  memset(m, 0x5484, 0, 0x960);
  m.set8(0x1968, 0);
  enterRoom(m, (room + 1) & 0xffff);
  m.set8(0x3362, m.u8(0x3362) + 1);
  const old = m.u8(0x3364);
  m.set8(0x3364, old + 1);
  if (old === 0x59) m.set8(0x3362, 1);
  m.set8(0x3367, 0);
  startLifts(m);
}

// 0:486f enterRoom(n): load room n - 1 (grid position from 0:bd8c) and build it.
export function enterRoom(m: Memory, n: number): void {
  const bp = enter(m, 4);
  const room = (n - 1) & 0xffff;
  call(m, "0:bd8c", room, bp - 2, bp - 4);
  m.set8(ROOM, room);
  m.set8(0x337c, m.u8(bp - 2));
  m.set8(0x337d, m.u8(bp - 4));
  m.set8(0x3c0, 1);
  call(m, "0:b7d4");
  call(m, "0:0b79");
  call(m, "0:354e", m.u8(ROOM));
  m.set8(0x420, 1);
  call(m, "0:2107", 1);
  m.set8(0x420, 0);
  timerSet(m, m.s8(0x33f4), 0);
  m.set8(0x33ee, 0);
  leave(m, 4);
}

// 0:48da startLifts(): send message 5 to the first lift (class 18).
export function startLifts(m: Memory): void {
  const bp = enter(m, 0x10);
  m.set8(bp - 0xf, 0);
  m.set16(bp - 0xc, nextObjectOfClass(m, 0x12, bp - 0xf));
  call(m, "0:2c71", 5, bp - 0xe);
  leave(m, 0x10);
}

// 0:4909 countHostiles(): number of objects of classes 6, 15, 22 and 26.
export function countHostiles(m: Memory): number {
  m.set8(FOREACH_COUNT, 0);
  call(m, "0:1811", 0x491b);
  return m.s8(FOREACH_COUNT) & 0xffff;
}

// 0:491b countHostile(obj): for-each callback of countHostiles.
export function countHostile(m: Memory, obj: number): number {
  const c = m.u8(obj + 2);
  if (c === 6 || c === 0xf || c === 0x16 || c === 0x1a) m.set8(FOREACH_COUNT, m.u8(FOREACH_COUNT) + 1);
  return 0;
}

// 0:4945 angleToFacing(a): 0..63 angle to an even facing (non-multiples of 8 round to the nearest even one).
export function angleToFacing(_m: Memory, a: number): number {
  const v = s8(a);
  return (v & 7 ? ((v + 8) >> 3) & 6 : v >> 3) & 0xffff;
}

// 0:4979 nudge(obj): try backing the object out of a collision along the DS:632 turn list; 1 if it freed it
// (position fractions reset to the cell centre, facing reversed).
export function nudge(m: Memory, obj: number): number {
  const bp = enter(m, 0x12);
  const time = m.u16(FRAME_TIME);
  const x = m.u16(obj + 7);
  const y = m.u16(obj + 9);
  const dir = m.u8(obj + 0x13);
  const speed = m.u8(obj + 0x3b);
  m.set16(FRAME_TIME, 0x100);
  m.set8(obj + 0x3a, 0xff);
  m.set8(obj + 0x3b, 0xb5);
  m.set8(obj + 0x13, m.u8(obj + 0x13) ^ 4);
  let result = 0;
  for (let i = 0; ; i++) {
    const turn = m.s8(NUDGE_TURNS + i);
    if (turn < 0) {
      m.set16(obj + 7, x);
      m.set16(obj + 9, y);
      m.set8(obj + 0x13, dir);
      updateBox(m, obj);
      break;
    }
    m.set8(obj + 0x13, (m.s8(obj + 0x13) + turn) & 7);
    call(m, "0:29b3", obj, bp - 0xa, bp - 0xc, m.s8(NUDGE_STEPS + i) & 0xffff);
    updateBox(m, obj);
    if (!call(m, "0:d424", obj, bp - 0x11)) {
      m.set8(obj + 7, 0x80);
      m.set8(obj + 9, 0x80);
      m.set8(obj + 0x13, dir ^ 4);
      result = 1;
      break;
    }
  }
  m.set8(obj + 0x3b, speed);
  m.set16(FRAME_TIME, time);
  leave(m, 0x12);
  return result;
}

// 0:54f3 animateWalk(obj, dx, dy): advance the walk cycle (+6) by the distance moved (+0x83 accumulator).
export function animateWalk(m: Memory, obj: number, dx: number, dy: number): void {
  const d = m.s8(obj + 0x16);
  let s = Math.abs(s16(m.u8(0x679 + d) ? dx : dy));
  if (s > 0x190) s = 0x190;
  m.set16(obj + 0x83, m.u16(obj + 0x83) + s);
  const cls = m.u8(obj + 2);
  const step = cls === 0x16 || cls === 0x1a ? m.s16(0x691 + 2 * d) : m.s16(0x681 + 2 * d);
  let f = m.s8(obj + 6);
  while (m.s16(obj + 0x83) > step) {
    m.set16(obj + 0x83, m.u16(obj + 0x83) - step);
    f = s16(f + 1);
    if (m.s8(0x671 + d) < f) f = 1;
    if (m.s8(0x6a1 + d) === f || m.s8(0x6a9 + d) === f) sound(m, SOUND_STEP);
  }
  m.set8(obj + 6, f);
}

// 0:59cd spawnAhead(dir, low): spawn class dir? record (dir << 4 | low) next to the updated object along dir.
export function spawnAhead(m: Memory, dir: number, low: number): number {
  const bp = enter(m, 4);
  const rec = bp - 4;
  const d = s8(dir);
  m.set8(rec, (d << 4) | s8(low));
  m.set8(bp - 1, dir);
  const me = m.u16(UPDATE_OBJECT);
  m.set8(rec + 1, m.s8(SPAWN_OFFSETS + 1 + 2 * d) + m.u8(me + 8));
  m.set8(rec + 2, m.s8(SPAWN_OFFSETS + 2 * d) + m.u8(me + 0xa));
  const obj = call(m, "0:2818", rec) & 0xffff;
  leave(m, 4);
  return obj;
}

// 0:5bd0 classInList(cls, list): 1 if the class byte is in the negative-terminated list.
export function classInList(m: Memory, cls: number, list: number): number {
  const c = cls & 0xff;
  for (let p = list; ; p++) {
    const e = m.s8(p);
    if (e < 0) return 0;
    if (e === c) return 1;
  }
}

// 0:5fa8 alertSurveillance(v): DS:6143 = v and message 5 from the receiver to every class 9 object.
export function alertSurveillance(m: Memory, v: number): void {
  m.set8(0x6143, v);
  call(m, "0:1811", 0x5fbd);
}

// 0:5fbd alertOne(obj): for-each callback of alertSurveillance.
export function alertOne(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 9) {
    m.set16(0x6136, m.u16(MESSAGE_SELF));
    m.set16(0x6138, obj);
    call(m, "0:2c71", 5, 0x6136);
  }
  return 0;
}

// 0:5fe8 removeDeadSurveillance(): remove class 9 objects in state 9, counting them in DS:3362/3363.
export function removeDeadSurveillance(m: Memory): void {
  call(m, "0:1811", 0x5ff1);
}

// 0:5ff1 removeIfDead(obj): for-each callback of removeDeadSurveillance.
export function removeIfDead(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 9 && m.u8(obj + 0x17) === 9) {
    m.set8(0x3362, m.u8(0x3362) + 1);
    m.set8(0x3363, m.u8(0x3363) + 1);
    call(m, "0:2656", obj);
  }
  return 0;
}

register("0:3e23", roomInList);
register("0:3e5f", moveCurrent);
register("0:3e95", resolveMove);
register("0:3f81", drawObjectPart);
register("0:4027", chase);
register("0:4043", moveToward);
register("0:414b", inRange);
register("0:41c6", probeMove);
register("0:4242", teleportTo);
register("0:42bd", spawnFrom);
register("0:434f", angleBetween);
register("0:4385", leaveRoom);
register("0:4407", nextRoom);
register("0:44ca", setEntry);
register("0:44e4", setTargetPos);
register("0:4505", setCellWalls);
register("0:45f7", setCellBits);
register("0:4642", writeRecord);
register("0:4693", writeRecordFine);
register("0:471d", readRecordFine);
register("0:4757", setSpeed);
register("0:478e", objectDistance);
register("0:47e7", countDown);
register("0:481a", startGame);
register("0:486f", enterRoom);
register("0:48da", startLifts);
register("0:4909", countHostiles);
register("0:491b", countHostile);
register("0:4945", angleToFacing);
register("0:4979", nudge);
register("0:54f3", animateWalk);
register("0:59cd", spawnAhead);
register("0:5bd0", classInList);
register("0:5fa8", alertSurveillance);
register("0:5fbd", alertOne);
register("0:5fe8", removeDeadSurveillance);
register("0:5ff1", removeIfDead);
