import { CLASS_TABLE, forEachObject } from "../core/objects.ts";
import { chasePlayer, resetAttackTimer, turnToward } from "../creatures/chase.ts";
import { call, register } from "../dispatch.ts";
import { drawToFront, restoreDrawTarget, selectBarPalette } from "../geometry/draw.ts";
import { nextObjectOfClass } from "../geometry/math.ts";
import type { Memory } from "../memory.ts";
import { applyCountCodes } from "../misc/menu.ts";
import { playSound } from "../misc/sound.ts";
import {
  DRAW_OBJECT,
  FRAME_TICKS,
  PLAYER,
  POST_OBJECT,
  RECEIVER,
  RECORD_BYTE,
  ROUND,
  SENDER,
  UPDATE_OBJECT,
} from "../props/common.ts";
import { random } from "../random.ts";

// Class 9, SUR.VGA: creature that wanders, chases and attacks the player.
// Fields: +0x8b awake/hunting, +0x8c alerted, +0x8f/+0x9e/+0xac timers, +0x91 last class-1 id,
// +0xa5 base animation, +0xa6 profile (from DS:5f64[DS:398a]), +0xae attack timer, +0xb1/+0xb4 record bits.

const SUR_COUNT = 0x398a; // creatures initialised in this room (profile index)
const PROFILES = 0x5f64;

const cur = (m: Memory): number => m.u16(UPDATE_OBJECT);
const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;

function stop(m: Memory, obj: number): void {
  m.set8(obj + 6, 0);
  m.set8(obj + 0x3b, 0);
}

// 0:92be callback(obj): a class-6 object that 0:4027 sees within 0x1e.
function seesClass6(m: Memory, obj: number): number {
  if (m.u8(obj + 2) !== 6) return 0;
  return (call(m, "0:4027", obj, 0x1e, 4) & 0xffff) !== 0xffff ? 1 : 0;
}

// 0:9adf callback(obj): alert every SUR.
function alertSur(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 9) m.set8(obj + 0x8c, 1);
  return 0;
}

// 0:94a1 wake(): when woken (+0x98) and the player is in range, start hunting or wandering.
export function surWake(m: Memory): void {
  let obj = cur(m);
  if (m.u16(obj + 0x8f) || !m.u8(obj + 0x98)) return;
  m.set16(obj + 0x8f, m.u16(obj + 0x8f) + 0x400);
  if (m.u8(0x3375)) return;
  if (!chasePlayer(m, 0x4b, 4)) return;
  obj = cur(m);
  if (m.u8(obj + 0x8c)) {
    m.set8(obj + 0x8b, 1);
    m.set8(obj + 0x16, 3);
    m.set8(obj + 0x13, 3);
  } else {
    const p = m.u16(obj + 0xa6);
    if (p && m.u16(p + 0xfc)) call(m, "0:cff8", m.u16(p + 0xfc), 4, 0x83);
    obj = cur(m);
    m.set8(obj + 0x96, 1);
    if (m.u8(obj + 0x9a)) m.set8(obj + 6, 0);
    if (m.u8(obj + 0x9b)) m.set8(obj + 6, 2);
    const r = random(m, 8);
    m.set16(cur(m) + 0x94, (r & 0xff) << 8);
  }
  obj = cur(m);
  m.set8(obj + 0x8e, 0);
  m.set8(obj + 0x9b, 0);
  m.set8(obj + 0x9a, 0);
  m.set8(obj + 0x98, 0);
}

// 0:956a tickTimers(): run the +0x8f/+0x9e timers; a dead player (+0x37) freezes the creature.
export function surTickTimers(m: Memory): void {
  const player = m.u16(PLAYER);
  if (player) {
    if (!m.u8(player + 0x37)) {
      call(m, "0:47e7", cur(m) + 0x8f);
      if (m.u8(m.u16(PLAYER) + 0x3b)) m.set8(cur(m) + 0xb0, 0);
    } else {
      const obj = cur(m);
      m.set8(obj + 0xb0, 1);
      m.set8(obj + 6, 0);
      m.set16(obj + 0x8f, 0x500);
    }
  }
  call(m, "0:47e7", cur(m) + 0x9e);
}

// 0:978e giveUp(): drop the heading and play the idle animation.
export function surGiveUp(m: Memory): void {
  let obj = cur(m);
  m.set8(obj + 0x3a, 0xff);
  call(m, "0:4757", obj, (m.s8(obj + 0xa5) + 0xf) & 0xffff);
  obj = cur(m);
  call(m, "0:6114", (m.s8(obj + 0x13) ^ 4) & 0xffff);
}

// 0:97b7 findTarget(): head for a class-1 object in sight; may leap at the player. Returns the heading or -1.
export function surFindTarget(m: Memory): number {
  const base = m.push(8);
  const index = base + 5;
  let heading = 0xff;
  let done = false;
  if (m.u8(cur(m) + 0x91)) {
    m.set8(index, 0);
    for (;;) {
      const o = nextObjectOfClass(m, 1, index);
      if (!o) break;
      if (!m.u8(o + 0x84)) continue;
      heading = call(m, "0:4027", o, 0x55, 4) & 0xff;
      if (heading === 0xff) {
        m.pop(8);
        return 0xffff;
      }
      break;
    }
  }
  m.set8(index, 0);
  while (!done) {
    const o = nextObjectOfClass(m, 1, index);
    if (!o) break;
    if (m.u8(o + 0x84)) continue;
    const r = call(m, "0:4027", o, 0x4b, 4) & 0xff;
    m.set8(base + 3, r);
    if (r === 0xff) break;
    heading = r;
    m.set8(cur(m) + 0x91, m.u8(o + 0x83));
    done = true;
    if (random(m, 8)) break;
    const obj = cur(m);
    if (m.u8(obj + 0x8c) || m.u8(obj + 0x9d) || !m.u8(obj + 0xa2)) break;
    const player = m.u16(PLAYER);
    if (!player) break;
    if (m.u8(player + 8) <= m.u8(obj + 8) || m.u8(player + 0xa) <= m.u8(obj + 0xa)) break;
    m.set8(obj + 0x9d, 1);
    m.set8(obj + 0x8b, 0);
    m.set16(obj + 0x94, 0x300);
    stop(m, obj);
    const p = m.u16(obj + 0xa6);
    if (p && m.u16(p + 0xfe)) call(m, "0:cff8", m.u16(p + 0xfe), 4, 0x83);
    const o2 = cur(m);
    if (m.u8(o2 + 0xa2) === 1) m.set8(o2 + 0x97, 1);
    else if (m.u8(o2 + 0xa2) === 2) m.set8(o2 + 0xa3, 1);
  }
  if (heading !== 0xff) {
    m.set8(cur(m) + 0x3a, heading);
    turnToward(m, s8(heading) & 0xffff);
    const facing = call(m, "0:4945", s8(heading) & 0xffff);
    const obj = cur(m);
    m.set8(obj + 0x13, facing);
    m.set16(obj + 0x8f, 0);
    m.set16(obj + 0x3f, m.u16(m.u16(PLAYER)));
    m.set8(obj + 0x17, 9);
  }
  m.pop(8);
  return s8(heading) & 0xffff;
}

// 0:95ba hunt(): while hunting, steer toward a target or the player and attack him in reach.
export function surHunt(m: Memory): void {
  let obj = cur(m);
  if (m.u16(obj + 0x8f) || m.u8(obj + 0x8d) || !m.u8(obj + 0x8b)) return;
  call(m, "0:4757", obj, m.s8(obj + 0xa5) & 0xffff);
  if ((surFindTarget(m) & 0xffff) !== 0xffff) return;
  obj = cur(m);
  m.set16(obj + 0x3f, 0xffff);
  if (!m.u16(PLAYER)) {
    stop(m, obj);
    return;
  }
  const r = chasePlayer(m, 0x41, 4);
  if (r === 0xffff) {
    if (m.u8(cur(m) + 0x8c)) {
      surGiveUp(m);
      return;
    }
  } else if (r === 0) {
    stop(m, cur(m));
    return;
  }
  if (call(m, "0:414b", m.u16(PLAYER), 9) & 0xffff) {
    obj = cur(m);
    stop(m, obj);
    m.set8(obj + 0x99, 0);
  } else {
    obj = cur(m);
    call(m, "0:4757", obj, m.s8(obj + 0xa5) & 0xffff);
  }
}

// 0:92ed grabPlayer(): touching the player turns him around; type-1 creatures may carry him off.
export function surGrabPlayer(m: Memory): void {
  let obj = cur(m);
  if (m.u8(obj + 0xab) === 0xff) return;
  const player = m.u16(PLAYER);
  if (!player) return;
  const dir = call(m, "0:4027", player, 9, 4) & 0xff;
  if (dir === 0xff) return;
  obj = cur(m);
  if (m.u8(obj + 0xa9) || m.u8(obj + 0x8c) || !m.u8(obj + 0x8b)) return;
  const facing = (((s8(dir) + 4) >> 3) & 7) | 1;
  const p = m.u16(PLAYER);
  m.set8(p + 0x13, facing ^ 4);
  m.set8(p + 0x16, facing ^ 4);
  m.set8(p + 0x3b, 0);
  m.set8(p + 6, 0);
  obj = cur(m);
  if (m.u8(obj + 0xab) === 1) {
    const frame = m.push(0x16);
    const pair = frame + 4;
    m.set16(pair, obj);
    m.set16(pair + 2, obj);
    const i = (facing ^ 4) >> 1;
    m.set8(pair + 6, m.u8(p + 8) + m.s8(0x1179 + i));
    m.set8(pair + 8, m.u8(p + 0xa) + m.s8(0x117d + i));
    m.set8(pair + 7, 0);
    m.set8(pair + 5, 0);
    if (call(m, "0:2c71", 2, pair) & 0xffff) {
      m.set16(pair + 2, m.u16(PLAYER));
      if (!(call(m, "0:2c71", 5, pair) & 0xffff)) {
        m.pop(0x16);
        return;
      }
      obj = cur(m);
      m.set16(obj + 0x94, 0x300);
      stop(m, obj);
      m.set8(obj + 0xa9, 1);
      m.set8(obj + 0xa8, 1);
      m.set8(obj + 0x8b, 0);
      const d = (((s8(dir) + 4) >> 3) & 7) | 1;
      m.set8(obj + 0x13, d);
      m.set8(obj + 0x16, d);
    }
    m.pop(0x16);
  } else {
    m.set8(obj + 0xa9, 1);
  }
  const profile = m.u16(cur(m) + 0xa6);
  if (!profile || !m.u16(profile + 0xc)) return;
  const frame = m.push(0x16 + 4 + 0xc);
  for (let i = 0; i < 0xc; i++) m.set8(frame + i, m.u8(profile + 0xc + i));
  const skip = applyCountCodes(m, m.u16(profile + 0xc));
  m.pop(0x16 + 4 + 0xc);
  if (m.u16(profile + 0xc)) call(m, "0:cff8", (m.u16(profile + 0xc) + skip) & 0xffff, 4, 0x83);
}

// 0:91c1 attackTimer(): while hunting a weak-profile creature, count up and growl when it expires.
export function surAttackTimer(m: Memory): void {
  const obj = cur(m);
  if (!m.u8(obj + 0x8b) || m.u8(m.u16(obj + 0xa6) + 5) >= 0x50) return;
  const v = ((m.s16(FRAME_TICKS) >> 1) + m.u16(obj + 0xae)) & 0xffff;
  m.set16(obj + 0xae, v);
  if (((v << 16) >> 16) > 0x6e00) resetAttackTimer(m, obj);
}

// 0:9241 idleSound(): idle creatures periodically react to a nearby class-6 object.
export function surIdleSound(m: Memory): void {
  let obj = cur(m);
  if (m.u8(obj + 0x8b)) return;
  const t = (m.u16(obj + 0xac) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0xac, t);
  if (((t << 16) >> 16) >= 0) return;
  m.set16(obj + 0xac, t + 0x500);
  if (!forEachObject(m, 0x92be)) return;
  call(m, "0:cff8", m.u16(0x1131 + random(m, 3) * 2), 4, 0x83);
  obj = cur(m);
  const pair = m.push(0x10);
  m.set16(pair + 2, obj);
  m.set16(pair, obj);
  m.set8(pair + 0xd, 1);
  call(m, "0:2c71", 5, pair);
  m.pop(0x10);
  obj = cur(m);
  m.set16(obj + 0xac, m.u16(obj + 0xac) + 0x2300);
}

// 0:918d update()
export function surUpdate(m: Memory): void {
  surWake(m);
  call(m, "0:617f");
  surHunt(m);
  surGrabPlayer(m);
  if (!m.u8(cur(m) + 0xb0)) call(m, "0:6134");
  surTickTimers(m);
  surAttackTimer(m);
  surIdleSound(m);
  const obj = cur(m);
  if (m.u8(obj + 0x3b)) m.set16(obj + 0xae, 0);
}

// 0:9b37 hit(data): knocked toward data+4; stunned after the third hit.
export function surHit(m: Memory, data: number): number {
  const obj = m.u16(RECEIVER);
  const dir = m.u8(data + 4);
  m.set8(obj + 0x13, dir);
  m.set8(obj + 0x16, dir);
  m.set8(obj + 0x3a, s8(dir) << 3);
  m.set8(obj + 6, 1);
  m.set16(obj + 0x8f, 0x500);
  if (m.u8(obj + 0x99) === 2) {
    m.set8(obj + 0x89, 0);
    m.set8(obj + 0x3b, 0);
    m.set8(obj + 6, 0);
  } else {
    m.set8(obj + 0x99, m.u8(obj + 0x99) + 1);
  }
  return 1;
}

// 0:9b14 msgShot(data)
export function surShot(m: Memory, data: number): number {
  surHit(m, data);
  const obj = m.u16(RECEIVER);
  if (m.u8(obj + 0x8c)) {
    m.set16(obj + 0x8f, 0x500);
    m.set8(obj + 0x3b, 0x34);
  }
  return 1;
}

// 0:9af7 msgPushed(data): only a hunting creature reacts.
export function surPushed(m: Memory, data: number): number | void {
  const obj = m.u16(RECEIVER);
  if (!m.u8(obj + 0x8b)) return;
  m.set8(obj + 0x3b, 0x3c);
  return surHit(m, data);
}

// 0:9ad6 alertAll(): set +0x8c on every SUR.
export function surAlertAll(m: Memory): void {
  forEachObject(m, 0x9adf);
}

// 0:99d1 msgNoise(data): data+0xd 0 wakes, 1 makes wanderers fidget and rearms the +0x9e timer.
export function surNoise(m: Memory, data: number): number {
  // Returns AX as left behind: the class descriptor from the dispatch, or the new wake timer.
  const leftover = m.u16(CLASS_TABLE + 9 * 2);
  const kind = m.u8(data + 0xd);
  if (kind === 0) {
    m.set8(m.u16(RECEIVER) + 0x98, 1);
    return leftover;
  }
  if (kind !== 1) return leftover;
  let obj = m.u16(RECEIVER);
  if (m.u8(obj + 0x9a) && !m.u8(obj + 0xb1)) {
    m.set8(obj + 0x8e, 1);
    m.set8(m.u16(RECEIVER) + 6, random(m, 0xc));
  }
  obj = m.u16(RECEIVER);
  if (m.u8(obj + 0x9b) && !m.u16(obj + 0x9e)) {
    m.set8(obj + 0x9c, 1);
    m.set8(m.u16(RECEIVER) + 6, random(m, 3));
  }
  const timer = (((random(m, 0x28) & 0xff) << 8) + 0x3700) & 0xffff;
  m.set16(m.u16(RECEIVER) + 0x9e, timer);
  return timer;
}

// 0:9a5f msgKilled(): class 0x13/0x14 killers alert all SURs, then death sounds and 0:5792.
export function surKilled(m: Memory): number {
  let sender = m.u16(SENDER);
  if (m.u8(sender + 2) === 0x14 && m.u8(m.u16(RECEIVER) + 0xb1)) return 0;
  sender = m.u16(SENDER);
  const cls = m.u8(sender + 2);
  if ((cls === 0x14 || cls === 0x13) && !m.u8(sender + 0x83)) surAlertAll(m);
  if (m.u8(m.u16(SENDER) + 2) === 6) call(m, "0:cff8", 0x1181, 4, 0x83);
  if (m.u8(m.u16(SENDER) + 2) === 0xe) call(m, "0:cff8", 0x1192, 3, 0x83);
  return call(m, "0:5792");
}

// 0:996d message(msg, data)
export function surMessage(m: Memory, msg: number, data: number): number | void {
  switch (s8(msg)) {
    case 0:
      return surPushed(m, data);
    case 2:
      return call(m, "0:4242", data);
    case 5:
      return surNoise(m, data);
    case 8:
      return surShot(m, data);
    case 9:
      return surKilled(m);
    default:
      return 0;
  }
}

// 0:9b8a postUpdate(): when 12cc:0ed7 fires, a creature on its trigger cell ends the round.
export function surPostUpdate(m: Memory): void {
  if (!(call(m, "12cc:0ed7") & 0xffff)) return;
  const obj = m.u16(POST_OBJECT);
  m.set8(obj + 3, m.u8(ROUND));
  const cell = m.push(6);
  m.set8(cell, (m.s8(obj + 0x16) << 4) | 0x86);
  m.set8(cell + 1, m.u8(obj + 8));
  m.set8(cell + 2, m.u8(obj + 0xa));
  m.set8(cell + 3, 0);
  if (call(m, "0:2818", cell) & 0xffff) {
    playSound(m, 0x1d7e);
    call(m, "0:5fa8", 1);
    call(m, "0:1de6", 0, 2);
  }
  m.pop(6);
}

// 0:9bf0 draw(): both layers into the front buffer.
export function surDraw(m: Memory): void {
  drawToFront(m);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 1);
  restoreDrawTarget(m);
}

// 0:9c17 init(record, object): record byte 3 = flag bit 0 + id; profile DS:5f64[DS:398a] sets behaviour.
export function surInit(m: Memory, record: number, obj: number): void {
  call(m, "0:06ea", 0);
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x91, 0xff);
  const v = s8(b);
  if (v & 1) m.set8(obj + 0xb1, 1);
  m.set8(obj + 0xb4, v >> 1);
  const idx = m.u8(SUR_COUNT);
  const profile = m.u16(PROFILES + idx * 2);
  m.set16(obj + 0xa6, profile);
  m.set8(obj + 0xd1, (idx << 4) + 0x10);
  if (!profile) {
    m.set8(obj + 0xa1, 1);
    m.set8(obj + 0xa5, 0x2d);
    m.set8(obj + 0x9a, 1);
    selectBarPalette(m, 0, 0, m.s8(obj + 0xd1) & 0xffff);
  } else {
    m.set8(obj + 0xa0, m.u8(profile + 5));
    m.set8(obj + 0xb5, m.u8(profile + 0xb));
    m.set8(obj + 0xa5, m.u8(profile + 6));
    const mode = m.s8(profile + 7);
    if (mode === 0) m.set8(obj + 0x8b, 1);
    else if (mode === 1) m.set8(obj + 0x9a, 1);
    else if (mode === 2) m.set8(obj + 0x9b, 1);
    m.set8(obj + 0xa1, m.u8(profile + 8));
    m.set8(obj + 0xa2, m.u8(profile + 9));
    m.set8(obj + 0xab, m.u8(profile + 0xa));
    m.set8(obj + 0x85, m.u8(profile + 4));
    selectBarPalette(m, m.s8(profile + 2) & 0xffff, m.s8(profile + 3) & 0xffff, m.s8(obj + 0xd1) & 0xffff);
  }
  m.set8(SUR_COUNT, m.u8(SUR_COUNT) + 1);
}

// 0:9d4e save(object, record): store the record bits back into record byte 3.
export function surSave(m: Memory, obj: number, record: number): number {
  m.set8(record + 3, (m.s8(obj + 0xb1) & 1) | (m.s8(obj + 0xb4) << 1));
  return call(m, "0:4642", obj, record);
}

register("0:92be", seesClass6);
register("0:9adf", alertSur);
register("0:94a1", surWake);
register("0:956a", surTickTimers);
register("0:978e", surGiveUp);
register("0:97b7", surFindTarget);
register("0:95ba", surHunt);
register("0:92ed", surGrabPlayer);
register("0:91c1", surAttackTimer);
register("0:9241", surIdleSound);
register("0:918d", surUpdate);
register("0:9b37", surHit);
register("0:9b14", surShot);
register("0:9af7", surPushed);
register("0:9ad6", surAlertAll);
register("0:99d1", surNoise);
register("0:9a5f", surKilled);
register("0:996d", surMessage);
register("0:9b8a", surPostUpdate);
register("0:9bf0", surDraw);
register("0:9c17", surInit);
register("0:9d4e", surSave);
