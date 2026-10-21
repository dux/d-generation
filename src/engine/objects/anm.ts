import { call, register } from "../dispatch.ts";
import { loadFrontShapes } from "../core/display.ts";
import { drawToFront, restoreDrawTarget } from "../geometry/draw.ts";
import type { Memory } from "../memory.ts";
import { playSound } from "../misc/sound.ts";
import { DRAW_OBJECT, FRAME_TICKS, UPDATE_OBJECT } from "../props/common.ts";

// Class 25, ANM.VGA: drops from height +0x0c (8.8 at +0x0b) after the +0x85 delay, accelerating by +0x11;
// landing shakes the screen (DS:5f6c) and sets +0x87.

const SHAKE = 0x5f6c;

// 0:a2fb init(record, object): front bank set 3, height 0x78, delay 0x2800.
export function anmInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x18, 1);
  loadFrontShapes(m, 3);
  m.set8(obj + 0xc, 0x78);
  m.set16(obj + 0x85, 0x2800);
}

// 0:a31e update(): run the delay, then fall: speed += ticks / 4, height -= ticks * speed * 3 / 256.
export function anmUpdate(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u16(obj + 0x85) !== 0) {
    const t = (m.u16(obj + 0x85) - m.u16(FRAME_TICKS)) & 0xffff;
    m.set16(obj + 0x85, t & 0x8000 ? 0 : t);
    return;
  }
  if (m.u8(obj + 0xc) === 0) return;
  m.set16(obj + 0x11, m.u16(obj + 0x11) + (m.s16(FRAME_TICKS) >> 2));
  const drop = Math.imul(m.s16(FRAME_TICKS) * m.s16(obj + 0x11), 3) >> 8;
  const cur = m.u16(UPDATE_OBJECT);
  m.set16(cur + 0xb, m.u16(cur + 0xb) - drop);
  if (m.u8(cur + 0xc) <= 0x7f) return;
  m.set16(cur + 0xb, 0);
  playSound(m, 0x1e1e);
  m.set16(SHAKE, 0x800);
  m.set8(m.u16(UPDATE_OBJECT) + 0x87, 1);
}

// 0:a3bd message(msg, arg): every message is accepted (1).
export function anmMessage(_m: Memory, _msg: number, _arg: number): number {
  return 1;
}

// 0:a3c1 post-update(): 12cc:191d.
export function anmPostUpdate(m: Memory): void {
  call(m, "12cc:191d");
}

// 0:a3c7 draw(): layers 1 then 0 into the front buffer.
export function anmDraw(m: Memory): void {
  drawToFront(m);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 1);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
  restoreDrawTarget(m);
}

register("0:a2fb", anmInit);
register("0:a31e", anmUpdate);
register("0:a3bd", anmMessage);
register("0:a3c1", anmPostUpdate);
register("0:a3c7", anmDraw);
