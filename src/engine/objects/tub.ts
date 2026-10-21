import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, PLAYER, RECEIVER, RECORD_BYTE, SCENE, SENDER, UPDATE_OBJECT } from "../props/common.ts";

// Class 15, TUB: creature dormant in a tub. +6 = animation step, +0x85 = attacking, +0x86 = ?, +0x87 = damage of
// the attack, +0x88 = cannot move, +0x89 = dormant, +0x8a/+0x8e = surprise jump done, +0x8b word = wake timer,
// +0x8d = woken.

const PLAYER_LIFTED = 0x3375;

// 0:737a update()
export function tubUpdate(m: Memory): void {
  // tubWake reads a stale stack word below its frame; keep the near call's return address slot.
  m.push(2);
  tubWake(m);
  m.pop(2);
  if (m.u8(m.u16(UPDATE_OBJECT) + 0x89)) return;
  tubAim(m);
  tubMove(m);
  tubAttack(m);
}

// 0:7392 tubWake(): a dormant tub checks every 0x1400 ticks; it wakes when its cell is free (0:d424) and the
// player is within 0x41 but not within 9, otherwise it stays solid.
export function tubWake(m: Memory): void {
  let cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x89)) return;
  const t = (m.u16(cur + 0x8b) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(cur + 0x8b, t);
  if (t && !(t & 0x8000)) return;
  m.set16(cur + 0x8b, t + 0x1400);
  m.set8(cur + 0x18, 0);
  // The original passes only the object; the out pointer is the uninitialised local at BP-4.
  const out = m.u16((m.sp - 6) & 0xffff);
  if (
    !call(m, "0:d424", cur, out) &&
    (call(m, "0:4027", m.u16(PLAYER), 0x41, 4) & 0xffff) !== 0xffff &&
    !call(m, "0:414b", m.u16(PLAYER), 9)
  ) {
    cur = m.u16(UPDATE_OBJECT);
    m.set8(cur + 0x89, 0);
    m.set8(cur + 0x8d, 1);
    m.set8(cur + 6, 0x29);
    return;
  }
  m.set8(m.u16(UPDATE_OBJECT) + 0x18, 1);
}

// 0:7410 tubAttack(): an attacking tub in step 0x10+ bites the player within 3 (teleport onto him with message 2,
// then message 9); farther away it may once jump (1 in 5).
export function tubAttack(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x85) || !m.u16(PLAYER) || m.u8(cur + 0xc) < 0xf || m.s8(cur + 6) < 0x10) return;
  if (!call(m, "0:414b", m.u16(PLAYER), 3)) {
    if (m.u8(cur + 0x8e)) return;
    m.set8(cur + 0x8e, 1);
    if (call(m, "fff:1176", 5)) return;
    const t = m.u16(UPDATE_OBJECT);
    m.set8(t + 0x8a, 1);
    m.set8(t + 0x8e, 1);
    m.set8(t + 6, 0x22);
    return;
  }
  const msg = m.push(0xe);
  const p = m.u16(PLAYER);
  m.set16(msg + 5, m.u16(p + 7));
  m.set16(msg + 7, m.u16(p + 9));
  m.set16(msg + 2, m.u16(UPDATE_OBJECT));
  m.set16(msg, m.u16(UPDATE_OBJECT));
  if (call(m, "0:2c71", 2, msg)) {
    const c = m.u16(UPDATE_OBJECT);
    m.set8(c + 0x37, 1);
    m.set16(msg, c);
    m.set16(msg + 2, m.u16(PLAYER));
    call(m, "0:2c71", 9, msg);
    m.set8(m.u16(UPDATE_OBJECT) + 0x88, 1);
  }
  m.pop(0xe);
}

// 0:74e0 tubAim(): an idle tub (step 0/1) turns to the player within 0x3c and starts an attack whose damage
// grows with the distance (capped at 0x41 + floor * 3); late steps (0x20+) clear +0x86.
export function tubAim(m: Memory): void {
  if (!m.u16(PLAYER) || m.u8(PLAYER_LIFTED)) return;
  let cur = m.u16(UPDATE_OBJECT);
  if (m.u8(cur + 0x85)) return;
  const step = m.s8(cur + 6);
  if (step !== 0 && step !== 1) {
    if (step >= 0x20) m.set8(cur + 0x86, 0);
    return;
  }
  const angle = call(m, "0:4027", m.u16(PLAYER), 0x3c, 4) & 0xffff;
  if (angle === 0xffff) return;
  cur = m.u16(UPDATE_OBJECT);
  m.set8(cur + 0x3a, angle);
  m.set8(cur + 0x13, (((angle << 16) >> 16) + 4) >> 3 & 7);
  let damage = (call(m, "0:478e", cur, m.u16(PLAYER)) << 2) & 0xffff;
  if (((damage << 16) >> 16) > 0x41) damage = ((m.u8(SCENE) / 50) | 0) * 3 + 0x41;
  cur = m.u16(UPDATE_OBJECT);
  m.set8(cur + 0x87, damage);
  m.set8(cur + 0x85, 1);
  m.set8(cur + 6, 0xb);
  m.set8(cur + 0x17, 0xf);
  m.set16(cur + 0x3f, m.u16(m.u16(PLAYER)));
}

// 0:75bd tubMove(): move along the path (0:3e5f mode 7); while attacking step again twice (0:2a0b, 0:3e95).
export function tubMove(m: Memory): void {
  if (m.u8(m.u16(UPDATE_OBJECT) + 0x88)) return;
  const local = m.push(4);
  call(m, "0:3e5f", local + 2, local, 7);
  const cur = m.u16(UPDATE_OBJECT);
  if (m.u8(cur + 0x85)) {
    call(m, "0:2a0b", cur, local + 2, local);
    call(m, "0:3e95", local + 2, local, 7);
    call(m, "0:2a0b", m.u16(UPDATE_OBJECT), local + 2, local);
    call(m, "0:3e95", local + 2, local, 4);
  }
  m.pop(4);
}

// 0:7634 message(kind, msg): 0 and 8 turn, 2 = 0:4242, 3 = 0:44e4, 9 = shot.
export function tubMessage(m: Memory, kind: number, msg: number): number {
  switch (kind & 0xff) {
    case 0:
      return tubTurn(m, msg);
    case 2:
      return call(m, "0:4242", msg);
    case 3:
      return call(m, "0:44e4", msg);
    case 8:
      return tubTurnShot(m, msg);
    case 9:
      return tubShot(m);
    default:
      return 0;
  }
}

// 0:7698 tubShot(): a shot of a class in list DS:80e kills the tub (0:42bd in the shot's direction) and checks
// whether the room is cleared (0:190f).
export function tubShot(m: Memory): number {
  if (!call(m, "0:5bd0", m.s8(m.u16(SENDER) + 2) & 0xffff, 0x80e)) return 0;
  const s = m.u16(SENDER);
  call(m, "0:42bd", m.u16(RECEIVER), 1, m.s8(s + 0x13) & 0xffff, m.u8(s + 0x3b));
  return call(m, "0:190f", 1);
}

// 0:76de tubTurn(msg): face msg byte 4, drop the aim angle; handled (-1).
export function tubTurn(m: Memory, msg: number): number {
  const r = m.u16(RECEIVER);
  m.set8(r + 0x13, m.u8(msg + 4));
  m.set8(r + 0x3a, 0xff);
  return 0xffff;
}

// 0:76f9 same as 0:76de (message 8).
export function tubTurnShot(m: Memory, msg: number): number {
  return tubTurn(m, msg);
}

// 0:7714 post(): 12cc:07f5.
export function tubPost(m: Memory): void {
  call(m, "12cc:07f5");
}

// 0:771a draw(): nothing while dormant; parts 1 and 0 otherwise.
export function tubDraw(m: Memory): void {
  const d = m.u16(DRAW_OBJECT);
  if (m.u8(d + 0x89)) return;
  call(m, "0:3f81", d, 1);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

// 0:731a init(record, object): fine position, facing = record byte 3 bits 0..2, random start step 0..6.
export function tubInit(m: Memory, record: number, obj: number): void {
  call(m, "0:471d", obj, record);
  m.set8(obj + 6, 4);
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  m.set8(obj + 0x13, b & 7);
  m.set8(obj + 0x16, b & 7);
  m.set8(obj + 0x88, 0);
  m.set8(obj + 6, call(m, "fff:1176", 7));
}

// 0:735d save(object, record): record byte 3 = facing, fine position (0:4693).
export function tubSave(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, m.u8(obj + 0x13));
  call(m, "0:4693", obj, record);
}

register("0:737a", tubUpdate);
register("0:7392", tubWake);
register("0:7410", tubAttack);
register("0:74e0", tubAim);
register("0:75bd", tubMove);
register("0:7634", tubMessage);
register("0:7698", tubShot);
register("0:76de", tubTurn);
register("0:76f9", tubTurnShot);
register("0:7714", tubPost);
register("0:771a", tubDraw);
register("0:731a", tubInit);
register("0:735d", tubSave);
