import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";

// Helpers shared by several object classes (doors, tracks, bars, the creatures of src/engine/objects).

export const UPDATE_OBJECT = 0x34b0; // object being updated (class slot +0x0a)
export const DRAW_OBJECT = 0x3360; // object being drawn (class slot +0x10)
export const POST_OBJECT = 0x546a; // object of the class slot +0x0e pass
export const RECEIVER = 0x546c; // object receiving a message (class slot +0x0c)
export const SENDER = 0x546e; // object that sent it
export const SPAWNED = 0x5468; // last object created by spawnProjectile
export const FRAME_TICKS = 0x3408; // time elapsed this frame, subtracted from the per-object timers
export const SCENE = 0x337e; // current scene number
export const RECORD_BYTE = 0x611f; // byte 3 of the record being loaded by an init slot
export const ROUND = 0x18f3; // value stamped into record byte 3 by objects that are used up
export const TEXT = 0x6144; // sprintf buffer for HUD messages
export const PLAYER = 0x3400; // the player object

// 0:6040 spawnProjectile(): create a shot of the current object's direction; 1 when it could not be placed.
export function spawnProjectile(m: Memory): number {
  let result = 0;
  const cur = m.u16(UPDATE_OBJECT);
  const shot = call(m, "0:59cd", m.s8(cur + 0x16) & 0xffff, 0xff83);
  m.set16(SPAWNED, shot);
  if (!shot) {
    call(m, "0:b5c3", 0x1a0a);
    return 1;
  }
  m.set16(shot + 0x3f, m.u16(cur));
  m.set8(shot + 0x83, m.u8(cur + 2));
  m.set8(shot + 0x16, 1);
  const hit = m.push(2);
  if (call(m, "fff:26c9", shot, hit)) {
    result = call(m, "0:d87f", m.u16(SPAWNED), m.s8(hit) & 0xffff);
  } else if (call(m, "0:d424", m.u16(SPAWNED), hit)) {
    call(m, "0:2656", m.u16(SPAWNED));
    call(m, "0:b5c3", 0x1a0a);
    result = 1;
  } else {
    const s = m.u16(SPAWNED);
    m.set8(s + 0x86, 0x10);
    m.set8(s + 0x3b, 0x55);
    m.set8(s + 0x85, 6);
    call(m, "0:b5c3", 0x1a26);
    if (m.u8(m.u16(UPDATE_OBJECT) + 2) === 0) m.set8(0x3365, m.u8(0x3365) - 1);
  }
  m.pop(2);
  return result & 0xffff;
}

// 0:6114 setFacing(dir): set the current object's facing (+0x16, +0x13); flag a redraw (+6 = 1) when it changes.
export function setFacing(m: Memory, dir: number): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (m.u8(cur + 0x16) !== (dir & 0xff)) m.set8(cur + 6, 1);
  m.set8(cur + 0x16, dir);
  m.set8(cur + 0x13, dir);
}

// 0:6134 walkStep(): move the current object along its path (0:3e5f mode 7, 0:54f3) and re-path when it arrives.
export function walkStep(m: Memory): void {
  const local = m.push(4);
  call(m, "0:3e5f", local + 2, local, 7);
  call(m, "0:54f3", m.u16(UPDATE_OBJECT), m.u16(local + 2), m.u16(local));
  m.pop(4);
  const cur = m.u16(UPDATE_OBJECT);
  if (m.u8(cur + 0x87)) {
    m.set8(cur + 0x87, 0);
    call(m, "0:4979", cur);
    m.set8(cur + 0x16, m.u8(cur + 0x13));
  }
}

// 0:617f clearTargetIfReached(): forget the target cell (+0x89, +0x8a) once within 2 of it on both axes.
export function clearTargetIfReached(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (Math.abs(m.u8(cur + 8) - m.u8(cur + 0x89)) >= 2) return;
  if (Math.abs(m.u8(cur + 0xa) - m.u8(cur + 0x8a)) >= 2) return;
  m.set8(cur + 0x8a, 0);
  m.set8(cur + 0x89, 0);
}

// 0:6f77 drift(): move the current object along its path (0:3e5f mode 5) without re-pathing.
export function drift(m: Memory): void {
  const local = m.push(4);
  call(m, "0:3e5f", local + 2, local, 5);
  m.pop(4);
}

// 0:7145 turnToMessage(msg): receiver facing (+0x13) = message byte 4; handled (-1).
export function turnToMessage(m: Memory, msg: number): number {
  m.set8(m.u16(RECEIVER) + 0x13, m.u8(msg + 4));
  return 0xffff;
}

const SWITCH_GROUP = 0x61d0; // group (+0x3e) of the doors/tracks to message
const SWITCH_ARG = 0x61d1;
const SWITCH_HANDLED = 0x61d2;

// 0:7d8f signalGroup(group, arg): send message 4 with arg to every door or track (class 2, 10) of the group;
// 1 when one of them reacted.
export function signalGroup(m: Memory, group: number, arg: number): number {
  m.set8(SWITCH_GROUP, group);
  m.set8(SWITCH_ARG, arg);
  m.set8(SWITCH_HANDLED, 0);
  call(m, "0:1811", 0x7db3);
  return m.s8(SWITCH_HANDLED) & 0xffff;
}

// 0:7db3 for-each callback of signalGroup.
export function signalGroupVisit(m: Memory, obj: number): number {
  const cls = m.u8(obj + 2);
  if ((cls === 2 || cls === 0xa) && m.u8(obj + 0x3e) === m.u8(SWITCH_GROUP)) {
    const msg = m.push(0xe);
    m.set16(msg + 2, obj);
    m.set8(msg + 0xd, m.u8(SWITCH_ARG));
    if (call(m, "0:2c71", 4, msg)) m.set8(SWITCH_HANDLED, 1);
    m.pop(0xe);
  }
  return 0;
}

// 0:67c8 applySwitch(state*, value): value 1 toggles *state (xor 0xff); otherwise sets it. 0 when nothing changed.
export function applySwitch(m: Memory, state: number, value: number): number {
  const v = value & 0xff;
  if (v === 1) {
    m.set8(state, m.s8(state) ^ 0xff);
    return 1;
  }
  if (m.u8(state) !== v) {
    m.set8(state, v);
    return 1;
  }
  return 0;
}

register("0:6040", spawnProjectile);
register("0:6114", setFacing);
register("0:6134", walkStep);
register("0:617f", clearTargetIfReached);
register("0:6f77", drift);
register("0:7145", turnToMessage);
register("0:7d8f", signalGroup);
register("0:7db3", signalGroupVisit);
register("0:67c8", applySwitch);
