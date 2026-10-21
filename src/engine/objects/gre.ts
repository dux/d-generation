import { enter, leave, moveCurrent, resolveMove, spawnFrom, teleportTo, alertSurveillance, drawObjectPart, writeRecord } from "../actors/helpers.ts";
import { CLASS_TABLE } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { updateBox } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { blocked, bumpObjects, collide } from "../misc/collide.ts";
import { DRAW_OBJECT, FRAME_TICKS, RECEIVER, RECORD_BYTE, ROUND, SCENE, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { sendMessage, step } from "../world/objects.ts";

// Class 19, GRE.VGA: grenade rolling along its facing. +0x84 parked (no movement this frame), +0x85 lifetime
// in frames (then +0x3f = -1), +0x37 hidden. In scene 0x89 it follows a fixed path instead: DS:6e6 holds
// (x, y) high-byte pairs, 0xff-terminated, +0x8a the index (path +0x89 starts at +0x89 * 14), +0x87 step timer.

const PATH = 0x6e6;

// 0:3cc4 init(record, object): record byte 3 = facing (bits 0-2) | hidden (bit 3) | path (bits 4-5); the speed
// grows with the scene number.
export function greInit(m: Memory, record: number, obj: number): void {
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x13, b & 7);
  m.set8(obj + 0x3a, (b & 7) << 3);
  const v = m.s8(RECORD_BYTE);
  if (v & 8) m.set8(obj + 0x37, 1);
  const path = (v >> 4) & 3;
  m.set8(obj + 0x89, path);
  m.set8(obj + 0x8a, path * 28);
  m.set8(obj + 0x16, 0);
  m.set8(obj + 0xc, 9);
  m.set8(obj + 0x3b, Math.floor(m.u8(SCENE) / 0x32) * 3 + 0x19);
  m.set8(obj + 0x17, 0x13);
  m.set8(obj + 0x84, 1);
  m.set8(obj + 7, 0x80);
  m.set8(obj + 9, 0x80);
}

// 0:3d40 save(object, record): record byte 3 = facing | hidden.
export function greSave(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, m.s8(obj + 0x13) | (m.u8(obj + 0x37) ? 8 : 0));
  writeRecord(m, obj, record);
}

// 0:5d78 update().
export function greUpdate(m: Memory): void {
  greRoll(m);
  if (m.u8(SCENE) === 0x89) {
    greFollowPath(m);
    return;
  }
  const obj = m.u16(UPDATE_OBJECT);
  m.set8(obj + 0x84, 0);
  if (!m.u8(obj + 0x85)) return;
  const left = (m.u8(obj + 0x85) - 1) & 0xff;
  m.set8(obj + 0x85, left);
  if (left === 0) m.set16(obj + 0x3f, 0xffff);
}

// 0:5db0 greFollowPath(): jump along the path once per 0xc8 of time, colliding at each point.
export function greFollowPath(m: Memory): void {
  const bp = enter(m, 4);
  let obj = m.u16(UPDATE_OBJECT);
  m.set8(obj + 0xc, 0);
  m.set16(obj + 0x87, m.u16(obj + 0x87) - m.u16(FRAME_TICKS));
  if (m.s16(obj + 0x87) <= 0) {
    do {
      obj = m.u16(UPDATE_OBJECT);
      const i = m.s8(obj + 0x8a);
      m.set8(obj + 8, m.u8(PATH + i * 2));
      m.set8(obj + 0xa, m.u8(PATH + 1 + i * 2));
      m.set8(obj + 0x8a, i + 1);
      if (m.u8(PATH + m.s8(obj + 0x8a) * 2) === 0xff) m.set8(obj + 0x8a, 0);
      updateBox(m, m.u16(UPDATE_OBJECT));
      if (blocked(m, m.u16(UPDATE_OBJECT), bp - 2)) collide(m, m.u16(UPDATE_OBJECT), m.s8(bp - 2) & 0xffff);
      obj = m.u16(UPDATE_OBJECT);
      m.set16(obj + 0x87, m.u16(obj + 0x87) + 0xc8);
    } while (m.s16(obj + 0x87) <= 0);
  }
  leave(m, 4);
}

// 0:5e66 greRoll(): unless parked, move along the facing (0:3e5f speed 7), retrying once after a step (0:2a0b).
export function greRoll(m: Memory): void {
  const bp = enter(m, 4);
  const dx = bp - 2;
  const dy = bp - 4;
  if (!m.u8(m.u16(UPDATE_OBJECT) + 0x84) && !moveCurrent(m, dx, dy, 7)) {
    step(m, m.u16(UPDATE_OBJECT), dx, dy);
    resolveMove(m, dx, dy, 7);
  }
  leave(m, 4);
}

// 0:5eb5 message(msg, arg): 0 collision (0:5f15), 2 teleport, 8 hit (0:5f5d), 9 explode (0:5f79); others 0.
export function greMessage(m: Memory, msg: number, arg: number): number {
  switch ((msg << 24) >> 24) {
    case 0:
      return greCollide(m);
    case 2:
      return teleportTo(m, arg);
    case 8:
      return greHit(m);
    case 9: {
      // When already removed 0:5f79 returns with AX untouched: the class descriptor pointer from 0:2c71.
      const r = greExplode(m);
      return r < 0 ? m.u16(CLASS_TABLE + 0x13 * 2) : r;
    }
    default:
      return 0;
  }
}

// 0:5f15 greCollide(): message 9 to the other object; explode unless it was removed by it, then vanish.
export function greCollide(m: Memory): number {
  const bp = enter(m, 0xe);
  const pair = bp - 0xe;
  m.set16(pair, m.u16(RECEIVER));
  m.set16(pair + 2, m.u16(SENDER));
  sendMessage(m, 9, pair);
  if (m.u8(m.u16(SENDER) + 3) === 0) {
    m.set8(m.u16(RECEIVER) + 0x3b, 0);
    greExplode(m);
  } else {
    m.set8(m.u16(RECEIVER) + 3, m.u8(ROUND));
  }
  leave(m, 0xe);
  return 0xffff;
}

// 0:5f5d greHit().
export function greHit(m: Memory): number {
  greExplode(m);
  return 0xffff;
}

// 0:5f79 greExplode(): hide, alert the surveillance (0:5fa8) and turn into an explosion (0:42bd anim 2) that
// bumps what it overlaps. Returns the bump result, -1 when the grenade was already removed.
export function greExplode(m: Memory): number {
  const self = m.u16(RECEIVER);
  m.set8(self + 0x37, 1);
  if (m.u8(self + 3)) return -1;
  alertSurveillance(m, 1);
  return bumpObjects(m, spawnFrom(m, m.u16(RECEIVER), 2, 0, 0));
}

// 0:5f64 post-update(): 12cc:0600.
export function grePostUpdate(m: Memory): void {
  call(m, "12cc:0600");
}

// 0:5f6a draw().
export function greDraw(m: Memory): void {
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
}

register("0:3cc4", greInit);
register("0:3d40", greSave);
register("0:5d78", greUpdate);
register("0:5db0", greFollowPath);
register("0:5e66", greRoll);
register("0:5eb5", greMessage);
register("0:5f15", greCollide);
register("0:5f5d", greHit);
register("0:5f79", greExplode);
register("0:5f64", grePostUpdate);
register("0:5f6a", greDraw);
