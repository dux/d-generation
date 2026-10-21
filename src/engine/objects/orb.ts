import { findObject, checkRoomCleared } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { nextObjectOfClass } from "../geometry/math.ts";
import type { Memory } from "../memory.ts";
import { playSound } from "../misc/sound.ts";
import {
  DRAW_OBJECT,
  FRAME_TICKS,
  PLAYER,
  RECEIVER,
  RECORD_BYTE,
  SCENE,
  SENDER,
  UPDATE_OBJECT,
} from "../props/common.ts";
import { random } from "../random.ts";

// Class 6, ORB: orb that locks onto the player, charges and fires.


// 0:3c4a init(record, object): common init, record byte 3 low 3 bits = direction, random frame 0..8.
export function orbInit(m: Memory, record: number, obj: number): void {
  call(m, "0:471d", obj, record);
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x13, b & 7);
  m.set8(obj + 0x16, 0);
  m.set8(obj + 6, random(m, 9));
}

// 0:3c82 save(object, record): record byte 3 = direction, then common save.
export function orbSave(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, m.u8(obj + 0x13));
  call(m, "0:4693", obj, record);
}

// 0:8db3 fn_0_8db3(): when 0:47e7 fires on field 0x8b, the orb dies (event 2) and the room is rechecked.
export function fn_0_8db3(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (!call(m, "0:47e7", (obj + 0x8b) & 0xffff)) return;
  m.set8(obj + 0x3b, 0);
  m.set8(obj + 0x13, 0);
  call(m, "0:42bd", obj, 2, 0, 0);
  checkRoomCleared(m, 1);
}

// 0:8dee fn_0_8dee(): while charging, fire at the locked target once the animation is far enough.
export function fn_0_8dee(m: Memory): void {
  let obj = m.u16(UPDATE_OBJECT);
  if (m.u16(obj + 0x85) === 0) return;
  const target = findObject(m, m.u16(obj + 0x92));
  if (target === 0) return;
  obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0xc) < 0xb) return;
  if (m.s8(obj + 6) <= 0x10) return;
  if (!call(m, "0:414b", target, 5)) return;
  const ev = m.push(0x10);
  m.set16(ev + 5, m.u16(target + 7));
  m.set16(ev + 7, m.u16(target + 9));
  m.set16(ev + 2, target);
  if (call(m, "0:2c71", 2, ev)) {
    obj = m.u16(UPDATE_OBJECT);
    m.set8(obj + 0x37, 1);
    m.set16(ev, obj);
    m.set16(ev + 2, target);
    call(m, "0:2c71", 9, ev);
    obj = m.u16(UPDATE_OBJECT);
    m.set8(obj + 0x89, 1);
    m.set16(obj + 0x85, 0);
    m.set8(obj + 0x94, m.u8(target + 0xd1));
    m.set8(obj + 6, m.u8(obj + 6) + 0xf5);
    m.set16(obj + 0x8b, 0x3700);
  }
  m.pop(0x10);
}

// 0:8eae fn_0_8eae(): 0:3e5f(&a, &b, 5) with throwaway locals.
export function fn_0_8eae(m: Memory): void {
  const loc = m.push(4);
  call(m, "0:3e5f", loc + 2, loc, 5);
  m.pop(4);
}

// 0:8eca cooldownTick(): field 0x90 counts down by DS:3408 (frame ticks), clamped at 0.
export function cooldownTick(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u16(obj + 0x90) === 0) return;
  const v = (m.u16(obj + 0x90) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0x90, v);
  if (v & 0x8000) m.set16(obj + 0x90, 0);
}

// 0:8eed acquireTarget(): when idle and cooled down, lock onto the player (or a class 9 object) within range.
export function acquireTarget(m: Memory): void {
  const loc = m.push(6);
  const index = loc + 2;
  m.set16(index, 0);
  run: {
    if (m.u16(PLAYER) !== 0 && m.u8(m.u16(UPDATE_OBJECT) + 0x89) !== 0) break run;
    if (m.u16(PLAYER) === 0) break run;
    let obj = m.u16(UPDATE_OBJECT);
    if (m.u16(obj + 0x85) !== 0) break run;
    if (m.u8(m.u16(PLAYER) + 0x91) !== 0 || m.u8(0x3375) !== 0) break run;
    obj = m.u16(UPDATE_OBJECT);
    if (m.s8(obj + 6) >= 2 || m.u16(obj + 0x90) !== 0) {
      if (m.s8(obj + 6) >= 0x1a) m.set8(obj + 0x87, 1);
      break run;
    }
    m.set16(obj + 0x90, m.u16(obj + 0x90) + 0x400);
    let target = m.u16(PLAYER);
    let dir = call(m, "0:4027", target, 0x3c, 4);
    if (dir === 0xffff) {
      target = nextObjectOfClass(m, 9, index);
      if (target !== 0) dir = call(m, "0:4027", target, 0x3c, 4);
    }
    if (dir !== 0xffff) {
      const id = m.u16(target);
      obj = m.u16(UPDATE_OBJECT);
      m.set16(obj + 0x3f, id);
      m.set16(obj + 0x92, id);
      m.set8(obj + 0x3a, dir & 0xff);
      const facing = call(m, "0:4945", dir);
      m.set8(m.u16(UPDATE_OBJECT) + 0x13, facing & 0xff);
      call(m, "0:478e", m.u16(UPDATE_OBJECT), target);
      obj = m.u16(UPDATE_OBJECT);
      m.set8(obj + 0x88, (Math.trunc(m.u8(SCENE) / 0x32) * 3 + 0x3c) & 0xff);
      m.set16(obj + 0x85, 1);
      m.set8(obj + 6, 0xb);
      m.set8(obj + 0x17, 6);
    } else {
      m.set16(m.u16(UPDATE_OBJECT) + 0x92, 0);
    }
  }
  m.pop(6);
}

// 0:8da3 orbUpdate(): per-frame behaviour.
export function orbUpdate(m: Memory): void {
  acquireTarget(m);
  fn_0_8eae(m);
  fn_0_8db3(m);
  fn_0_8dee(m);
  cooldownTick(m);
}

// 0:902c orbHit(): message 9; 0:5bd0 on the sender's class decides; class 14 forces a charge, otherwise the orb dies.
export function orbHit(m: Memory): number {
  const r = call(m, "0:5bd0", m.s8(m.u16(SENDER) + 2) & 0xffff, 0x10c4);
  if (r === 0) return 0;
  const other = m.u16(SENDER);
  if (m.u8(other + 2) === 0xe) {
    const self = m.u16(RECEIVER);
    m.set8(self + 0x88, 0x46);
    m.set16(self + 0x85, 1);
    m.set8(self + 6, 0xb);
    return r;
  }
  call(m, "0:42bd", m.u16(RECEIVER), 2, m.s8(other + 0x13) & 0xffff, m.u8(other + 0x3b));
  checkRoomCleared(m, 1);
  return 0;
}

// 0:90ec fn_0_90ec(arg): message 0; 2.5 s cooldown, facing from arg byte 4, sound 0x1c26 if arg's object is class 6.
export function fn_0_90ec(m: Memory, arg: number): number {
  const self = m.u16(RECEIVER);
  m.set16(self + 0x90, 0xa00);
  m.set8(self + 0x13, m.u8(arg + 4));
  m.set8(self + 0x3a, 0xff);
  if (m.u8(m.u16(arg + 2) + 2) === 6) playSound(m, 0x1c26);
  return 0xffff;
}

// 0:9125 fn_0_9125(arg): message 8; cooldown and facing from arg byte 4.
export function fn_0_9125(m: Memory, arg: number): number {
  const self = m.u16(RECEIVER);
  m.set16(self + 0x90, 0xa00);
  m.set8(self + 0x13, m.u8(arg + 4));
  m.set8(self + 0x3a, 0xff);
  return 0xffff;
}

// 0:9088 orbMessage(msg, arg): message dispatcher.
export function orbMessage(m: Memory, msg: number, arg: number): number {
  switch ((msg << 24) >> 24) {
    case 0:
      return fn_0_90ec(m, arg);
    case 2:
      return call(m, "0:4242", arg);
    case 3:
      return call(m, "0:44e4", arg);
    case 8:
      return fn_0_9125(m, arg);
    case 9:
      return orbHit(m);
    default:
      return 0;
  }
}

// 0:914a orbPostUpdate(): 12cc:017c.
export function orbPostUpdate(m: Memory): void {
  call(m, "12cc:017c");
}

// 0:9150 orbDraw(): draw layers 1 and 0, then layer 2 with field 0xd1 temporarily = field 0x94.
export function orbDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 1);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
  const obj = m.u16(DRAW_OBJECT);
  m.set8(obj + 0xd1, m.u8(obj + 0x94));
  call(m, "0:3f81", obj, 2);
  m.set8(m.u16(DRAW_OBJECT) + 0xd1, 0);
}

register("0:3c4a", orbInit);
register("0:3c82", orbSave);
register("0:8da3", orbUpdate);
register("0:8db3", fn_0_8db3);
register("0:8dee", fn_0_8dee);
register("0:8eae", fn_0_8eae);
register("0:8eca", cooldownTick);
register("0:8eed", acquireTarget);
register("0:902c", orbHit);
register("0:9088", orbMessage);
register("0:90ec", fn_0_90ec);
register("0:9125", fn_0_9125);
register("0:914a", orbPostUpdate);
register("0:9150", orbDraw);
