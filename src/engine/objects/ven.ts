import { chase, countDown, countHostiles, drawObjectPart, enter, leave, sound, writeRecord } from "../actors/helpers.ts";
import { checkRoomCleared } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { placeParts } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { blocked } from "../misc/collide.ts";
import { DRAW_OBJECT, PLAYER, POST_OBJECT, RECEIVER, RECORD_BYTE, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { random } from "../random.ts";
import { createObject } from "../world/objects.ts";

// Class 13, VEN.VGA: vending machine that dispenses creatures while the player is near. +0x85 creature kind
// (record byte via DS:653), +0x84 hostile limit, +0x89 frame set, +0x88 dispense period (high byte), +0x86
// dispense timer, +0x83 switched off (by the player touching it), +6 animation index.

const KINDS = 0x653; // record byte 0 of the dispensed creature per +0x85
const SEQUENCE = 0x656; // power-down frame sequence
const PERIODS = 0x650; // dispense period per +0x89

// 0:4f58 init(record, object): record byte 3 = kind | limit << 2 | frames << 4 | off (0x40); random initial delay.
export function venInit(m: Memory, record: number, obj: number): void {
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x85, b & 3);
  const v = (b << 24) >> 24;
  m.set8(obj + 0x84, (v >> 2) & 3);
  m.set8(obj + 0x89, (v >> 4) & 3);
  if (v & 0x40) {
    m.set8(obj + 0x83, 1);
    m.set8(obj + 6, 3);
  }
  m.set8(obj + 0x18, 1);
  const r = random(m, 0x14);
  m.set16(obj + 0x86, ((r << 8) + 0x1400) & 0xffff);
  m.set8(obj + 0x88, m.u8(PERIODS + m.s8(obj + 0x89)));
}

// 0:4fd0 save(object, record): record byte 3 as read by init.
export function venSave(m: Memory, obj: number, record: number): void {
  const off = m.u8(obj + 0x83) ? 0x40 : 0;
  m.set8(record + 3, (m.s8(obj + 0x84) << 2) | m.s8(obj + 0x85) | (m.s8(obj + 0x89) << 4) | off);
  writeRecord(m, obj, record);
}

// 0:501f update().
export function venUpdate(m: Memory): void {
  venDispense(m);
}

// 0:5023 venDispense(): when the timer runs out, the room holds at most +0x84 hostiles and the player is in reach
// (0:4027 range 0x46), create a creature in front of the machine (removed again if it is blocked there). The
// timer is reloaded with the period, or 0xf00 when nothing was dispensed.
export function venDispense(m: Memory): void {
  const bp = enter(m, 8);
  let obj = m.u16(UPDATE_OBJECT);
  if (!m.u8(obj + 0x83) && countDown(m, (obj + 0x86) & 0xffff)) {
    const hostiles = (countHostiles(m) << 16) >> 16;
    obj = m.u16(UPDATE_OBJECT);
    if (hostiles > m.s8(obj + 0x84) || m.u16(PLAYER) === 0 || chase(m, m.u16(PLAYER), 0x46, 4) === 0xffff) {
      obj = m.u16(UPDATE_OBJECT);
      m.set16(obj + 0x86, m.u16(obj + 0x86) + 0xf00);
    } else {
      obj = m.u16(UPDATE_OBJECT);
      m.set16(obj + 0x86, m.u16(obj + 0x86) + ((m.u8(obj + 0x88) << 8) & 0xffff));
      const rec = bp - 6;
      m.set8(rec + 1, m.u8(obj + 8));
      m.set8(rec + 2, m.u8(obj + 0xa));
      m.set8(rec, m.u8(KINDS + m.s8(obj + 0x85)));
      m.set8(rec + 3, random(m, 7));
      const made = createObject(m, rec);
      if (made) {
        m.set8(made + 0x87, 1);
        m.set8(made + 6, 0x16);
        const z = m.u8(made + 0xc);
        m.set8(bp - 8, z);
        m.set8(made + 0xc, 0);
        if (blocked(m, made, bp - 7)) m.set8(made + 3, 1);
        m.set8(made + 0xc, z);
      }
    }
  }
  leave(m, 8);
}

// 0:5109 message(msg, arg): 6 (touched) is handled by 0:5151; every other message returns 0.
export function venMessage(m: Memory, msg: number, _arg: number): number {
  return ((msg << 24) >> 24) === 6 ? venTouched(m) : 0;
}

// 0:5151 venTouched(): the player switches the machine off (power-down animation, room clear check, sound).
export function venTouched(m: Memory): number {
  if (m.u8(m.u16(SENDER) + 2) === 0) {
    const self = m.u16(RECEIVER);
    if (!m.u8(self + 0x83)) {
      m.set8(self + 0x83, 1);
      m.set8(self + 6, 0);
      checkRoomCleared(m, 1);
      sound(m, 0x1c16);
    }
  }
  return 1;
}

// 0:5183 post-update(): frame from the power-down sequence, advanced while switched off until index 4.
export function venPostUpdate(m: Memory): void {
  let obj = m.u16(POST_OBJECT);
  const frame = m.s8(SEQUENCE + m.s8(obj + 6));
  if (m.u8(obj + 0x83) && m.s8(obj + 6) < 4) call(m, "12cc:07b7", SEQUENCE);
  obj = m.u16(POST_OBJECT);
  m.set16(obj + 0x1d, m.u16((m.u16(obj + 4) + frame * 2) & 0xffff));
  m.set16(obj + 0x29, 2);
  placeParts(m, obj);
}

// 0:51df draw().
export function venDraw(m: Memory): void {
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
}

register("0:4f58", venInit);
register("0:4fd0", venSave);
register("0:501f", venUpdate);
register("0:5023", venDispense);
register("0:5109", venMessage);
register("0:5151", venTouched);
register("0:5183", venPostUpdate);
register("0:51df", venDraw);
