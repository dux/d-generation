import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, RECEIVER, UPDATE_OBJECT } from "../props/common.ts";

// Class 17, EXP: drifting cloud fading out (+0x3b = intensity, gone below 0).

// 0:7b44 update(): move along the path (0:3e5f mode 7, retried with 0:2a0b/0:3e95 when blocked) and fade by
// frame ticks / 32.
export function expUpdate(m: Memory): void {
  const local = m.push(4);
  if (!call(m, "0:3e5f", local + 2, local, 7)) {
    call(m, "0:2a0b", m.u16(UPDATE_OBJECT), local + 2, local);
    call(m, "0:3e95", local + 2, local, 7);
  }
  m.pop(4);
  const cur = m.u16(UPDATE_OBJECT);
  const v = (m.u8(cur + 0x3b) - (m.s16(FRAME_TICKS) >> 5)) & 0xff;
  m.set8(cur + 0x3b, v > 0x55 ? 0 : v);
}

// 0:7ba8 message(kind, msg): 8 marks it hit (+0x37); always 1.
export function expMessage(m: Memory, kind: number, _msg: number): number {
  if ((kind & 0xff) === 8) m.set8(m.u16(RECEIVER) + 0x37, 1);
  return 1;
}

// 0:7bf5 post(): 12cc:0522.
export function expPost(m: Memory): void {
  call(m, "12cc:0522");
}

// 0:7bfb draw()
export function expDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

// 0:7c0a init(record, object): +0x36 = record byte 3, +0x83 word = 0x2bc, +0xd5 = 1.
export function expInit(m: Memory, record: number, obj: number): void {
  m.set8(obj + 0x36, m.u8(record + 3));
  m.set16(obj + 0x83, 0x2bc);
  m.set8(obj + 0xd5, 1);
}

register("0:7b44", expUpdate);
register("0:7ba8", expMessage);
register("0:7bf5", expPost);
register("0:7bfb", expDraw);
register("0:7c0a", expInit);
