import { call, callNear, register } from "../dispatch.ts";
import { assignPath, updateBox } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { random } from "../random.ts";
import { memset } from "../runtime.ts";

// Object table: 30 slots of 0xdd bytes at DS:3a80 (word +0 = id, -1 when free), live object pointers at DS:33ac.
export const OBJECT_SLOTS = 0x3a80;
export const OBJECT_SIZE = 0xdd;
export const OBJECTS = 0x33ac;
export const OBJECT_COUNT = 30;
export const CLASSES = 0x191d; // class descriptor pointers (27)
const NEXT_ID = 0x33a2;
const SENDER = 0x546e; // message sender while a handler runs
const TARGET = 0x546c; // message target while a handler runs
const CURRENT = 0x546a; // object whose post-update runs

const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;

export function classDescriptor(m: Memory, obj: number): number {
  return m.u16(CLASSES + s8(m.u8(obj + 2)) * 2);
}

// Builds a 4-byte creation record on the stack and creates the object.
function createFrom(m: Memory, b0: number, b1: number, b2: number, b3: number): number {
  const rec = m.push(4);
  m.set8(rec, b0);
  m.set8(rec + 1, b1);
  m.set8(rec + 2, b2);
  m.set8(rec + 3, b3);
  const obj = createObject(m, rec);
  m.pop(4);
  return obj;
}

// 0:24de spawn24de(): creates class 7 object (record 87 36 2e 00).
export function spawn24de(m: Memory): number {
  return createFrom(m, 0x87, 0x36, 0x2e, 0);
}

// 0:2500 spawn2500(): creates four class 3 objects (record 83 78 78 i<<4).
export function spawn2500(m: Memory): void {
  for (let i = 0; i < 4; i++) createFrom(m, 0x83, 0x78, 0x78, i << 4);
}

// 0:2539 spawn2539(n): creates class 0x1a object (record da 6c 98 n<<6|0x80).
export function spawn2539(m: Memory, n: number): number {
  return createFrom(m, 0xda, 0x6c, 0x98, (n << 6) | 0x80);
}

// 0:2565 spawn2565(): creates class 9 object (record 89 7e 84 00).
export function spawn2565(m: Memory): number {
  return createFrom(m, 0x89, 0x7e, 0x84, 0);
}

// 0:262c collect262c(obj): for-each callback of 0:25f1, gathers class 7 objects with +0x84 == 7 into DS:3928.
export function collect262c(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 7 && m.u8(obj + 0x84) === 7) {
    const n = m.u16(0x3926);
    m.set16(0x3926, n + 1);
    m.set16(0x3928 + ((n << 1) & 0xffff), obj);
  }
  return 0;
}

// 0:25f1 pickRandom25f1(): sets +0x87 on a random class 7 object with +0x84 == 7.
export function pickRandom25f1(m: Memory): void {
  m.set16(0x3926, 0);
  call(m, "0:1811", 0x262c);
  const n = m.u16(0x3926);
  if (!n) return;
  const obj = m.u16(0x3928 + ((random(m, n) << 1) & 0xffff));
  m.set8(obj + 0x87, 1);
}

// 0:2656 destroyObject(obj): unlinks the object and frees its slot.
export function destroyObject(m: Memory, obj: number): void {
  unlinkObject(m, obj);
  m.set16(obj, 0xffff);
  m.set8(obj + 3, 0);
}

// 0:266f tickDying(): counts down +3 of dying objects and destroys them when it reaches 0.
export function tickDying(m: Memory): void {
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const obj = m.u16(OBJECTS + i * 2);
    if (!obj || !m.u8(obj + 3)) continue;
    const left = (m.u8(obj + 3) - 1) & 0xff;
    m.set8(obj + 3, left);
    if (!left) destroyObject(m, obj);
  }
}

// 0:26ad unlinkObject(obj): clears the last DS:33ac entry pointing at obj.
export function unlinkObject(m: Memory, obj: number): void {
  for (let i = OBJECT_COUNT - 1; i >= 0; i--) {
    if (m.u16(OBJECTS + i * 2) === (obj & 0xffff)) {
      m.set16(OBJECTS + i * 2, 0);
      return;
    }
  }
}

// 0:26d3 resetWorld(): clears game state globals and the object table.
export function resetWorld(m: Memory): void {
  m.set16(0x3950, 0);
  m.set16(0x3952, 0);
  m.set16(0x3954, 0);
  for (const a of [0x397e, 0x397f, 0x3980]) m.set8(a, 0);
  m.set16(0x3410, 0);
  m.set16(0x3982, 0);
  for (const a of [0x3984, 0x3985, 0x3986, 0x3987, 0x3988, 0x3989, 0x398a, 0x1996, 0x398b]) m.set8(a, 0);
  m.set16(NEXT_ID, 1);
  m.set16(0x398c, 0x398e);
  m.set16(0x3a7e, 0xb5);
  clearObjects(m);
  m.set16(0x18f4, 0);
}

// 0:272c clearObjects(): frees every slot and live pointer.
export function clearObjects(m: Memory): void {
  for (let i = 0; i < OBJECT_COUNT; i++) {
    m.set16(OBJECT_SLOTS + i * OBJECT_SIZE, 0xffff);
    m.set16(OBJECTS + i * 2, 0);
  }
  m.set16(0x5466, 0);
  m.set16(0x5468, 0);
  m.set16(0x3400, 0);
}

// 0:2770 spawnPlayer(): fills the player record at DS:496 from the entry point (DS:3368..336a, or the
// current start position DS:3380/3381 and the table at DS:33a4) and creates the player.
export function spawnPlayer(m: Memory): number {
  if (m.u8(0x3368)) {
    m.set8(0x497, m.u8(0x3368));
    m.set8(0x498, m.u8(0x3369));
    m.set8(0x496, s8(m.u8(0x336a)) << 4);
  } else {
    m.set8(0x336a, m.u8(0x3380));
    m.set8(0x496, s8(m.u8(0x3380)) << 4);
    if (!m.u8(0x33a4 + s8(m.u8(0x3381)) * 2)) {
      let i = 0;
      for (; i < 4; i++) {
        if (m.u8(0x33a4 + i * 2)) {
          m.set8(0x3381, i);
          break;
        }
      }
      if (i === 4) call(m, "0:02f8", 0xf, 0);
    }
    const e = 0x33a4 + s8(m.u8(0x3381)) * 2;
    m.set8(0x3368, m.u8(e));
    m.set8(0x497, m.u8(e));
    m.set8(0x3369, m.u8(e + 1));
    m.set8(0x498, m.u8(e + 1));
  }
  return createObject(m, 0x496);
}

// 0:2818 createObject(record): record byte 0 = class (bits 0-3, bit 7 -> +16) and direction (bits 4-6),
// bytes 1/2 = x/y cell; allocates, fills and initialises the object (class slot +0x12). Returns it, or 0.
export function createObject(m: Memory, record: number): number {
  const b = s8(m.u8(record));
  const cls = (b & 0xf) | ((b & 0x80) >> 3);
  if (cls >= 0x1b) return 0;
  const desc = m.u16(CLASSES + cls * 2);
  const out = m.push(2);
  const failed = allocObject(m, desc, out);
  const obj = m.u16(out);
  m.pop(2);
  if (failed) return 0;
  assignPath(m, obj);
  const id = m.u16(NEXT_ID);
  m.set16(obj, id);
  m.set16(NEXT_ID, id + 1);
  m.set8(obj + 0x17, 0xff);
  const dir = (b & 0x70) >> 4;
  m.set8(obj + 0x16, dir);
  m.set8(obj + 0x13, dir);
  m.set8(obj + 0x3a, 0xff);
  m.set8(obj + 0x1a, m.u8(record + 1));
  m.set8(obj + 8, m.u8(record + 1));
  m.set8(obj + 0x1c, m.u8(record + 2));
  m.set8(obj + 0xa, m.u8(record + 2));
  m.set8(obj + 9, 0);
  m.set8(obj + 7, 0);
  m.set8(obj + 0x82, m.u8(desc + 9));
  m.set8(obj + 0xcb, 1);
  m.set8(obj + 0xd0, 0);
  m.set8(obj + 0xcf, 0);
  m.set8(obj + 0xce, 0);
  callNear(m, m.u16(classDescriptor(m, obj) + 0x12), record, obj);
  updateBox(m, obj);
  return obj;
}

// 0:290b allocObject(descriptor, outPtr): takes the first free live pointer and slot, zeroes the slot and
// copies the descriptor header. Returns 0, or 1 when the table is full.
export function allocObject(m: Memory, desc: number, out: number): number {
  let i = 0;
  while (i < OBJECT_COUNT && m.u16(OBJECTS + i * 2)) i++;
  if (i >= OBJECT_COUNT) return 1;
  let j = 0;
  while (j < OBJECT_COUNT && m.u16(OBJECT_SLOTS + j * OBJECT_SIZE) !== 0xffff) j++;
  const obj = (OBJECT_SLOTS + j * OBJECT_SIZE) & 0xffff;
  m.set16(OBJECTS + i * 2, obj);
  m.set16(out, obj);
  memset(m, obj, 0, OBJECT_SIZE);
  initFromDescriptor(m, obj, desc);
  return 0;
}

// 0:2989 initFromDescriptor(obj, descriptor): class id (+2), shape pointer (+4) and +0x15 from the descriptor.
export function initFromDescriptor(m: Memory, obj: number, desc: number): void {
  m.set8(obj + 2, m.u8(desc));
  m.set16(obj + 4, m.u16(desc + 3));
  m.set8(obj + 0x15, m.u8(desc + 5));
}

// 0:29b3 moveForward(obj, dxPtr, dyPtr, speed): velocity for speed then step; returns 1 if the object moved.
export function moveForward(m: Memory, obj: number, dx: number, dy: number, speed: number): number {
  if (m.u8(obj + 0x37) || m.u8(obj + 3)) {
    m.set16(dy, 0);
    m.set16(dx, 0);
    return 0;
  }
  velocity(m, obj, s8(speed) & 0xffff, dx, dy);
  return step(m, obj, dx, dy);
}

// 0:2a0b step(obj, dxPtr, dyPtr): saves the position (+0x19/+0x1b) and adds the velocity; sets +0x35 and returns
// 1 if it changed, else zeroes the velocity.
export function step(m: Memory, obj: number, dx: number, dy: number): number {
  if (m.u8(obj + 0x37) || m.u8(obj + 3)) {
    m.set16(dy, 0);
    m.set16(dx, 0);
    return 0;
  }
  m.set16(obj + 0x19, m.u16(obj + 7));
  m.set16(obj + 7, m.u16(obj + 7) + m.u16(dx));
  m.set16(obj + 0x1b, m.u16(obj + 9));
  m.set16(obj + 9, m.u16(obj + 9) + m.u16(dy));
  if (m.u16(obj + 7) !== m.u16(obj + 0x19) || m.u16(obj + 9) !== m.u16(obj + 0x1b)) {
    m.set8(obj + 0x35, 1);
    return 1;
  }
  m.set16(dy, 0);
  m.set16(dx, 0);
  return 0;
}

// 0:2a8e velocity(obj, speed, dxPtr, dyPtr): speed * DS:3408 * +0x3b (8.8 fixed); along the angle +0x3a when set,
// else along the 8-way direction +0x13 (diagonals scaled by 0xb5/256, signs from DS:1956/195e).
export function velocity(m: Memory, obj: number, speed: number, dx: number, dy: number): void {
  const a = Math.imul(s8(speed), s16(m.u16(0x3408))) & 0xffff;
  let p = Math.imul(s16(a), m.u8(obj + 0x3b));
  const mid = (v: number) => s16(v >> 8);
  const ang = m.u8(obj + 0x3a);
  if (ang !== 0xff) {
    const w = mid(p);
    m.set16(dx, Math.imul(s16(call(m, "0:b510", s8(ang) & 0xffff)), w) >> 8);
    m.set16(dy, Math.imul(s16(call(m, "0:b522", s8(ang) & 0xffff)), w) >> 8);
    return;
  }
  const dir = s8(m.u8(obj + 0x13));
  if (dir & 1) p = Math.imul(mid(p), 0xb5);
  const v = Math.abs(mid(p)) & 0xffff;
  const sx = s8(m.u8(0x1956 + dir));
  m.set16(dx, sx ? (sx > 0 ? v : -v) : 0);
  const sy = s8(m.u8(0x195e + dir));
  m.set16(dy, sy ? (sy > 0 ? v : -v) : 0);
}

// 0:2b75 postUpdateAll(): runs the class post-update (slot +0x0e) of every live object, current one in DS:546a.
export function postUpdateAll(m: Memory): void {
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const obj = m.u16(OBJECTS + i * 2);
    if (!obj || m.u8(obj + 3)) continue;
    m.set16(CURRENT, obj);
    callNear(m, m.u16(classDescriptor(m, obj) + 0xe));
  }
}

// 0:2bb9 fn_0_2bb9(): 0:12d8 then decrements DS:397e.
export function fn_0_2bb9(m: Memory): void {
  call(m, "0:12d8");
  m.set8(0x397e, m.u8(0x397e) - 1);
}

// 0:2bc1 collectDoors(): lists live class 2 objects with +0x86 and +0x88 set in DS:3324 (zero-padded to 30),
// then 0:1429.
export function collectDoors(m: Memory): void {
  let n = 0;
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const obj = m.u16(OBJECTS + i * 2);
    if (obj && !m.u8(obj + 3) && m.u8(obj + 2) === 2 && m.u8(obj + 0x86) && m.u8(obj + 0x88)) {
      m.set16(0x3324 + n++ * 2, obj);
    }
  }
  while (n < OBJECT_COUNT) m.set16(0x3324 + n++ * 2, 0);
  call(m, "0:1429");
}

// 0:2c34 undoMove(obj): restores the saved position; refreshes the box if the cell changed.
export function undoMove(m: Memory, obj: number): void {
  const moved = m.u8(obj + 8) !== m.u8(obj + 0x1a) || m.u8(obj + 0xa) !== m.u8(obj + 0x1c);
  m.set16(obj + 7, m.u16(obj + 0x19));
  m.set16(obj + 9, m.u16(obj + 0x1b));
  if (moved) updateBox(m, obj);
}

// 0:2c71 sendMessage(msg, pair): pair = {sender, target}; calls the target's message handler (slot +0x0c) with
// DS:546e/546c set to sender/target. Returns the handler's result, 0 while messages are blocked (DS:337a).
export function sendMessage(m: Memory, msg: number, pair: number): number {
  if (m.u8(0x337a)) return 0;
  const target = m.u16(TARGET);
  const sender = m.u16(SENDER);
  m.set16(SENDER, m.u16(pair));
  m.set16(TARGET, m.u16(pair + 2));
  const r = callNear(m, m.u16(classDescriptor(m, m.u16(TARGET)) + 0xc), s8(msg) & 0xffff, pair);
  m.set16(TARGET, target);
  m.set16(SENDER, sender);
  return r;
}

// 0:2ccf roomState(room): the 0x78-byte state record of a room at DS:5484 (ids at DS:5470, count DS:1968),
// appended if absent.
export function roomState(m: Memory, room: number): number {
  let i = 0;
  for (; i < s8(m.u8(0x1968)); i = s8(i + 1)) {
    if (m.u8(0x5470 + i) === (room & 0xff)) return (0x5484 + i * 0x78) & 0xffff;
  }
  const n = m.u8(0x1968);
  m.set8(0x1968, n + 1);
  if (s8(n) > 0x14) call(m, "0:f27d", 0x49a);
  m.set8(0x5470 + i, room);
  return (0x5484 + i * 0x78) & 0xffff;
}

// 0:3056 loadRoomObjects(): creates the room's objects from its saved state if visited, else from DS:3502.
export function loadRoomObjects(m: Memory): void {
  const room = m.u8(0x337e);
  if (m.u8(0x3414 + room)) call(m, "0:1656", roomState(m, room), 0);
  else call(m, "0:1656", 0x3502, 0);
}

register("0:24de", spawn24de);
register("0:2500", spawn2500);
register("0:2539", spawn2539);
register("0:2565", spawn2565);
register("0:25f1", pickRandom25f1);
register("0:262c", collect262c);
register("0:2656", destroyObject);
register("0:266f", tickDying);
register("0:26ad", unlinkObject);
register("0:26d3", resetWorld);
register("0:272c", clearObjects);
register("0:2770", spawnPlayer);
register("0:2818", createObject);
register("0:290b", allocObject);
register("0:2989", initFromDescriptor);
register("0:29b3", moveForward);
register("0:2a0b", step);
register("0:2a8e", velocity);
register("0:2b75", postUpdateAll);
register("0:2bb9", fn_0_2bb9);
register("0:2bc1", collectDoors);
register("0:2c34", undoMove);
register("0:2c71", sendMessage);
register("0:2ccf", roomState);
register("0:3056", loadRoomObjects);
