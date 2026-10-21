import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, UPDATE_OBJECT } from "../props/common.ts";
import { random } from "../random.ts";

// Class 16, ELC.VGA: electric spark. +0x8b zap timer, +0x85 animation timer, +0x89 silent (no 0:1de6 effect),
// +0xcc/+0xd1/+0x8a frame selectors for the flicker.

// 0:8088 init(record, object): animation timer 0x3200.
export function elcInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x18, 1);
  m.set16(obj + 0x85, 0x3200);
}

// 0:80a3 elcZap(): when the zap timer runs out, rearm it (0x200 + 0..6 * 0x80), play sound 1aea and, unless
// silent, trigger effect 0:1de6(3, 2).
export function elcZap(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  const left = (m.u16(obj + 0x8b) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0x8b, left);
  if (!(left & 0x8000)) return;
  m.set16(obj + 0x8b, (random(m, 7) << 7) + 0x200);
  call(m, "0:b5c3", 0x1aea);
  if (!m.u8(obj + 0x89)) call(m, "0:1de6", 3, 2);
}

// 0:80f4 elcAnimate(): steps the animation (0:42bd) whenever the +0x85 timer fires (0:47e7).
export function elcAnimate(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (!call(m, "0:47e7", obj + 0x85)) return;
  call(m, "0:42bd", obj, 0xffff, m.s8(obj + 0x13) & 0xffff, m.u8(obj + 0x3b));
}

// 0:809c update().
export function elcUpdate(m: Memory): void {
  elcZap(m);
  elcAnimate(m);
}

// 0:811e message(msg, arg): every message is accepted (1).
export function elcMessage(_m: Memory, _msg: number, _arg: number): number {
  return 1;
}

// 0:8163 post-update(): 12cc:17e4.
export function elcPostUpdate(m: Memory): void {
  call(m, "12cc:17e4");
}

// 0:8169 draw(): flicker; when +0xcc is set the +0x8a frame is drawn first, then 3 times in 4 the normal frame,
// otherwise frame selector random(4) * 4.
export function elcDraw(m: Memory): void {
  const obj = m.u16(DRAW_OBJECT);
  const frame = m.u8(obj + 0xd1);
  let second = 0;
  if (m.u8(obj + 0xcc)) {
    m.set8(obj + 0xd1, m.u8(obj + 0x8a));
    call(m, "0:3f81", obj, 0);
    second = 1;
  }
  if (random(m, 4)) m.set8(obj + 0xd1, frame);
  else m.set8(obj + 0xd1, random(m, 4) << 2);
  call(m, "0:3f81", obj, second);
  m.set8(obj + 0xd1, frame);
}

register("0:8088", elcInit);
register("0:80a3", elcZap);
register("0:80f4", elcAnimate);
register("0:809c", elcUpdate);
register("0:811e", elcMessage);
register("0:8163", elcPostUpdate);
register("0:8169", elcDraw);
