import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { applySwitch, drift, DRAW_OBJECT, FRAME_TICKS, PLAYER, RECEIVER, RECORD_BYTE, ROUND, SENDER, SPAWNED, spawnProjectile, turnToMessage, UPDATE_OBJECT } from "../props/common.ts";

// Class 10, TRK: gun turret. +0x3e = switch group (7 = none), +0x83 word = fire timer, +0x85 word = turn timer,
// +0x87 = switched off, +0x88 = waiting for its cell to clear, +0x89 = armed, +0x8a = fixed facing,
// +0x8b = destroyed (round stamp).

// 0:6f6a update()
export function trkUpdate(m: Memory): void {
  trkFire(m);
  trkReclaimCell(m);
  trkTurn(m);
  drift(m);
}

// 0:6f93 trkReclaimCell(): a turret switched back on (+0x88) becomes solid again once nothing collides (0:d424).
export function trkReclaimCell(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x88)) return;
  m.set8(cur + 0x18, 0);
  const hit = m.push(2);
  const blocked = call(m, "0:d424", cur, hit + 1);
  m.pop(2);
  const t = m.u16(UPDATE_OBJECT);
  if (blocked) {
    m.set8(t + 0x18, 1);
  } else {
    m.set8(t + 0x87, 1);
    m.set8(t + 0x88, 0);
  }
}

// 0:6fd3 trkTurn(): an armed turret without fixed facing turns one step every 0xc00 ticks.
export function trkTurn(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x89) || m.u8(cur + 0x8a)) return;
  const t = (m.u16(cur + 0x85) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(cur + 0x85, t);
  if (t & 0x8000) {
    m.set16(cur + 0x85, t + 0xc00);
    m.set8(cur + 0x16, (m.s8(cur + 0x16) + 1) & 7);
  }
}

// 0:7008 trkFire(): every 0x700 ticks shoot at the player, else at the first survivor (class 9) in the line of fire.
export function trkFire(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x89)) return;
  const t = (m.u16(cur + 0x83) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(cur + 0x83, t);
  if (!(t & 0x8000)) return;
  m.set16(cur + 0x83, t + 0x700);
  if (trkShootAt(m, m.u16(PLAYER))) return;
  const it = m.push(4);
  m.set8(it + 1, 0);
  for (;;) {
    const o = call(m, "fff:0ca3", 9, it + 1);
    if (!o || !trkShootAt(m, o)) break;
  }
  m.pop(4);
}

// 0:706a trkShootAt(target): fire (0:6040) when the target is within 0x63 in the turret's facing; 1 when fired.
// A lifted player (+0x91) returns whatever AX held (non-zero at both call sites).
export function trkShootAt(m: Memory, target: number): number {
  if (m.u8(target + 2) === 0 && m.u8(target + 0x91)) return 1;
  if (!target) return 0;
  const cur = m.u16(UPDATE_OBJECT);
  const dir = ((call(m, "0:434f", target, cur) + 4) >> 3) & 7;
  if (dir !== m.s8(cur + 0x16)) return 0;
  const angle = call(m, "0:4027", target, 0x63, 4) & 0xff;
  if (angle === 0xff) return 0;
  if (spawnProjectile(m)) return 0;
  m.set8(m.u16(SPAWNED) + 0x3a, angle);
  return 1;
}

// 0:70e4 message(kind, msg): 0 and 8 turn, 4 = switch, 9 = shot.
export function trkMessage(m: Memory, kind: number, msg: number): number {
  switch (kind & 0xff) {
    case 0:
    case 8:
      return turnToMessage(m, msg);
    case 4:
      return trkSwitch(m, msg);
    case 9:
      return trkShot(m);
    default:
      return 0;
  }
}

// 0:715c trkShot(): a solid turret hit by a heavy shot (list DS:80a) breaks (0:42bd); the first time it is
// disabled for good. Returns AX as left by the original (0 when not hit).
export function trkShot(m: Memory): number {
  let r = m.u16(RECEIVER);
  if (m.u8(r + 0x18)) return 0;
  if (!call(m, "0:5bd0", m.s8(m.u16(SENDER) + 2) & 0xffff, 0x80a)) return 0;
  const ax = call(m, "0:42bd", m.u16(RECEIVER), 1, 0, 0) & 0xff00;
  r = m.u16(RECEIVER);
  m.set8(r + 3, 0);
  if (!m.u8(r + 0x8b)) {
    m.set8(r + 0x18, 0);
    m.set8(r + 0x8b, m.u8(ROUND));
    m.set8(r + 0x89, 0);
    m.set8(r + 0x3e, 7);
    m.set8(r + 0x16, 0);
    m.set8(r + 6, 0);
    return ax;
  }
  m.set8(r + 0x16, 1);
  m.set8(r + 6, 1);
  return ax | 1;
}

// 0:71c8 trkSwitch(msg): switch message (byte 0xd as in 0:67c8); on arms it again, off waits for its cell.
export function trkSwitch(m: Memory, msg: number): number {
  const state = m.push(4);
  m.set8(state + 3, m.u8(m.u16(RECEIVER) + 0x87) ? 0xff : 0);
  const changed = applySwitch(m, state + 3, m.s8(msg + 0xd) & 0xffff);
  const on = m.s8(state + 3);
  m.pop(4);
  if (!changed) return 0;
  const r = m.u16(RECEIVER);
  if (on < 0) {
    m.set8(r + 0x88, 1);
  } else {
    m.set8(r + 0x87, 0);
    m.set8(r + 0x18, 1);
  }
  m.set8(m.u16(RECEIVER) + 0x89, 0);
  return 1;
}

// 0:7234 post(): 12cc:065e.
export function trkPost(m: Memory): void {
  call(m, "12cc:065e");
}

// 0:723a draw()
export function trkDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

// 0:7249 init(record, object): record byte 3 = group | facing << 3 | 0x40 off | 0x80 fixed facing.
export function trkInit(m: Memory, record: number, obj: number): void {
  m.set8(obj + 6, 0);
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x16, (((b << 24) >> 24) >> 3) & 7);
  m.set8(obj + 0x3e, b & 7);
  if ((b & 7) === 7) {
    m.set8(obj + 0x8b, 1);
    m.set8(obj + 0x87, 1);
    if (m.u8(obj + 0x16)) {
      m.set8(obj + 6, 1);
      m.set8(obj + 0x18, 1);
    }
  } else if (b & 0x40) {
    m.set8(obj + 6, 0xa);
  } else {
    m.set8(obj + 0x89, 1);
    m.set8(obj + 0x87, 1);
    m.set16(obj + 0x83, 0xc00);
  }
  if (b & 0x80) m.set8(obj + 0x8a, 1);
  if (!m.u8(obj + 0x87)) m.set8(obj + 0x18, 1);
}

// 0:72ce save(object, record): record byte 3 as read by init.
export function trkSave(m: Memory, obj: number, record: number): void {
  const v = (m.s8(obj + 0x16) << 3) | (m.u8(obj + 0x8a) ? 0x80 : 0) | (m.u8(obj + 0x87) ? 0 : 0x40) | m.s8(obj + 0x3e);
  m.set8(record + 3, v);
  call(m, "0:4642", obj, record);
}

register("0:6f6a", trkUpdate);
register("0:6f93", trkReclaimCell);
register("0:6fd3", trkTurn);
register("0:7008", trkFire);
register("0:706a", trkShootAt);
register("0:70e4", trkMessage);
register("0:715c", trkShot);
register("0:71c8", trkSwitch);
register("0:7234", trkPost);
register("0:723a", trkDraw);
register("0:7249", trkInit);
register("0:72ce", trkSave);
