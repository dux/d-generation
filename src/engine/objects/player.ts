import {
  angleBetween,
  animateWalk,
  classInList,
  drawObjectPart,
  enter,
  leave,
  moveCurrent,
  nudge,
  setSpeed,
  sound,
  spawnAhead,
  spawnFrom,
  teleportTo,
} from "../actors/helpers.ts";
import { CLASS_TABLE } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { drawToPanel, restoreDrawTarget } from "../geometry/draw.ts";
import { readJoystick, readKeys } from "../geometry/math.ts";
import { findCollision } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { blocked, collide } from "../misc/collide.ts";
import {
  DRAW_OBJECT,
  FRAME_TICKS,
  PLAYER,
  RECEIVER,
  ROUND,
  SENDER,
  SPAWNED,
  spawnProjectile,
  UPDATE_OBJECT,
} from "../props/common.ts";
import { createObject, destroyObject } from "../world/objects.ts";

// Class 0, PLY.VGA: the player. +0x94 under control, +0x86 knockback frames (walk at full time step, no input),
// +0x87 knocked into a wall (nudge it out), +0x88 heading (0..63), +0x91 invulnerable while +0x8d counts down,
// +0x92/+0x95 hit by a lift (52b1).

const SLOW_MOTION = 0x3370; // when set, the player moves with the time step of DS:3402
const JOY_MAGNITUDE = 0x612e; // joystick deflection of the last read
const JOY_HEADING = 0x6130;
const LAST_MAGNITUDE = 0x670;
const DEMO_RECORD = 0x1986;
const KEY_RUN = 0x6132;
const KEY_PRESSED = 0x6133; // a key was typed; its ASCII code in DS:397f
const KEY_CODE = 0x397f;
const AMMO = 0x3365;
const LIFTED = 0x3375; // player carried by a lift: hits do not hurt
const DEADLY = 0x6cf; // sender classes that kill the player, negative-terminated

// 0:3c2f init(record, object): controlled and invulnerable for 0xa00.
export function plyInit(m: Memory, _record: number, obj: number): void {
  m.set8(obj + 0x94, 1);
  m.set8(obj + 0x91, 1);
  m.set16(obj + 0x8d, 0xa00);
}

// 0:51ee update(): input, movement, fire, use and invulnerability, with the slow-motion time step if set.
export function plyUpdate(m: Memory): void {
  enter(m, 2);
  const time = m.u16(FRAME_TICKS);
  if (m.u8(SLOW_MOTION)) m.set16(FRAME_TICKS, m.u16(0x3402));
  m.push(2);
  plyControl(m);
  m.pop(2);
  plyMove(m);
  plyFire(m);
  plyUse(m);
  plyInvulnerable(m);
  m.set16(FRAME_TICKS, time);
  leave(m, 2);
}

// 0:5220 plyInvulnerable(): count +0x8d down; at zero the player can be hurt again.
export function plyInvulnerable(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (!m.u16(obj + 0x8d)) return;
  const t = (m.u16(obj + 0x8d) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0x8d, t);
  if (((t << 16) >> 16) > 0) return;
  m.set16(obj + 0x8d, 0);
  m.set8(obj + 0x91, 0);
}

// 0:5248 message(msg, arg): 0 collision (0:544f), 2 teleport, 5 lift (0:52b1), 8 pushed along arg+4 (0:55c0),
// 9 hit (0:5716); others 0.
export function plyMessage(m: Memory, msg: number, arg: number): number {
  switch ((msg << 24) >> 24) {
    case 0:
      return plyCollide(m, arg);
    case 2:
      return teleportTo(m, arg);
    case 5:
      return plyLifted(m);
    case 8:
      return plyPushed(m, m.s8(arg + 4) & 0xffff);
    case 9: {
      // plyHit's frame sits where the original's is: saved BP and the near call's return address.
      m.push(4);
      const r = plyHit(m);
      m.pop(4);
      return r;
    }
    default:
      return 0;
  }
}

// 0:52b1 plyLifted(): stop and hand control to the lift.
export function plyLifted(m: Memory): number {
  const self = m.u16(RECEIVER);
  m.set8(self + 0x92, 1);
  m.set8(self + 0x94, 0);
  m.set8(self + 0x3b, 0);
  m.set8(self + 6, 0);
  m.set16(self + 0x95, 0x300);
  return 1;
}

// 0:52d2 plyMove(): move along the heading (0:3e5f speed 6), nudge out of a wall after a knock, animate the walk.
export function plyMove(m: Memory): void {
  const bp = enter(m, 6);
  const dx = bp - 2;
  const dy = bp - 4;
  const time = m.u16(FRAME_TICKS);
  if (m.u8(m.u16(UPDATE_OBJECT) + 0x86)) m.set16(FRAME_TICKS, 0x100);
  moveCurrent(m, dx, dy, 6);
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0x87)) {
    m.set8(obj + 0x87, 0);
    nudge(m, obj);
  }
  m.set16(FRAME_TICKS, time);
  animateWalk(m, m.u16(UPDATE_OBJECT), m.u16(dx), m.u16(dy));
  leave(m, 6);
}

// 0:5334 plyControl(): while controlled, read the input once the knockback is over.
export function plyControl(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (!m.u8(obj + 0x94)) return;
  if (m.u8(obj + 0x86)) m.set8(obj + 0x86, m.u8(obj + 0x86) - 1);
  if (m.u8(obj + 0x86)) return;
  m.push(2);
  plyInput(m);
  m.pop(2);
}

// 0:5355 plyInput(): heading and speed from the joystick (deflection > 0x1e, running above 0x26) or the keys
// (running with DS:6132); standing still otherwise. A new facing restarts the walk cycle at the cell centre.
// The key path leaves the speed uninitialised unless running, as the original does.
export function plyInput(m: Memory): void {
  const bp = enter(m, 6);
  const speed = bp - 4;
  let moved = 0;
  let dir = readJoystick(m) & 0xffff;
  if (dir !== 0xffff) {
    if (m.u8(DEMO_RECORD) && m.u16(JOY_MAGNITUDE) === 0 && m.s8(LAST_MAGNITUDE) !== 0) {
      call(m, "0:c993", m.u16(m.u16(UPDATE_OBJECT)));
    }
    m.set8(LAST_MAGNITUDE, m.u8(JOY_MAGNITUDE));
    if (m.s16(JOY_MAGNITUDE) > 0x1e) {
      m.set8(m.u16(UPDATE_OBJECT) + 0x88, m.u8(JOY_HEADING));
      m.set16(speed, m.s16(JOY_MAGNITUDE) > 0x26 ? 0x3c : 0);
      moved = 1;
    }
  }
  if (!moved) {
    dir = readKeys(m) & 0xffff;
    if (dir !== 0xffff) {
      if (m.u8(KEY_RUN)) m.set16(speed, 0x3f);
      m.set8(m.u16(UPDATE_OBJECT) + 0x88, dir << 3);
      moved = 1;
    }
  }
  const obj = m.u16(UPDATE_OBJECT);
  if (!moved) {
    m.set8(obj + 0x3b, 0);
    m.set8(obj + 7, 0x80);
    m.set8(obj + 9, 0x80);
    m.set8(obj + 6, 0);
  } else {
    if ((m.s8(obj + 0x16) & 0xffff) !== dir) {
      m.set8(obj + 6, 0);
      m.set8(obj + 7, 0x80);
      m.set8(obj + 9, 0x80);
    }
    m.set8(obj + 0x16, dir);
    m.set8(obj + 0x13, dir);
    m.set8(obj + 0x3a, dir << 3);
    if (m.u16(speed)) setSpeed(m, obj, m.u16(speed));
  }
  leave(m, 6);
}

// 0:544f plyCollide(info): bumping into something; a still object knocks the player back. Class 6 and an active
// class 15 do not turn the player (class 15 then returns 0, as does a class 21 while invulnerable); otherwise
// the heading becomes info+4. Plays the bump sound and returns -1.
export function plyCollide(m: Memory, info: number): number {
  const cls = m.u8(m.u16(SENDER) + 2);
  const self = m.u16(RECEIVER);
  if (m.u8(self + 0x91) && cls === 0x15) return 0;
  if (!m.u8(self + 0x37)) {
    if (!m.u8(m.u16(SENDER) + 0x3b)) {
      const me = m.u16(RECEIVER);
      m.set8(me + 0x87, 1);
      if (!m.u8(me + 0x86)) m.set8(me + 0x86, 2);
    }
    if (cls !== 6) {
      if (cls === 0xf && m.u8(m.u16(SENDER) + 0x85)) return 0;
      const me = m.u16(RECEIVER);
      m.set8(me + 0x13, m.u8(info + 4));
      m.set8(me + 0x3a, 0xff);
    }
  }
  sound(m, 0x1c2e);
  return 0xffff;
}

// 0:54d4 post-update(): 12cc:000b.
export function plyPostUpdate(m: Memory): void {
  call(m, "12cc:000b");
}

// 0:54da draw(): on the panel layer.
export function plyDraw(m: Memory): void {
  drawToPanel(m);
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
  restoreDrawTarget(m);
}

// 0:55c0 plyPushed(dir): pushed along dir; pushed straight back (dir = facing ^ 4) counts as a knock into a wall.
export function plyPushed(m: Memory, dir: number): number {
  const self = m.u16(RECEIVER);
  if (m.s8(self + 0x13) === (((dir << 24) >> 24) ^ 4)) m.set8(self + 0x87, 1);
  m.set8(self + 0x13, dir);
  m.set8(self + 0x3a, 0xff);
  if (!m.u8(self + 0x86)) {
    m.set8(self + 0x86, 2);
    sound(m, 0x1c2e);
  }
  return 0xffff;
}

// 0:5604 plyFire(): fire button 0 (or a typed 'T'/'t') shoots when there is ammo; the shot aims along the facing
// and belongs to the player.
export function plyFire(m: Memory): void {
  if (call(m, "0:c77b", 0) !== 2) {
    if (!m.u8(KEY_PRESSED)) return;
    const k = m.u8(KEY_CODE);
    if (k !== 0x54 && k !== 0x74) return;
    m.set8(KEY_PRESSED, 0);
    m.set8(KEY_CODE, 0);
  }
  if (!m.u8(AMMO) || spawnProjectile(m)) return;
  const shot = m.u16(SPAWNED);
  m.set8(shot + 0x3a, m.s8(shot + 0x13) << 3);
  m.set16(shot + 0x3f, m.u16(m.u16(UPDATE_OBJECT)));
}

// 0:5673 plyUse(): fire button 1 (or a typed space): talk to a listener (0:a94e topic 12) the player faces (within
// one facing step), otherwise throw (0:592a).
export function plyUse(m: Memory): void {
  if (call(m, "0:c77b", 1) !== 2) {
    if (!m.u8(KEY_PRESSED) || m.u8(KEY_CODE) !== 0x20) return;
    m.set8(KEY_CODE, 0);
    m.set8(KEY_PRESSED, 0);
  }
  const listener = call(m, "0:a94e", 0xc) & 0xffff;
  if (listener) {
    const f = (((angleBetween(m, listener, m.u16(UPDATE_OBJECT)) + 4) << 16) >> 19) & 7;
    const facing = m.s8(m.u16(UPDATE_OBJECT) + 0x16);
    if (f === facing || ((f + 1) & 7) === facing || ((f - 1) & 7) === facing) {
      sound(m, 0x1c3e);
      m.set8(0x1997, 1);
      while (call(m, "0:a3ee"));
      m.set8(0x1997, 0);
      return;
    }
  }
  plyThrow(m);
}

// 0:5716 plyHit(): hurt by the sender unless invulnerable. On a lift only a class 19 hit (resets DS:3376/3378) and
// up to 3 class 21 pickups (DS:336e) count. Class 20 does nothing; otherwise the player may die (0:5792), which
// ends control (DS:6134) and, unless killed by class 26, freezes timer DS:340b. Returns 1; when invulnerable the
// original returns AX untouched, the class descriptor pointer from 0:2c71.
export function plyHit(m: Memory): number {
  if (m.u8(m.u16(RECEIVER) + 0x91)) return m.u16(CLASS_TABLE);
  if (m.u8(LIFTED)) {
    const sender = m.u16(SENDER);
    if (m.u8(sender + 2) === 0x13) {
      m.set16(0x3378, 0);
      m.set16(0x3376, 0);
    }
    if (m.u8(sender + 2) === 0x15 && m.s8(0x336e) < 3) {
      m.set8(0x336e, m.u8(0x336e) + 1);
      m.set8(sender + 3, m.u8(ROUND));
    }
    return 1;
  }
  if (m.u8(m.u16(SENDER) + 2) === 0x14) return 1;
  m.push(2);
  plyDie(m);
  m.pop(2);
  if (m.u8(m.u16(RECEIVER) + 3)) {
    m.set8(0x6134, 1);
    m.set16(PLAYER, 0);
    if (m.u8(m.u16(SENDER) + 2) !== 0x1a) call(m, "0:e51b", m.s8(0x340b) & 0xffff);
  }
  return 1;
}

// 0:5792 plyDie(): killed by a deadly class (no sender counts as class 19): the receiver is removed and replaced
// by the class's remains. Record byte 3 of the created objects is the uninitialised local at BP-3.
export function plyDie(m: Memory): void {
  const bp = enter(m, 8);
  const sender = m.u16(SENDER);
  const cls = sender ? m.u8(sender + 2) : 0x13;
  m.set8(bp - 7, cls);
  if (classInList(m, ((cls << 24) >> 24) & 0xffff, DEADLY)) {
    const rec = bp - 6;
    let self = m.u16(RECEIVER);
    m.set8(rec + 1, m.u8(self + 8));
    m.set8(rec + 2, m.u8(self + 0xa));
    m.set8(self + 0x18, 0);
    m.set8(self + 3, m.u8(ROUND));
    switch (cls) {
      case 6:
        sound(m, 0x1de6);
        break;
      case 7:
        spawnFrom(m, m.u16(RECEIVER), 2, 0, 0);
        break;
      case 0xe: {
        m.set8(rec, 0x80);
        const o = createObject(m, rec);
        self = m.u16(RECEIVER);
        m.set8(o + 0xd1, m.u8(self + 0xd1));
        m.set8(o + 0x89, m.u8(self + 2));
        break;
      }
      case 0xf:
        m.set8(rec, 5);
        createObject(m, rec);
        break;
      case 0x16:
        m.set8(rec, 0xc);
        createObject(m, rec);
        m.set8(rec, (((m.s8(m.u16(SENDER) + 0x13) ^ 4) << 4) | 0x88) & 0xff);
        createObject(m, rec);
        spawnFrom(m, m.u16(RECEIVER), 2, 0, 0);
        sound(m, 0x1de6);
        break;
      case 0x1a:
        call(m, "0:9dd5", 0x8e);
        break;
      default:
        if (cls === 0x13 && m.u8(m.u16(RECEIVER) + 2) === 0) {
          m.set16(0x5f6c, 0x6b1);
          m.set16(0x5f6a, 0x6c3);
        }
        plyBlownAway(m);
    }
  }
  leave(m, 8);
}

// 0:58ae (tail of 0:5792): explode along the sender's facing and speed; the player also flashes the screen.
function plyBlownAway(m: Memory): void {
  const sender = m.u16(SENDER);
  spawnFrom(m, m.u16(RECEIVER), 2, m.s8(sender + 0x13) & 0xffff, m.u8(sender + 0x3b));
  if (m.u8(m.u16(RECEIVER) + 2) === 0) call(m, "0:1de6", 1, 2);
  else sound(m, 0x1a76);
}

// 0:592a plyThrow(): spawn a class 4 throwable (record low nibble 4) ahead along the facing; it hits what it
// starts in, is removed when blocked, else flies at speed 0x55 for 2 frames.
export function plyThrow(m: Memory): void {
  const bp = enter(m, 2);
  const hit = bp - 1;
  const shot = spawnAhead(m, m.s8(m.u16(UPDATE_OBJECT) + 0x16) & 0xffff, 0xff84);
  m.set16(SPAWNED, shot);
  if (!shot) {
    sound(m, 0x1a0a);
  } else {
    m.set16(shot + 0x3f, m.u16(m.u16(UPDATE_OBJECT)));
    if (findCollision(m, shot, hit)) {
      collide(m, m.u16(SPAWNED), m.s8(hit) & 0xffff);
    } else if (blocked(m, m.u16(SPAWNED), hit)) {
      destroyObject(m, m.u16(SPAWNED));
      sound(m, 0x1a0a);
    } else {
      const s = m.u16(SPAWNED);
      m.set16(s + 0x3f, 0xffff);
      m.set8(s + 0x3b, 0x55);
      m.set8(s + 0x83, 0);
      m.set8(s + 0x89, 2);
      sound(m, 0x19ee);
    }
  }
  leave(m, 2);
}

register("0:3c2f", plyInit);
register("0:51ee", plyUpdate);
register("0:5220", plyInvulnerable);
register("0:5248", plyMessage);
register("0:52b1", plyLifted);
register("0:52d2", plyMove);
register("0:5334", plyControl);
register("0:5355", plyInput);
register("0:544f", plyCollide);
register("0:54d4", plyPostUpdate);
register("0:54da", plyDraw);
register("0:55c0", plyPushed);
register("0:5604", plyFire);
register("0:5673", plyUse);
register("0:5716", plyHit);
register("0:5792", plyDie);
register("0:592a", plyThrow);
