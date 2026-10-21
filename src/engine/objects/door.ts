import { call, register } from "../dispatch.ts";
import { drawToPanel, restoreDrawTarget } from "../geometry/draw.ts";
import { placeParts, writePathA } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, POST_OBJECT, RECEIVER, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { swapDoorSave } from "../props/doorsave.ts";
import { applySwitch } from "../props/common.ts";

// Class 2, DOOR: sliding door blocking a grid cell. +0x36 = side (0..3), +0x3e = switch group (7 = none),
// +0x83 = open (0xff closed by a switch at load), +0x84 = closing, +0x85 = slide from the other side,
// +0x86/+0x87 = has a screen save slot / slot index, +0x88 = needs redraw, +0x89 = blown open, +6 = slide step 0..5.

const OBJECT_LIST = 0x33ac;
const DOOR_SLOTS = 0x61a8;
const STEP_FRAMES = 0x7fa; // frame per slide step
const SIDE_SHIFT = 0x7f6;
const FACING_DX = 0x7f2;
const FACING_DY = 0x7f4;
const BACK_BUFFER = 0x27cc;

// 0:6627 update()
export function doorUpdate(m: Memory): void {
  doorClose(m);
}

// 0:662b doorClose(): a closing door takes its cell back once nothing stands in it (0:dcfc), else stays open.
export function doorClose(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x84)) return;
  call(m, "0:dbda", m.u16(cur + 0x3c), 0xff);
  if (call(m, "0:dcfc")) {
    call(m, "0:dbda", m.u16(m.u16(UPDATE_OBJECT) + 0x3c), 0);
    return;
  }
  const d = m.u16(UPDATE_OBJECT);
  m.set8(d + 0x83, 1);
  m.set8(d + 0x84, 0);
  m.set8(d + 0x88, 1);
  m.set8(d + 6, 0);
}

// 0:6675 message(kind, msg): 0 = touched, 2 = 0:4242, 3 = 0:44e4, 4 = switch, 9 = shot.
export function doorMessage(m: Memory, kind: number, msg: number): number {
  switch ((kind << 24) >> 24) {
    case 0:
      return doorTouched(m, msg);
    case 2:
      return call(m, "0:4242", msg);
    case 3:
      return call(m, "0:44e4", msg);
    case 4:
      return doorSwitch(m, msg);
    case 9:
      return doorShot(m, msg);
    default:
      return 0;
  }
}

// 0:66dd doorShot(msg): a closed door hit by an ART shot (class 11) is blown open for good.
export function doorShot(m: Memory, _msg: number): number {
  if (m.u8(m.u16(SENDER) + 2) !== 0xb) return 0;
  let r = m.u16(RECEIVER);
  if (!m.u8(r + 0x83) || m.u8(r + 0x89)) return 0;
  call(m, "0:42bd", r, 1, 0, 0);
  r = m.u16(RECEIVER);
  m.set8(r + 3, 0);
  m.set8(r + 6, 0);
  m.set8(r + 0x83, 0);
  m.set8(r + 0x89, 1);
  m.set8(r + 0x88, 1);
  return call(m, "0:dbda", m.u16(r + 0x3c), 0);
}

// 0:6732 doorTouched(msg): blocks (-1).
export function doorTouched(_m: Memory, _msg: number): number {
  return 0xffff;
}

// 0:6736 doorSwitch(msg): msg byte 0xd = 0 close, 1 toggle, 0xff open; 1 when the door changed.
export function doorSwitch(m: Memory, msg: number): number {
  let r = m.u16(RECEIVER);
  if (m.u8(r + 0x89)) return 0;
  const state = m.push(2);
  m.set8(state + 1, m.u8(r + 0x83) || m.u8(r + 0x84) ? 0xff : 0);
  const changed = applySwitch(m, state + 1, m.s8(msg + 0xd) & 0xffff);
  const open = m.u8(state + 1);
  m.pop(2);
  if (!changed) return 0;
  r = m.u16(RECEIVER);
  m.set8(r + 0x85, 1);
  m.set8(r + 0x88, 1);
  if (open) {
    m.set8(r + 0x84, 1);
  } else {
    m.set8(r + 0x83, 0);
    m.set8(r + 0x84, 0);
    call(m, "0:dbda", m.u16(r + 0x3c), 0);
    m.set8(m.u16(RECEIVER) + 6, 3);
  }
  return 1;
}

// 0:6803 post(): step the slide animation and pick the frame for the door's side and facing.
export function doorPost(m: Memory): void {
  call(m, "0:4505", m.u16(POST_OBJECT), 0);
  drawToPanel(m);
  let step = doorStep(m, m.s8(m.u16(POST_OBJECT) + 0x83) & 0xffff);
  let d = m.u16(POST_OBJECT);
  m.set8(d + 0x82, step === 0 ? 1 : 0);
  if (m.u8(d + 0x89)) step = 4;
  let side: number;
  if (m.u8(d + 0x85)) {
    side = (m.s8(d + 0x36) ^ 3) & 3;
    m.set8(d + 0x85, 0);
  } else {
    side = m.s8(d + 0x36) & 3;
  }
  const shapes = m.u16(d + 4);
  m.set8(d + 0xd1, m.s8(SIDE_SHIFT + side) << 2);
  const set = m.u16(shapes);
  const facing = m.s8(d + 0x16);
  const frames = m.u16((set + ((facing >> 1) << 1)) & 0xffff);
  m.set16(d + 0x1d, m.u16((frames + step * 2) & 0xffff));
  m.set16(d + 0x29, m.s8(FACING_DX + ((facing >> 1) & 1)));
  m.set16(d + 0x2f, m.s8(FACING_DY + ((facing >> 1) & 1)) - 1);
  placeParts(m, d);
  restoreDrawTarget(m);
  d = m.u16(POST_OBJECT);
  if (m.s8(d + 6) >= 3) call(m, "0:4505", d, 0xff);
  if (m.u8(m.u16(POST_OBJECT) + 0x88)) redrawNeighbours(m);
}

// 0:6929 redrawNeighbours(): flag doors just in front of the current one for redraw (they overlap on screen).
export function redrawNeighbours(m: Memory): void {
  call(m, "0:1811", 0x6932);
}

// 0:6932 for-each callback of redrawNeighbours.
export function redrawNeighbourVisit(m: Memory, obj: number): number {
  const d = m.u16(POST_OBJECT);
  if (m.u8(obj + 2) !== 2 || obj === d) return 0;
  const dy = m.u8(d + 0xa) - m.u8(obj + 0xa);
  if (dy >= 0x1e || dy <= 0) return 0;
  const dx = m.u8(d + 8) - m.u8(obj + 8);
  if (dx >= 0x14 || dx <= -0x14) return 0;
  m.set8(obj + 0x88, 1);
  return 0;
}

// 0:6994 draw(): only when flagged; doors with a save slot first restore/save the screen behind them and draw
// into the second buffer.
export function doorDraw(m: Memory): void {
  let d = m.u16(DRAW_OBJECT);
  if (!m.u8(d + 0x88)) return;
  drawToPanel(m);
  call(m, "0:4505", m.u16(DRAW_OBJECT), 0);
  d = m.u16(DRAW_OBJECT);
  let saved = 0;
  if (m.u8(d + 0x86)) {
    swapDoorSave(m, d);
    saved = m.u16(BACK_BUFFER);
    m.set16(BACK_BUFFER, m.u16(BACK_BUFFER + 2));
  }
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
  d = m.u16(DRAW_OBJECT);
  if (m.u8(d + 0x86)) {
    m.set16(BACK_BUFFER, saved);
    m.set8(d + 0x8a, 1);
  }
  if (m.s8(d + 6) >= 3) call(m, "0:4505", d, 0xff);
  restoreDrawTarget(m);
}

// 0:6a37 doorStep(open): move the slide step one towards open (5) or closed (0); returns its frame index.
export function doorStep(m: Memory, open: number): number {
  const d = m.u16(POST_OBJECT);
  let step = m.s8(d + 6);
  if (open & 0xff) {
    if (step < 5) {
      step++;
      m.set8(d + 0x88, 1);
    }
  } else if (step) {
    step--;
    m.set8(d + 0x88, 1);
  }
  m.set8(d + 6, step);
  return m.s8((STEP_FRAMES + step) & 0xffff) & 0xffff;
}

// 0:6a71 save(object, record): record byte 3 = side | group << 2 | 0x20 closed | 0x80 blown open.
export function doorSave(m: Memory, obj: number, record: number): void {
  const v = (m.s8(obj + 0x3e) << 2) | m.s8(obj + 0x36) | (m.u8(obj + 0x83) ? 0 : 0x20) | (m.u8(obj + 0x89) ? 0x80 : 0);
  m.set8(record + 3, v);
  call(m, "0:4642", obj, record);
}

// 0:6abb init(record, object): record byte 3 as written by save; 0x60 = starts open.
export function doorInit(m: Memory, record: number, obj: number): void {
  call(m, "0:dd61", obj);
  writePathA(m, obj);
  const b = m.u8(record + 3);
  m.set8(obj + 0x36, b & 3);
  m.set8(obj + 0x3e, (((b << 24) >> 24) >> 2) & 7);
  m.set8(obj + 9, 0);
  m.set8(obj + 7, 0);
  if (m.u8(obj + 0x36) === 3) m.set8(obj + 0x36, 2);
  if (m.u8(obj + 0x3e) === 7) m.set8(obj + 0x36, 3);
  if (m.u8(record + 3) & 0x80) {
    m.set8(obj + 0x89, 1);
    m.set8(obj + 0x18, 1);
  }
  if (m.u8(record + 3) & 0x60) {
    m.set8(obj + 0x83, 0);
    m.set8(obj + 0x18, 1);
  } else {
    call(m, "0:dbda", m.u16(obj + 0x3c), 0xff);
    m.set8(obj + 6, 4);
    m.set8(obj + 0x83, 0xff);
    call(m, "0:4505", obj, 0xff);
  }
  const slot = m.s8(DOOR_SLOTS);
  if (slot < 4) {
    m.set8(obj + 0x86, 1);
    m.set8(obj + 0x87, slot);
    m.set8(DOOR_SLOTS, slot + 1);
  } else {
    m.set8(obj + 0x86, 0);
  }
  m.set8(obj + 0x88, 1);
}

// 0:6b96 resetDoors(): 0:4505(door, 0) for every door in the object list.
export function resetDoors(m: Memory): void {
  for (let i = 0; i < 0x1e; i++) {
    const o = m.u16(OBJECT_LIST + i * 2);
    if (o && m.u8(o + 2) === 2) call(m, "0:4505", o, 0);
  }
}

register("0:6627", doorUpdate);
register("0:662b", doorClose);
register("0:6675", doorMessage);
register("0:66dd", doorShot);
register("0:6732", doorTouched);
register("0:6736", doorSwitch);
register("0:6803", doorPost);
register("0:6929", redrawNeighbours);
register("0:6932", redrawNeighbourVisit);
register("0:6994", doorDraw);
register("0:6a37", doorStep);
register("0:6a71", doorSave);
register("0:6abb", doorInit);
register("0:6b96", resetDoors);
