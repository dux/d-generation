import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT } from "../props/common.ts";

// Class 12, DEC.VGA: static decoration.

// 0:a184 init(record, object).
export function decInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x18, 1);
}

// 0:a192 update(): nothing.
export function decUpdate(_m: Memory): void {}

// 0:a193 message(msg, arg): every message is accepted (1).
export function decMessage(_m: Memory, _msg: number, _arg: number): number {
  return 1;
}

// 0:a197 post-update(): 12cc:174e.
export function decPostUpdate(m: Memory): void {
  call(m, "12cc:174e");
}

// 0:a19d draw().
export function decDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

register("0:a184", decInit);
register("0:a192", decUpdate);
register("0:a193", decMessage);
register("0:a197", decPostUpdate);
register("0:a19d", decDraw);
