import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, RECEIVER, RECORD_BYTE, SCENE, SENDER, UPDATE_OBJECT } from "../props/common.ts";

// Class 21, BAR: energy barrier on a patrol path; touching it zaps the toucher (message 9), shots break it.
// +0x83 = disturbed, +0x84/+0x85/+0x86 = home x, y, facing (restored when the room is left unsolved).

// 0:3d6e init(record, object): record byte 3 bits 0..2 = facing; colour shift by floor.
export function barInit(m: Memory, record: number, obj: number): void {
  call(m, "0:471d", obj, record);
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x13, b & 7);
  m.set8(obj + 0x16, b & 7);
  m.set8(obj + 0xc, 3);
  m.set8(obj + 0x3b, ((m.u8(SCENE) / 50) | 0) * 4 + 0x37);
  if (m.u8(SCENE) === 0x22) m.set8(obj + 0x3b, m.u8(obj + 0x3b) - 10);
  m.set8(obj + 0x17, 0x13);
  m.set8(obj + 0x84, m.u8(obj + 8));
  m.set8(obj + 0x85, m.u8(obj + 0xa));
  m.set8(obj + 0x86, m.u8(obj + 0x13));
}

// 0:3dd9 save(object, record): back to the home position unless 0:3e23(0x61c) says to keep it.
export function barSave(m: Memory, obj: number, record: number): void {
  if (!call(m, "0:3e23", 0x61c)) {
    m.set8(obj + 8, m.u8(obj + 0x84));
    m.set8(obj + 0xa, m.u8(obj + 0x85));
    m.set8(obj + 0x13, m.u8(obj + 0x86));
    m.set8(obj + 9, 0);
    m.set8(obj + 7, 0);
  }
  m.set8(record + 3, m.u8(obj + 0x13));
  call(m, "0:4693", obj, record);
}

// 0:6476 update()
export function barUpdate(m: Memory): void {
  barMove(m);
}

// 0:647a barMove(): follow the path; when blocked try to re-path (0:2a0b) with mode 7, then mode 1.
export function barMove(m: Memory): void {
  const local = m.push(4);
  const a = local + 2;
  const b = local;
  if (!call(m, "0:3e5f", a, b, 7)) {
    call(m, "0:2a0b", m.u16(UPDATE_OBJECT), a, b);
    if (!call(m, "0:3e95", a, b, 7)) {
      call(m, "0:2a0b", m.u16(UPDATE_OBJECT), a, b);
      call(m, "0:3e95", a, b, 1);
    }
  }
  m.pop(4);
}

// 0:64e6 message(kind, msg): 0 = touched, 2 = 0:4242, 8 = turned, 9 = shot.
export function barMessage(m: Memory, kind: number, msg: number): number {
  switch ((kind << 24) >> 24) {
    case 0:
      return barTouched(m, msg);
    case 2:
      return call(m, "0:4242", msg);
    case 8:
      return barTurned(m, msg);
    case 9:
      return barShot(m);
    default:
      return 0;
  }
}

// 0:6546 barTouched(msg): zap the toucher (message 9 from the bar) unless it is a lifted player (+0x91) or class
// 19..21; then the bar breaks too. -1 when handled.
export function barTouched(m: Memory, _msg: number): number {
  const s = m.u16(SENDER);
  const cls = m.u8(s + 2);
  if (cls === 0 && m.u8(s + 0x91)) return 0;
  if (cls === 0x13 || cls === 0x14 || cls === 0x15) return 0;
  const fwd = m.push(0x10);
  m.set16(fwd + 1, m.u16(RECEIVER));
  m.set16(fwd + 3, s);
  call(m, "0:2c71", 9, fwd + 1);
  m.pop(0x10);
  const r = m.u16(RECEIVER);
  m.set8(r + 0x83, 1);
  if (!m.u8(r + 3)) barShot(m);
  return 0xffff;
}

// 0:65ad barTurned(msg): face msg byte 4.
export function barTurned(m: Memory, msg: number): number {
  call(m, "0:c993", m.u16(m.u16(RECEIVER)));
  const r = m.u16(RECEIVER);
  m.set8(r + 0x16, m.u8(msg + 4));
  m.set8(r + 0x13, m.u8(msg + 4));
  m.set8(r + 0x83, 1);
  call(m, "0:b5c3", 0x1c36);
  return 0xffff;
}

// 0:65f3 barShot(): mark hit (+0x37); the first time, the bar breaks (0:42bd kind 2 in the shooter's direction).
export function barShot(m: Memory): number {
  const r = m.u16(RECEIVER);
  m.set8(r + 0x37, 1);
  if (m.u8(r + 3)) return 0;
  call(m, "0:b5c3", 0x1a4e);
  const s = m.u16(SENDER);
  return call(m, "0:42bd", m.u16(RECEIVER), 2, m.s8(s + 0x13) & 0xffff, m.u8(s + 0x3b));
}

// 0:65de post(): 12cc:18cd.
export function barPost(m: Memory): void {
  call(m, "12cc:18cd");
}

// 0:65e4 draw()
export function barDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

register("0:3d6e", barInit);
register("0:3dd9", barSave);
register("0:6476", barUpdate);
register("0:647a", barMove);
register("0:64e6", barMessage);
register("0:6546", barTouched);
register("0:65ad", barTurned);
register("0:65f3", barShot);
register("0:65de", barPost);
register("0:65e4", barDraw);
