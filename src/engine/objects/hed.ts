import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { CLASS_TABLE } from "../core/objects.ts";
import { DRAW_OBJECT, FRAME_TICKS, RECEIVER, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { random } from "../random.ts";

// Class 24, HED.VGA/LEG.VGA: body part thrown out when a creature explodes. It bounces on the floor:
// +0x0b height (8.8), +0x11 vertical speed, gravity = frame ticks; +0x85 timer, +0x86 drift speed (into +0x3b).

const KNOCKABLE = 0x11b9; // class list checked by 0:5bd0 before a hit pushes the part

// 0:a1ac init(record, object): thrown up with speed -0x600 and a random frame.
export function hedInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x16, 0);
  m.set8(obj + 0xc, 0xf);
  m.set8(obj + 0x86, 0x30);
  m.set8(obj + 0x17, 0xc);
  m.set16(obj + 0x11, 0xfa00);
  m.set8(obj + 6, random(m, 4));
}

// 0:a1dc update(): fall and bounce (speed 0x190 - speed on hitting the floor), then drift (0:3e5f mode 5).
export function hedUpdate(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  const ticks = m.u16(FRAME_TICKS);
  const left = (m.u16(obj + 0x85) - ticks) & 0xffff;
  m.set16(obj + 0x85, left & 0x8000 ? 0 : left);
  m.set16(obj + 0xb, m.u16(obj + 0xb) - m.u16(obj + 0x11));
  if (m.s16(obj + 0xb) < 0) {
    m.set16(obj + 0x11, 0x190 - m.u16(obj + 0x11));
    m.set16(obj + 0xb, 0);
  }
  m.set16(obj + 0x11, m.u16(obj + 0x11) + ticks);
  m.set8(obj + 0x3b, m.u8(obj + 0x86));
  const local = m.push(4);
  call(m, "0:3e5f", local + 2, local, 5);
  m.pop(4);
}

// 0:a29d hedTurn(message): receiver facing (+0x13) = message byte 4. AX keeps the high byte the caller left in
// it, which is the class descriptor pointer the message slot was called through.
export function hedTurn(m: Memory, msg: number): number {
  const facing = m.u8(msg + 4);
  m.set8(m.u16(RECEIVER) + 0x13, facing);
  return (m.u16(CLASS_TABLE + 24 * 2) & 0xff00) | facing;
}

// 0:a2b1 hedHit(): a hit pushes a knockable part away in the sender's direction (0:42bd).
export function hedHit(m: Memory): number {
  const self = m.u16(RECEIVER);
  if (!call(m, "0:5bd0", m.s8(self + 2) & 0xffff, KNOCKABLE)) return 0;
  const sender = m.u16(SENDER);
  return call(m, "0:42bd", m.u16(RECEIVER), 2, m.s8(sender + 0x13) & 0xffff, m.u8(sender + 0x3b));
}

// 0:a23c message(msg, arg): 0 and 8 turn, 2 -> 0:4242, 9 hit; others accepted (1).
export function hedMessage(m: Memory, msg: number, arg: number): number {
  switch (msg & 0xff) {
    case 0:
    case 8:
      return hedTurn(m, arg);
    case 2:
      return call(m, "0:4242", arg);
    case 9:
      return hedHit(m);
    default:
      return 1;
  }
}

// 0:a2e6 post-update(): 12cc:16a4.
export function hedPostUpdate(m: Memory): void {
  call(m, "12cc:16a4");
}

// 0:a2ec draw().
export function hedDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

register("0:a1ac", hedInit);
register("0:a1dc", hedUpdate);
register("0:a29d", hedTurn);
register("0:a2b1", hedHit);
register("0:a23c", hedMessage);
register("0:a2e6", hedPostUpdate);
register("0:a2ec", hedDraw);
