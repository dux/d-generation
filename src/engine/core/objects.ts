import { call, callNear, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { memcpy, memset, qsort } from "../runtime.ts";

// Object lists. Object fields used here: +0 id, +2 class, +3 removed flag, +8/+0xa x/y high bytes,
// +0x7d packed position (x << 8 | y), +0x82 drawn in the first layer, +0xd7 three dirty-rectangle links.

export const OBJECT_SLOTS = 0x33ac; // 30 object pointers of the current room (0 = free)
export const SLOT_COUNT = 30;
export const CLASS_TABLE = 0x191d; // class descriptor pointer per class number
export const DRAWN_OBJECTS = 0x30ca; // objects drawn this frame (count at DS:3322)
export const DRAWN_COUNT = 0x3322;
export const DRAW_LIST = 0x3324; // 30 pointers sorted back to front, 0-terminated
export const CURRENT_OBJECT = 0x34b0; // object being updated
export const DRAWING_OBJECT = 0x3360; // object being drawn
export const SPAWN_RECORD = 0x338a; // 4-byte copy of the spawn record being placed
export const SPAWN_COUNT = 0x3388;
export const SPAWN_FLAGS = 0x338e;

function classSlot(m: Memory, obj: number, slot: number): number {
  return m.u16(m.u16(CLASS_TABLE + m.s8(obj + 2) * 2) + slot);
}

// 0:1811 forEachObject(callback): calls callback(obj) on every live object until it returns nonzero; returns 1 then.
export function forEachObject(m: Memory, callback: number): number {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const obj = m.u16(OBJECT_SLOTS + i * 2);
    if (obj && !m.u8(obj + 3) && callNear(m, callback, obj) & 0xffff) return 1;
  }
  return 0;
}

// 0:197b callback: an active vending machine (class 13, +0x83 == 0).
function isActiveVen(m: Memory, obj: number): number {
  return m.u8(obj + 2) === 0xd && !m.u8(obj + 0x83) ? 1 : 0;
}

// 0:1966 noActiveVen(): 1 when no vending machine is active.
export function noActiveVen(m: Memory): number {
  return forEachObject(m, 0x197b) ? 0 : 1;
}

// 0:19a3 callback: vending machines get state 6.
function venState6(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 0xd) m.set8(obj + 6, 6);
  return 0;
}

// 0:199a setVensState6()
export function setVensState6(m: Memory): void {
  forEachObject(m, 0x19a3);
}

// 0:19c3 callback: ART objects in mode 6 get +0x88 = 1.
function artFlag(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 0xb && m.u8(obj + 0x85) === 6) m.set8(obj + 0x88, 1);
  return 0;
}

// 0:19ba flagArts()
export function flagArts(m: Memory): void {
  forEachObject(m, 0x19c3);
}

// 0:19eb callback: doors (class 2) in state 7 get message 4 through 0:2c71.
function doorMessage(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 2 && m.u8(obj + 0x3e) === 7) {
    const msg = m.push(0xe);
    m.set16(msg + 2, obj);
    m.set8(msg + 0xd, 0);
    call(m, "0:2c71", 4, msg);
    m.pop(0xe);
  }
  return 0;
}

// 0:19e2 messageDoors()
export function messageDoors(m: Memory): void {
  forEachObject(m, 0x19eb);
}

// 0:1a3a callback: counts objects of class DS:33e8 into DS:33e9.
function countClassCallback(m: Memory, obj: number): number {
  if (!m.u8(obj + 3) && m.u8(obj + 2) === m.u8(0x33e8)) m.set8(0x33e9, m.u8(0x33e9) + 1);
  return 0;
}

// 0:1a1c countClass(cls): number of live objects of a class.
export function countClass(m: Memory, cls: number): number {
  m.set8(0x33e8, cls);
  m.set8(0x33e9, 0);
  forEachObject(m, 0x1a3a);
  return m.s8(0x33e9) & 0xffff;
}

// 0:1a78 callback: stops at the object whose id is DS:33ec, storing it in DS:33ea.
function findIdCallback(m: Memory, obj: number): number {
  if (m.u8(obj + 3) || m.u16(obj) !== m.u16(0x33ec)) return 0;
  m.set16(0x33ea, obj);
  return 1;
}

// 0:1a5a findObject(id): the live object with this id, or 0.
export function findObject(m: Memory, id: number): number {
  m.set16(0x33ea, 0);
  m.set16(0x33ec, id);
  forEachObject(m, 0x1a78);
  return m.u16(0x33ea);
}

// 0:190f checkRoomCleared(announce): when no class 15 or 6 objects remain and no vending machine is active, opens the
// room (doors, 0:5fa8, ART, vending machines) and optionally shows a message.
export function checkRoomCleared(m: Memory, announce: number): void {
  if (countClass(m, 0xf) || countClass(m, 6) || !noActiveVen(m)) return;
  messageDoors(m);
  call(m, "0:5fa8", 0);
  flagArts(m);
  setVensState6(m);
  if (announce & 0xff) {
    call(m, "0:cff8", 0x398, 4, 0x7a);
    call(m, "0:b5c3", 0x1d3a);
  }
}

// 0:1ead callback: a CGEN/DGEN (class 22/26) remembers the room and its position as the respawn point.
function respawnCallback(m: Memory, obj: number): number {
  const cls = m.u8(obj + 2);
  if (cls === 0x16 || cls === 0x1a) {
    m.set8(0x33ee, m.u8(0x337e));
    m.set8(0x33ef, m.u8(obj + 8));
    m.set8(0x33f0, m.u8(obj + 0xa));
  }
  return 0;
}

// 0:1ea4 findRespawnPoint()
export function findRespawnPoint(m: Memory): void {
  forEachObject(m, 0x1ead);
}

// 0:185d saveRoomObjects(): writes every saveable object's state record (class slot +0x14) into the room's save
// list (0:2ccf), 0-terminated, and frees the objects (0:2656).
export function saveRoomObjects(m: Memory): void {
  const list = call(m, "0:2ccf", m.u8(0x337e)) & 0xffff;
  let n = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const obj = m.u16(OBJECT_SLOTS + i * 2);
    if (!obj) continue;
    const cls = m.u8(obj + 2);
    if (cls === 8 || cls === 0 || cls === 0x13 || cls === 0x17 || cls === 0x14 || cls === 0x11 || m.u8(obj + 3)) continue;
    const save = classSlot(m, obj, 0x14);
    if (save) callNear(m, save, obj, (list + n++ * 4) & 0xffff);
    call(m, "0:2656", obj);
  }
  if (n < SLOT_COUNT) m.set8(list + n * 4, 0);
}

// 0:179c collectClass8(): records the position of every class 8 object at DS:33a4 + 2 * table[+0x13] and frees it.
export function collectClass8(m: Memory): void {
  memset(m, 0x33a4, 0, 8);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const obj = m.u16(OBJECT_SLOTS + i * 2);
    if (!obj || m.u8(obj + 2) !== 8) continue;
    const k = m.s8(0x394 + m.s8(obj + 0x13)) * 2;
    m.set8(0x33a4 + k, m.u8(obj + 8));
    m.set8(0x33a5 + k, m.u8(obj + 0xa));
    call(m, "0:2656", obj);
  }
}

// 0:1656 spawnObjects(records, restore): places the room's spawn records (4 bytes each, up to 22, 0-terminated).
// The type is bits 0-3 plus 0x10 for bit 7; type 0x13 becomes 0x15. restore = 0 is a fresh room: listed classes get
// their flag from DS:33a2 and type 8 an empty flag; restore != 0 only places type 8 (and 0:bfd0 when DS:1e57 is set).
// Returns 1 when the list is empty.
export function spawnObjects(m: Memory, records: number, restore: number): number {
  if (!(restore & 0xff)) m.set8(SPAWN_COUNT, 0);
  let i = 0;
  for (;;) {
    memcpy(m, SPAWN_RECORD, records + i * 4, 4);
    const b = m.u8(SPAWN_RECORD);
    let type = (b & 0x80 ? 0x10 : 0) | (b & 0xf);
    if (!type) break;
    if (type === 0x13) {
      type = 0x15;
      m.set8(SPAWN_RECORD, (b & 0x70) | 0x85);
    }
    if (type === 8) {
      if (restore & 0xff) {
        call(m, "0:2818", SPAWN_RECORD);
        if (m.u8(0x1e57)) call(m, "0:bfd0", type, SPAWN_RECORD);
      } else {
        m.set8(SPAWN_FLAGS + m.s8(SPAWN_COUNT), 0);
        m.set8(SPAWN_COUNT, m.u8(SPAWN_COUNT) + 1);
      }
    } else if (!(restore & 0xff) && SPAWNED_TYPES.has(type)) {
      m.set8(SPAWN_FLAGS + m.s8(SPAWN_COUNT), m.u8(0x33a2));
      m.set8(SPAWN_COUNT, m.u8(SPAWN_COUNT) + 1);
      call(m, "0:2818", SPAWN_RECORD);
    }
    if (++i >= 0x16) break;
  }
  return i ? 0 : 1;
}

const SPAWNED_TYPES = new Set([3, 6, 0xf, 0x13, 9, 0x16, 2, 4, 1, 0xd, 0x12, 0xb, 7, 0xe, 0xa, 0x15, 0x1a]);

// 0:2098 updateObjects(): clears each object's dirty links and runs its class update (slot +0xa, object in DS:34b0),
// then packs its position into +0x7d.
export function updateObjects(m: Memory): void {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const obj = m.u16(OBJECT_SLOTS + i * 2);
    if (!obj) continue;
    memset(m, obj + 0xd7, 0, 6);
    if (m.u8(obj + 3)) continue;
    m.set16(CURRENT_OBJECT, obj);
    callNear(m, classSlot(m, obj, 0xa));
    m.set16(obj + 0x7d, (m.u8(obj + 8) << 8) + m.u8(obj + 0xa));
  }
}

// 0:12fa buildDrawList(layer): drawn objects of layer 0 (+0x82 set) or 1 (+0x82 clear) sorted back to front by
// 0:1408 into DS:3324, padded with 0. Layer 2 selects nothing.
export function buildDrawList(m: Memory, layer: number): void {
  let n = 0;
  const count = m.s16(DRAWN_COUNT);
  for (let i = 0; i < count; i++) {
    const obj = m.u16(DRAWN_OBJECTS + i * 2);
    if (!obj || m.u8(obj + 3)) continue;
    const first = m.u8(obj + 0x82) !== 0;
    if ((layer === 0 && first) || (layer === 1 && !first)) m.set16(DRAW_LIST + n++ * 2, obj);
  }
  if (n > 1) qsort(m, DRAW_LIST, n, 2, 0x1408);
  while (n < SLOT_COUNT) m.set16(DRAW_LIST + n++ * 2, 0);
}

// 0:1429 drawList(): latches each listed object's previous frame state and calls its class draw (slot +0x10, object
// in DS:3360).
export function drawList(m: Memory): void {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const obj = m.u16(DRAW_LIST + i * 2);
    if (!obj) break;
    for (let k = 0; k < 3; k++) {
      if (m.u8(obj + 0xcb + k)) m.set16(obj + 0x23 + k * 2, m.u16(obj + 0x1d + k * 2));
    }
    m.set16(obj + 0x7f, m.u16(obj + 0x7d));
    m.set8(obj + 0x81, m.u8(obj + 0xc));
    m.set16(DRAWING_OBJECT, obj);
    callNear(m, classSlot(m, obj, 0x10));
  }
}

// 0:12d8 drawObjects(): draw lists for layers 0, 1 and 2.
export function drawObjects(m: Memory): void {
  for (let layer = 0; layer < 3; layer++) {
    buildDrawList(m, layer);
    drawList(m);
  }
}

register("0:1811", forEachObject);
register("0:197b", isActiveVen);
register("0:1966", noActiveVen);
register("0:19a3", venState6);
register("0:199a", setVensState6);
register("0:19c3", artFlag);
register("0:19ba", flagArts);
register("0:19eb", doorMessage);
register("0:19e2", messageDoors);
register("0:1a3a", countClassCallback);
register("0:1a1c", countClass);
register("0:1a78", findIdCallback);
register("0:1a5a", findObject);
register("0:190f", checkRoomCleared);
register("0:1ead", respawnCallback);
register("0:1ea4", findRespawnPoint);
register("0:185d", saveRoomObjects);
register("0:179c", collectClass8);
register("0:1656", spawnObjects);
register("0:2098", updateObjects);
register("0:12fa", buildDrawList);
register("0:1429", drawList);
register("0:12d8", drawObjects);
