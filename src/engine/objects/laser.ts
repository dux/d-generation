import { classInList, drawObjectPart, enter, leave, moveCurrent, resolveMove, sound, teleportTo } from "../actors/helpers.ts";
import { register } from "../dispatch.ts";
import { placeParts, updateBox } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, POST_OBJECT, RECEIVER, ROUND, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { sendMessage, step } from "../world/objects.ts";

// Class 20, LASER.VGA: laser bolt. +0x83 bounces, +0x84 flicker toggle, +0x85 exploding, +0x87 explosion frame
// timer, +0x89 lifetime in frames (then +0x3f = -1).

const DEADLY = 0x6da; // classes destroyed by the bolt (both get message 9), negative-terminated
const SHADES = 0x6e3; // colour shade (+0x36) per bounce count

// 0:3c9f init(record, object).
export function laserInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0xc, 9);
  m.set8(obj + 0x3b, 0x55);
  m.set8(obj + 7, 0x80);
  m.set8(obj + 9, 0x80);
  m.set8(obj + 0x17, 0x15);
  updateBox(m, obj);
}

// 0:5a36 update(): unless exploding, fly (0:3e5f speed 6) with up to three step-and-resolve retries, then count
// the lifetime down.
export function laserUpdate(m: Memory): void {
  const bp = enter(m, 4);
  const dx = bp - 2;
  const dy = bp - 4;
  if (m.u16(m.u16(UPDATE_OBJECT) + 0x85) === 0) {
    if (!moveCurrent(m, dx, dy, 6)) {
      for (let i = 0; i < 3; i++) {
        step(m, m.u16(UPDATE_OBJECT), dx, dy);
        if (resolveMove(m, dx, dy, 6)) break;
      }
    }
    const obj = m.u16(UPDATE_OBJECT);
    if (m.u8(obj + 0x89)) {
      const left = (m.u8(obj + 0x89) - 1) & 0xff;
      m.set8(obj + 0x89, left);
      if (left === 0) m.set16(obj + 0x3f, 0xffff);
    }
  }
  leave(m, 4);
}

// 0:5aee message(msg, arg): 0 collision, 2 teleport, 8 reflect along arg+4 (0:5c04), 9 explode; others 0.
export function laserMessage(m: Memory, msg: number, arg: number): number {
  switch ((msg << 24) >> 24) {
    case 0:
      return laserCollide(m, arg);
    case 2:
      return teleportTo(m, arg);
    case 8:
      return laserReflect(m, arg);
    case 9: {
      const self = m.u16(RECEIVER);
      m.set8(self + 0x18, 1);
      m.set16(self + 0x85, 1);
      m.set16(self + 0x87, 0x2e4);
      m.set8(self + 6, 0);
      return 1;
    }
    default:
      return 0;
  }
}

// 0:5afb (case 0 of 0:5aee): a deadly class and the bolt destroy each other (message 9 both ways); anything else
// bounces it to the facing in arg+4. Hidden bolts ignore collisions.
function laserCollide(m: Memory, arg: number): number {
  const bp = enter(m, 0x1c);
  if (!m.u8(m.u16(RECEIVER) + 0x37)) {
    if (classInList(m, m.s8(m.u16(SENDER) + 2) & 0xffff, DEADLY)) {
      const a = bp - 0xe;
      m.set16(a, m.u16(SENDER));
      m.set16(a + 2, m.u16(RECEIVER));
      sendMessage(m, 9, a);
      const b = bp - 0x1c;
      m.set16(b, m.u16(RECEIVER));
      m.set16(b + 2, m.u16(SENDER));
      sendMessage(m, 9, b);
    } else {
      const self = m.u16(RECEIVER);
      m.set8(self + 0x13, m.u8(arg + 4));
      m.set8(self + 0x84, 1);
      laserBounce(m);
    }
  }
  leave(m, 0x1c);
  return 1;
}

// 0:5c04 laserReflect(info): facing = info+4, then bounce.
export function laserReflect(m: Memory, info: number): number {
  const d = m.u8(info + 4);
  const self = m.u16(RECEIVER);
  m.set8(self + 0x13, d);
  m.set8(self + 0x16, d);
  m.set8(self + 0x84, 1);
  m.set8(self + 6, 0);
  laserBounce(m);
  return 1;
}

// 0:5c31 laserBounce(): the fourth bounce explodes the bolt (message 9 to itself), others play a sound.
export function laserBounce(m: Memory): void {
  const bp = enter(m, 0xe);
  const self = m.u16(RECEIVER);
  const n = (m.u8(self + 0x83) + 1) & 0xff;
  m.set8(self + 0x83, n);
  if (n === 4) {
    const pair = bp - 0xe;
    m.set16(pair, self);
    m.set16(pair + 2, self);
    sendMessage(m, 9, pair);
  } else if (m.u8(m.u16(RECEIVER) + 3) === 0) {
    sound(m, 0x1a16);
  }
  leave(m, 0xe);
}

// 0:5c73 post-update(): exploding: frames 0..4 of the explosion set (shape table +0x10), then removed; flying:
// the frame of the facing with the flicker toggle, shaded by the bounce count.
export function laserPostUpdate(m: Memory): void {
  const bp = enter(m, 2);
  let obj = m.u16(POST_OBJECT);
  if (m.u16(obj + 0x85)) {
    const f = laserExplosionFrame(m);
    m.set8(bp - 2, f);
    const frame = (f << 24) >> 24;
    if (frame < 5) {
      if (frame === 1) sound(m, 0x1a1e);
      obj = m.u16(POST_OBJECT);
      const set = m.u16((m.u16(obj + 4) + 0x10) & 0xffff);
      m.set16(obj + 0x1d, m.u16((set + frame * 2) & 0xffff));
      m.set16(obj + 0x29, 0);
      m.set16(obj + 0x2f, 2);
      placeParts(m, obj);
    } else {
      m.set8(m.u16(POST_OBJECT) + 3, m.u8(ROUND));
    }
  } else {
    const toggle = m.u8(obj + 0x84) & 1;
    m.set8(bp - 1, toggle);
    m.set8(obj + 0x84, 0);
    m.set8(obj + 0x36, m.u8(SHADES + m.s8(obj + 0x83)));
    const set = m.u16((m.u16(obj + 4) + m.s8(obj + 0x16) * 2) & 0xffff);
    m.set16(obj + 0x1d, m.u16((set + toggle * 2) & 0xffff));
    m.set16(obj + 0x2f, 0);
    m.set16(obj + 0x29, 0);
    placeParts(m, obj);
  }
  leave(m, 2);
}

// 0:5d30 draw().
export function laserDraw(m: Memory): void {
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
}

// 0:5d3f laserExplosionFrame(): advance +6 by one per 0x190 of time (+0x87 timer); returns it.
export function laserExplosionFrame(m: Memory): number {
  const obj = m.u16(POST_OBJECT);
  m.set16(obj + 0x87, m.u16(obj + 0x87) - m.u16(FRAME_TICKS));
  while (m.s16(obj + 0x87) < 0) {
    m.set8(obj + 6, m.u8(obj + 6) + 1);
    m.set16(obj + 0x87, m.u16(obj + 0x87) + 0x190);
  }
  return m.s8(obj + 6) & 0xffff;
}

register("0:3c9f", laserInit);
register("0:5a36", laserUpdate);
register("0:5aee", laserMessage);
register("0:5c04", laserReflect);
register("0:5c31", laserBounce);
register("0:5c73", laserPostUpdate);
register("0:5d30", laserDraw);
register("0:5d3f", laserExplosionFrame);
