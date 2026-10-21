import { call, register } from "../dispatch.ts";
import { drawPart, placeParts, updateBox } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, PLAYER, POST_OBJECT, UPDATE_OBJECT } from "../props/common.ts";

// Class 23, SLI/SPK: the courier sled of the opening scene. It waits (+0x8e timer), slides in leaving a trail
// drawn into both screen buffers (+0x83 = arriving, +0x86 trail segments, +0x94 = stopped), then after the next
// wait drives off (+0x88 step count, +0x92 = sinking, +0x93 = gone).

const BACK_BUFFER = 0x27cc;
const FRONT_BUFFER = 0x27ca;
const TARGET_BUFFER = 0x27ce;
const EGA_TARGET = 0x282b;
const EGA_FRONT = 0x2829;
const STEP = 0x26; // timer units per movement step

// 0:6c33 update()
export function sliUpdate(m: Memory): void {
  sliArrive(m);
  sliLeave(m);
}

// 0:6c3a sliArrive(): slide in from the stored start (+0x8a/+0x8c) one step per 0x26 ticks; stop after 50 steps.
export function sliArrive(m: Memory): void {
  let c = m.u16(UPDATE_OBJECT);
  if (!m.u8(c + 0x83)) return;
  if (m.s16(c + 0x8e) > 0) {
    m.set16(c + 0x8e, m.u16(c + 0x8e) - m.u16(FRAME_TICKS));
    return;
  }
  m.set16(c + 0x86, 0);
  m.set16(c + 0x84, m.u16(c + 0x84) + m.u16(FRAME_TICKS));
  m.set16(c + 7, m.u16(c + 0x8a));
  m.set16(c + 9, m.u16(c + 0x8c));
  updateBox(m, c);
  for (;;) {
    c = m.u16(UPDATE_OBJECT);
    if (m.s16(c + 0x84) <= STEP) return;
    m.set16(c + 0x84, m.u16(c + 0x84) - STEP);
    m.set16(c + 0x88, m.u16(c + 0x88) + 1);
    if (m.u16(c + 0x88) === 0x31) {
      m.set16(c + 0x84, 0);
      m.set8(c + 0x94, 1);
      call(m, "0:b5c3", 0x1c56);
    }
    c = m.u16(UPDATE_OBJECT);
    if (m.u16(c + 0x88) === 0x32) {
      m.set8(c + 0x83, 0);
      m.set16(c + 0x8e, 0x3700);
      m.set16(c + 0x88, 0);
      m.set16(c + 7, 0x3c00);
      m.set16(c + 9, 0x4500);
      updateBox(m, c);
      return;
    }
    c = m.u16(UPDATE_OBJECT);
    m.set16(c + 0x86, m.u16(c + 0x86) + 1);
    m.set16(c + 0x8a, m.u16(c + 0x8a) + 0x280);
    m.set8(c + 0x8d, m.u8(c + 0x8d) + 1);
  }
}

// 0:6cf1 sliLeave(): after the wait drive off diagonally; sinks (+0xb) once +0x92 is set, gone at height 0.
export function sliLeave(m: Memory): void {
  let c = m.u16(UPDATE_OBJECT);
  if (m.u8(c + 0x83) || m.u8(c + 0x93)) return;
  if (m.s16(c + 0x8e) > 0) {
    m.set16(c + 0x8e, m.u16(c + 0x8e) - m.u16(FRAME_TICKS));
    return;
  }
  m.set16(c + 0x84, m.u16(c + 0x84) + m.u16(FRAME_TICKS));
  for (;;) {
    c = m.u16(UPDATE_OBJECT);
    if (m.s16(c + 0x84) <= STEP) return;
    m.set16(c + 0x84, m.u16(c + 0x84) - STEP);
    const steps = m.u16(c + 0x88);
    m.set16(c + 0x88, steps + 1);
    if (steps === 0x87) {
      m.set8(c + 0x92, 1);
      return;
    }
    if (m.u8(c + 0xc) < 1) {
      m.set8(c + 0x93, 1);
      m.set16(c + 0x90, 0);
      m.set8(c + 6, 0);
      call(m, "0:b5c3", 0x1c4e);
    } else {
      c = m.u16(UPDATE_OBJECT);
      if (m.u8(c + 0x92)) m.set16(c + 0xb, m.u16(c + 0xb) - m.u16(FRAME_TICKS));
    }
    c = m.u16(UPDATE_OBJECT);
    m.set16(c + 7, m.u16(c + 7) + 0xa0);
    m.set16(c + 9, m.u16(c + 9) + 0x40);
    updateBox(m, c);
  }
}

// 0:6d90 message(kind, msg): always 1.
export function sliMessage(_m: Memory, _kind: number, _msg: number): number {
  return 1;
}

// 0:6dd5 post(): 12cc:09f0, place parts; with record byte 3 set, put the player next to the sled.
export function sliPost(m: Memory): void {
  call(m, "12cc:09f0");
  placeParts(m, m.u16(POST_OBJECT));
  const s = m.u16(POST_OBJECT);
  if (!m.u8(s + 3)) return;
  m.set8(0x3368, m.u8(s + 8));
  m.set8(0x3369, m.u8(s + 0xa) + 6);
  m.set8(0x336a, 3);
  call(m, "0:1fa2");
  call(m, "0:1fb7");
  m.set16(PLAYER, call(m, "0:2770"));
}

// 0:6e0e draw(): nothing while waiting; the trail while arriving, else the plain object.
export function sliDraw(m: Memory): void {
  const d = m.u16(DRAW_OBJECT);
  if (m.s16(d + 0x8e) > 0) return;
  if (m.u8(d + 0x83)) sliDrawTrail(m);
  else call(m, "0:3f81", d, 0);
}

// Part drawn into the front buffer, the target buffer and the current back buffer (so it stays as a trail).
function drawEverywhere(m: Memory, part: number, back: number, ega: number): void {
  m.set16(BACK_BUFFER, m.u16(FRONT_BUFFER));
  if (m.u16(0x2e5e)) m.set16(EGA_TARGET, m.u16(EGA_FRONT));
  drawPart(m, m.u16(DRAW_OBJECT), part);
  const target = m.u16(TARGET_BUFFER);
  m.set16(BACK_BUFFER, target);
  m.set16(EGA_TARGET, target);
  drawPart(m, m.u16(DRAW_OBJECT), part);
  m.set16(BACK_BUFFER, back);
  m.set16(EGA_TARGET, ega);
  drawPart(m, m.u16(DRAW_OBJECT), part);
}

// 0:6e34 sliDrawTrail(): draw part 0 at every trail step (+0x86 left, 5 px right and 1 down each), then the
// stopped sled's part 1.
export function sliDrawTrail(m: Memory): void {
  const back = m.u16(BACK_BUFFER);
  const ega = m.u16(EGA_TARGET);
  for (;;) {
    let d = m.u16(DRAW_OBJECT);
    if (m.s16(d + 0x86) < 0) break;
    m.set16(d + 0x86, m.u16(d + 0x86) - 1);
    if (!m.u16(0x2f0a)) drawEverywhere(m, 0, back, ega);
    d = m.u16(DRAW_OBJECT);
    m.set16(d + 0x71, m.u16(d + 0x71) + 5);
    m.set16(d + 0x77, m.u16(d + 0x77) + 1);
  }
  const d = m.u16(DRAW_OBJECT);
  if (!m.u8(d + 0x94)) return;
  m.set16(d + 0x73, m.u16(d + 0x71) - 4);
  m.set16(d + 0x79, m.u16(d + 0x77) - 3);
  if (!m.u16(0x2f0a)) drawEverywhere(m, 1, back, ega);
}

// 0:6f3f init(record, object): arriving, waits 0x3200 ticks, start position kept in +0x8a/+0x8c.
export function sliInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x83, 1);
  m.set8(obj + 0x18, 1);
  m.set8(obj + 0xc, 0x12);
  m.set16(obj + 0x8a, m.u16(obj + 7));
  m.set16(obj + 0x8c, m.u16(obj + 9));
  m.set16(obj + 0x8e, 0x3200);
}

register("0:6c33", sliUpdate);
register("0:6c3a", sliArrive);
register("0:6cf1", sliLeave);
register("0:6d90", sliMessage);
register("0:6dd5", sliPost);
register("0:6e0e", sliDraw);
register("0:6e34", sliDrawTrail);
register("0:6f3f", sliInit);
