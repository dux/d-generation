import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, RECEIVER, RECORD_BYTE, ROUND, SCENE, SENDER, TEXT, UPDATE_OBJECT } from "../props/common.ts";
import { sprintf } from "../runtime.ts";

// Class 18, LIFT: the elevator between floors. +0x83 = arrival lift (the player steps out of it), +0x84 = running,
// +0x89 = destination floor, +0x8a word = ride timer (8.8, high byte at +0x8b), +0x8c/+0x8d = clip rows for the
// cabin, +0x8e = doors open.

const CLIP_BOTTOM = 0x3a7e;
const CLIP_TOP = 0x5f60;

// 0:61c7 update()
export function liftUpdate(m: Memory): void {
  liftTick(m);
  liftArrive(m);
  liftDepart(m);
}

// 0:61d1 liftDepart(): after 30 ticks a departing lift loads the destination scene (floor * 50 + level - 1;
// level 1 is 50 higher).
export function liftDepart(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x84) || m.u8(cur + 0x83) || m.s8(cur + 0x8b) < 0x1e) return;
  const floor = (m.u8(SCENE) / 50) | 0;
  let scene = floor * 50 + m.s8(cur + 0x89) - 1;
  if (m.u8(cur + 0x89) === 1) scene += 0x32;
  call(m, "0:481a", scene & 0xff);
}

// 0:6231 liftArrive(): an arriving lift opens after 2 ticks and places the player in front of it.
export function liftArrive(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x84) || !m.u8(cur + 0x83)) return;
  if (m.s8(cur + 0x8b) < 2) {
    m.set8(cur + 0x8e, 0);
    return;
  }
  m.set8(cur + 0x84, 0);
  m.set8(cur + 0x8e, 1);
  m.set16(cur + 0x87, 0);
  m.set8(cur + 6, 0);
  const x = m.u8(cur + 8) + 1;
  m.set8(0x497, x);
  m.set8(0x3368, x);
  m.set8(0x498, m.u8(cur + 0xa));
  m.set8(0x3369, m.u8(cur + 0xa));
  m.set8(0x336a, 4);
  m.set16(0x3400, call(m, "0:2818", 0x496));
  call(m, "0:1fa2");
  call(m, "0:1fb7");
  call(m, "0:1e76");
}

// 0:6297 liftTick(): advance the ride timer while running.
export function liftTick(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (m.u8(cur + 0x84)) m.set16(cur + 0x8a, m.u16(cur + 0x8a) + m.u16(FRAME_TICKS));
}

// 0:62aa message(kind, msg): 5 = call the lift (arrival), 6 = the player steps in. Returns 0 (case 5 leaves the
// caller's BX in AX; callers ignore it).
export function liftMessage(m: Memory, kind: number, _msg: number): number {
  const k = (kind << 24) >> 24;
  if (k === 5) {
    liftCall(m);
    return 0;
  }
  if (k === 6) liftEnter(m);
  return 0;
}

// 0:62f5 liftCall(): start the arrival sequence.
export function liftCall(m: Memory): void {
  const r = m.u16(RECEIVER);
  m.set8(r + 0x84, 1);
  m.set8(r + 0x8b, 0xf1);
}

// 0:6304 liftEnter(): the player used a departure lift: consume the record and show the floor message.
export function liftEnter(m: Memory): void {
  let r = m.u16(RECEIVER);
  if (m.u8(r + 0x83)) return;
  const s = m.u16(SENDER);
  if (m.u8(s + 2)) return;
  m.set8(s + 3, m.u8(ROUND));
  r = m.u16(RECEIVER);
  m.set8(r + 0x84, 1);
  sprintf(m, TEXT, 0x7ce, (m.s8(0x3364) + 1) & 0xffff);
  call(m, "0:cff8", TEXT, 3, 0x5c);
  call(m, "0:b5c3", 0x1c6e);
}

// 0:6357 post(): 12cc:0355.
export function liftPost(m: Memory): void {
  call(m, "12cc:0355");
}

// 0:635d draw(): frame, then the cabin clipped to +0x8c (arrival) or below +0x8d, then the front parts.
export function liftDraw(m: Memory): void {
  const bottom = m.u8(CLIP_BOTTOM);
  const top = m.u8(CLIP_TOP);
  let obj = m.u16(DRAW_OBJECT);
  const shade = m.u8(obj + 0xca);
  m.set8(obj + 0xca, 0);
  call(m, "0:3f81", obj, 0);
  obj = m.u16(DRAW_OBJECT);
  if (m.u8(obj + 0x83)) m.set16(CLIP_BOTTOM, m.u8(obj + 0x8c));
  else m.set16(CLIP_TOP, m.u8(obj + 0x8d));
  m.set8(obj + 0xca, shade);
  call(m, "0:3f81", obj, 1);
  m.set16(CLIP_BOTTOM, bottom);
  m.set16(CLIP_TOP, top);
  obj = m.u16(DRAW_OBJECT);
  m.set8(obj + 0xca, 0);
  call(m, "0:3f81", obj, 2);
  m.set8(m.u16(DRAW_OBJECT) + 0xca, shade);
}

// 0:63ee init(record, object): record byte 3 bit 0 = arrival lift, bits 1..5 = destination floor.
export function liftInit(m: Memory, record: number, obj: number): void {
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x16, 0);
  m.set8(obj + 0x89, ((b << 24) >> 25) & 0x1f);
  if (m.u8(SCENE) === 0x88) m.set8(obj + 0x89, 0x24);
  m.set8(obj + 0x18, 1);
  m.set8(obj + 7, 0x80);
  if (m.u8(RECORD_BYTE) & 1) {
    m.set8(obj + 0x8e, 1);
    m.set8(obj + 0x83, 1);
    m.set8(obj + 6, 4);
  }
}

// 0:643e save(object, record): write the arrival flag and floor back into record byte 3.
export function liftSave(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, (m.u8(obj + 0x83) ? 1 : 0) | (m.s8(obj + 0x89) << 1));
  call(m, "0:4642", obj, record);
}

register("0:61c7", liftUpdate);
register("0:61d1", liftDepart);
register("0:6231", liftArrive);
register("0:6297", liftTick);
register("0:62aa", liftMessage);
register("0:62f5", liftCall);
register("0:6304", liftEnter);
register("0:6357", liftPost);
register("0:635d", liftDraw);
register("0:63ee", liftInit);
register("0:643e", liftSave);
