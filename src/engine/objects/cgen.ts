import { classInList, countDown, drawObjectPart, enterRoom, setSpeed, spawnFrom, teleportTo } from "../actors/helpers.ts";
import { flash, loadFrontShapes } from "../core/display.ts";
import { chasePlayer } from "../creatures/chase.ts";
import { call, register } from "../dispatch.ts";
import { drawToFront, restoreDrawTarget, selectBarPalette } from "../geometry/draw.ts";
import {
  clearTargetIfReached,
  DRAW_OBJECT,
  FRAME_TICKS,
  PLAYER,
  RECEIVER,
  ROUND,
  SCENE,
  SENDER,
  UPDATE_OBJECT,
  walkStep,
} from "../props/common.ts";
import type { Memory } from "../memory.ts";
import { anim14d9 } from "../misc/anim.ts";
import { playSound } from "../misc/sound.ts";
import { random } from "../random.ts";
import { createObject, sendMessage } from "../world/objects.ts";

// Classes 22 and 26, CGEN/DGEN: creature generators (shared code).

// 0:9e1e markPlayer(): a player-triggered generator flags the player (+0x37) while not paused.
export function cgenMarkPlayer(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0x91) !== 0 && m.u8(0x3c3) === 0) m.set8(m.u16(PLAYER) + 0x37, 1);
}

// 0:9e39 tickTimer(): count down the spawn timer at +0x8b.
export function cgenTickTimer(m: Memory): void {
  countDown(m, (m.u16(UPDATE_OBJECT) + 0x8b) & 0xffff);
}

// 0:9e45 spawn(): when the timer ran out, try to spawn a creature and restart the timer.
export function cgenSpawn(m: Memory): void {
  if (m.u16(PLAYER) === 0) return;
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u16(obj + 0x8b) !== 0 || m.u8(obj + 0x8d) === 0) return;
  if (chasePlayer(m, 0x41, 2) === 0) return;
  setSpeed(m, m.u16(UPDATE_OBJECT), 0x32);
  m.set8(m.u16(UPDATE_OBJECT) + 0x8f, 0);
}

// 0:9dd5 destroyed(sound): play sound, spawn an explosion unless in room type 0x8d, show message 1d8a.
export function cgenDestroyed(m: Memory, sound: number): void {
  enterRoom(m, sound);
  if (m.u8(SCENE) !== 0x8d) {
    const local = m.push(4);
    m.set8(local, 0x10);
    m.set8(local + 1, 0x7a);
    m.set8(local + 2, 0x70);
    m.set8(local + 3, 0);
    createObject(m, local);
    m.pop(4);
  }
  playSound(m, 0x1d8a);
  flash(m, 0, 4);
}

// 0:9d7f update(): spawn while active, otherwise run down the self-destruct countdown at +0x92.
export function cgenUpdate(m: Memory): void {
  cgenMarkPlayer(m);
  let obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0x8d) !== 0 && (m.u8(obj + 0x91) === 0 || m.u8(0x3c3) !== 0)) {
    clearTargetIfReached(m);
    cgenSpawn(m);
    walkStep(m);
    cgenTickTimer(m);
    return;
  }
  if (m.u8(0x3c3) !== 0) return;
  obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0x94) !== 0) return;
  const left = (m.u16(obj + 0x92) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0x92, left);
  if (m.s16(obj + 0x92) <= 0) cgenDestroyed(m, 0x8a);
}

// 0:a050 restart(arg): turn to a random direction near arg[4], reset the timer; after 4 hits stop.
export function cgenRestart(m: Memory, arg: number): number {
  const dir = (random(m, 3) + m.s8(arg + 4) - 1) & 7;
  const obj = m.u16(RECEIVER);
  m.set8(obj + 0x13, dir);
  m.set8(obj + 0x16, dir);
  m.set8(obj + 0x3a, (dir << 3) & 0xff);
  m.set8(obj + 6, 1);
  m.set16(obj + 0x8b, 0x500);
  if (m.u8(obj + 0x8f) === 4) {
    m.set8(obj + 0x89, 0);
    m.set8(obj + 0x3b, 0);
    m.set8(obj + 6, 0);
  } else {
    m.set8(obj + 0x8f, (m.u8(obj + 0x8f) + 1) & 0xff);
  }
  return 1;
}

// 0:9fa5 onHit(arg): message 0; notify class 9 helpers, then restart unless the sender is class 0x14.
export function cgenOnHit(m: Memory, arg: number): number {
  const local = m.push(0xe);
  m.set16(local, m.u16(RECEIVER));
  m.set16(local + 2, m.u16(SENDER));
  let ax = sendMessage(m, 9, local);
  if (m.u8(m.u16(SENDER) + 2) !== 0x14) {
    const obj = m.u16(RECEIVER);
    if (m.u8(obj + 0x8d) !== 0) {
      m.set8(obj + 0x3b, 0x3c);
      ax = cgenRestart(m, arg);
    }
  }
  m.pop(0xe);
  return ax;
}

// 0:9feb onShot(arg): message 8; with a player restart, otherwise drop a pickup and show message 1d7e.
export function cgenOnShot(m: Memory, arg: number): number {
  if (m.u16(PLAYER) !== 0) return cgenRestart(m, arg);
  const obj = m.u16(RECEIVER);
  m.set8(obj + 3, m.u8(ROUND));
  const local = m.push(4);
  m.set8(local, 7);
  m.set8(local + 1, m.u8(obj + 8));
  m.set8(local + 2, m.u8(obj + 0xa));
  m.set8(local + 3, m.u8(0x11b3 + random(m, 6)));
  createObject(m, local);
  m.pop(4);
  playSound(m, 0x1d7e);
  return call(m, "0:1de6", 0, 2);
}

// 0:9ee5 onTouch(): message 9; player-triggered generators react to class 7/0x13 senders, others to 0x11ae's list.
// The player-triggered branch leaves AX undefined (the caller's BX) on most paths: its result is meaningless there.
export function cgenOnTouch(m: Memory): number {
  let ax = 0;
  const obj = m.u16(RECEIVER);
  if (m.u8(obj + 0x91) !== 0) {
    if (m.u8(obj + 0x98) === 0 && m.u8(m.u16(SENDER) + 2) === 7) {
      ax = m.u8(SCENE);
      if (ax === 0x85) {
        const t = m.u16(RECEIVER);
        ax = ((m.u8(t + 8) + m.u8(t + 0xa)) << 7) & 0xffff;
        const hi = ax >> 8;
        if (hi > 0x7c) {
          ax = hi;
          if (hi < 0x97) {
            m.set8(t + 0x8d, 0);
            m.set8(t + 0x98, 1);
            m.set8(t + 6, 0);
          }
        }
      }
    }
    if (m.u8(m.u16(SENDER) + 2) === 0x13) {
      const t = m.u16(RECEIVER);
      m.set8(t + 0x3b, 0);
      m.set16(t + 0x8b, 0x2800);
    }
  } else {
    ax = classInList(m, m.s8(m.u16(SENDER) + 2) & 0xffff, 0x11ae);
    if (ax !== 0) {
      const s = m.u16(SENDER);
      ax = spawnFrom(m, m.u16(RECEIVER), 3, m.s8(s + 0x13) & 0xffff, m.u8(s + 0x3b));
    }
  }
  m.set8(0x33ee, 0);
  return ax;
}

// 0:9e88 message(msg, arg): 0 hit, 2 generic (0:4242), 8 shot, 9 touch; others return 1.
export function cgenMessage(m: Memory, msg: number, arg: number): number {
  switch (msg & 0xff) {
    case 0:
      return cgenOnHit(m, arg);
    case 2:
      return teleportTo(m, arg);
    case 8:
      return cgenOnShot(m, arg);
    case 9:
      return cgenOnTouch(m);
    default:
      return 1;
  }
}

// 0:a0b7 postUpdate(): shared animation step (12cc:14d9).
export function cgenPostUpdate(m: Memory): void {
  anim14d9(m);
}

// 0:a0bd draw(): skip one frame when +0x97 is set, else draw into the front layer.
export function cgenDraw(m: Memory): void {
  const obj = m.u16(DRAW_OBJECT);
  if (m.u8(obj + 0x97) !== 0) {
    m.set8(obj + 0x97, 0);
    return;
  }
  drawToFront(m);
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
  restoreDrawTarget(m);
}

// 0:a0e8 init(record, object): record byte 3 bit 7 = player-triggered (bit 6: dormant), else timed generator.
export function cgenInit(m: Memory, record: number, obj: number): void {
  m.set8(obj + 0x8d, 1);
  const flags = m.u8(record + 3);
  if (flags & 0x80) {
    m.set8(obj + 0x91, 1);
    loadFrontShapes(m, 1);
    selectBarPalette(m, 0xa, 0xc, 0x10);
    if (flags & 0x40) {
      m.set8(obj + 0x8d, 0);
      m.set8(obj + 0x94, 1);
    } else {
      m.set16(obj + 0x92, 0xf00);
    }
  } else {
    loadFrontShapes(m, 0);
    m.set8(obj + 0x13, 3);
    m.set8(obj + 0x16, 3);
    m.set8(obj + 0xd1, 0x30);
    selectBarPalette(m, 0xc, 0xe, 0x30);
  }
  m.set8(obj + 6, 0);
}

register("0:9e1e", cgenMarkPlayer);
register("0:9e39", cgenTickTimer);
register("0:9e45", cgenSpawn);
register("0:9dd5", cgenDestroyed);
register("0:9d7f", cgenUpdate);
register("0:a050", cgenRestart);
register("0:9fa5", cgenOnHit);
register("0:9feb", cgenOnShot);
register("0:9ee5", cgenOnTouch);
register("0:9e88", cgenMessage);
register("0:a0b7", cgenPostUpdate);
register("0:a0bd", cgenDraw);
register("0:a0e8", cgenInit);
