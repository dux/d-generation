import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { RECEIVER, SENDER } from "../props/common.ts";

// Class 1: invisible marker placed next to survivors (class 9). +0x83 = record byte 3 (kind), +0x84 = closed
// (kind 4). A survivor touching an open marker gets +0x8d set.

// 0:81ed init(record, object).
export function class1Init(m: Memory, record: number, obj: number): void {
  m.set8(obj + 0x16, 0);
  m.set8(obj + 0x13, 0);
  const kind = m.u8(record + 3);
  m.set8(obj + 0x83, kind);
  if (kind === 4) m.set8(obj + 0x84, 1);
  m.set8(obj + 0x18, 1);
}

// 0:821a store(object, record): record byte 3 = kind, then the common fields (0:4642).
export function class1Store(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, m.u8(obj + 0x83));
  call(m, "0:4642", obj, record);
}

// 0:8238 update(): nothing.
export function class1Update(_m: Memory): void {}

// 0:8285 class1Touched(): a survivor (class 9) touching an open marker gets +0x8d = 1.
export function class1Touched(m: Memory): void {
  if (m.u8(m.u16(SENDER) + 2) !== 9) return;
  if (m.u8(m.u16(RECEIVER) + 0x84)) return;
  m.set8(m.u16(SENDER) + 0x8d, 1);
}

// 0:8239 message(msg, arg): handles 6 (touch); always 1.
export function class1Message(m: Memory, msg: number, _arg: number): number {
  if ((msg & 0xff) === 6) class1Touched(m);
  return 1;
}

// 0:82a4 post-update(): nothing.
export function class1PostUpdate(_m: Memory): void {}

// 0:82a5 draw(): nothing.
export function class1Draw(_m: Memory): void {}

register("0:81ed", class1Init);
register("0:821a", class1Store);
register("0:8238", class1Update);
register("0:8285", class1Touched);
register("0:8239", class1Message);
register("0:82a4", class1PostUpdate);
register("0:82a5", class1Draw);
