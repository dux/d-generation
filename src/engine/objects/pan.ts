import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, RECEIVER, RECORD_BYTE, SCENE, SENDER, UPDATE_OBJECT } from "../props/common.ts";

// Class 14, PAN.VGA: floor panel that is live during part of an 8-step cycle and hurts what stands on it.
// Record byte 3: bits 0-2 = step it turns on (+0x85), bits 3-5 = step it turns off (+0x86), bits 6-7 = speed
// index (+0x89). +0x87 current step, +0x88 live, +0x83 step timer, +0x8a step length (high byte).

const STEP_LENGTHS = 0x096a; // signed bytes per speed index, shortened by one per 100 scenes

// 0:82aa panStep(): advances the cycle when the step timer runs out; switches the panel on (redraw, 0:d7e0) or off.
export function panStep(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  const left = (m.u16(obj + 0x83) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0x83, left);
  if (!(left & 0x8000)) return;
  m.set16(obj + 0x83, left + (m.u8(obj + 0x8a) << 8));
  let step = (m.u8(obj + 0x87) + 1) & 0xff;
  if (step === 8) step = 0;
  m.set8(obj + 0x87, step);
  if (m.u8(obj + 0x85) === step) {
    m.set8(obj + 0x88, 1);
    m.set8(obj + 6, 0);
    call(m, "0:d7e0", obj);
  } else if (m.u8(obj + 0x86) === step) {
    m.set8(obj + 0x88, 0);
  }
}

// 0:82a6 update().
export function panUpdate(m: Memory): void {
  panStep(m);
}

// 0:8359 panTouched(): a live panel sends message 9 to a toucher within distance 7 that is low enough
// (+0xc < 2); unless the toucher is class 6, 15 or 11 the step timer is reset to 0x2800.
export function panTouched(m: Memory): number {
  const self = m.u16(RECEIVER);
  if (!m.u8(self + 0x88)) return 0;
  if (((call(m, "0:478e", self, m.u16(SENDER)) << 16) >> 16) >= 7) return 0;
  if (m.u8(m.u16(SENDER) + 0xc) >= 2) return 0;
  const pair = m.push(4);
  m.set16(pair, self);
  m.set16(pair + 2, m.u16(SENDER));
  call(m, "0:2c71", 9, pair);
  m.pop(4);
  const cls = m.u8(m.u16(SENDER) + 2);
  if (cls !== 6 && cls !== 0xf && cls !== 0xb) m.set16(m.u16(RECEIVER) + 0x83, 0x2800);
  return 0;
}

// 0:830d message(msg, arg): 6 (touch) -> panTouched; result 0.
export function panMessage(m: Memory, msg: number, _arg: number): number {
  if ((msg & 0xff) === 6) return panTouched(m);
  return 0;
}

// 0:83c2 post-update(): 12cc:19cf.
export function panPostUpdate(m: Memory): void {
  call(m, "12cc:19cf");
}

// 0:83c8 draw().
export function panDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

// 0:83d7 init(record, object).
export function panInit(m: Memory, record: number, obj: number): void {
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x85, b & 7);
  const s = m.s8(RECORD_BYTE);
  m.set8(obj + 0x86, (s >> 3) & 7);
  const speed = (s >> 6) & 3;
  m.set8(obj + 0x89, speed);
  m.set8(obj + 0x8a, m.s8(STEP_LENGTHS + speed) - Math.trunc(m.u8(SCENE) / 100));
  m.set16(obj + 0x83, 0);
  m.set8(obj + 0x87, 7);
  m.set8(obj + 0x18, 1);
}

// 0:8442 store(object, record): record byte 3 from the cycle fields, then the common fields (0:4642).
export function panStore(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, m.s8(obj + 0x85) | (m.s8(obj + 0x86) << 3) | (m.s8(obj + 0x89) << 6));
  call(m, "0:4642", obj, record);
}

register("0:82aa", panStep);
register("0:82a6", panUpdate);
register("0:8359", panTouched);
register("0:830d", panMessage);
register("0:83c2", panPostUpdate);
register("0:83c8", panDraw);
register("0:83d7", panInit);
register("0:8442", panStore);
