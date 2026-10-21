import { drawObjectPart, enter, leave, sound } from "../actors/helpers.ts";
import { register } from "../dispatch.ts";
import { CLASS_TABLE } from "../core/objects.ts";
import { animate } from "../geometry/math.ts";
import { placeParts } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, POST_OBJECT, RECEIVER } from "../props/common.ts";

// Class 5, SQU.VGA: squeaking floor creature. +0x84 animation timer, +6 animation index, +0x83 hits taken,
// +0x86 squeak already played.

const SEQUENCE = 0x647; // frame sequence, 0xff-terminated

// 0:4e30 init(record, object).
export function squInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x18, 1);
  m.set16(obj + 0x86, 0);
  m.set16(obj + 0x84, 0xcc00);
}

// 0:4e4a update(): nothing.
export function squUpdate(_m: Memory): void {}

// 0:4e4b message(msg, arg): 9 (hit) counts the hit (0:4e93); every other message returns 0.
export function squMessage(m: Memory, msg: number, _arg: number): number {
  return ((msg << 24) >> 24) === 9 ? squHit(m) : 0;
}

// 0:4e93 squHit(): +0x83 += 1; from the second hit on, animation index 4. The original leaves the count in AL
// and the high byte of BX in AH, which is the class descriptor pointer when called through 0:2c71.
export function squHit(m: Memory): number {
  const obj = m.u16(RECEIVER);
  const hits = (m.u8(obj + 0x83) + 1) & 0xff;
  m.set8(obj + 0x83, hits);
  if (((hits << 24) >> 24) > 1) m.set8(obj + 6, 4);
  return (m.u16(CLASS_TABLE + 5 * 2) & 0xff00) | hits;
}

// 0:4ea8 post-update(): step the animation; when it wraps the index is held at its last frame. The first
// frame >= 1 plays the squeak once. Part 0 shows the frame, then 0:08c4 places it.
export function squPostUpdate(m: Memory): void {
  const bp = enter(m, 4);
  const frame = bp - 2;
  m.set16(frame, 0);
  let obj = m.u16(POST_OBJECT);
  const index = m.u8(obj + 6);
  m.set8(obj + 0xce, 1);
  if (animate(m, SEQUENCE, (m.u16(POST_OBJECT) + 0x84) & 0xffff, 0x1d6, frame, (obj + 6) & 0xffff)) {
    m.set8(m.u16(POST_OBJECT) + 6, index);
    m.set16(frame, m.s8(SEQUENCE + ((index << 24) >> 24)));
  }
  obj = m.u16(POST_OBJECT);
  if (m.u16(obj + 0x86) === 0 && m.s16(frame) >= 1) {
    m.set16(obj + 0x86, 1);
    sound(m, 0x1de6);
  }
  obj = m.u16(POST_OBJECT);
  m.set16(obj + 0x1d, m.u16((m.u16(obj + 4) + m.u16(frame) * 2) & 0xffff));
  m.set16(obj + 0x29, 0xfffa);
  m.set16(obj + 0x2f, 2);
  placeParts(m, obj);
  leave(m, 4);
}

// 0:4f49 draw().
export function squDraw(m: Memory): void {
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
}

register("0:4e30", squInit);
register("0:4e4a", squUpdate);
register("0:4e4b", squMessage);
register("0:4e93", squHit);
register("0:4ea8", squPostUpdate);
register("0:4f49", squDraw);
