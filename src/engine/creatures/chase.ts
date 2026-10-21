import { call, register } from "../dispatch.ts";
import { angle } from "../geometry/math.ts";
import type { Memory } from "../memory.ts";
import { PLAYER, UPDATE_OBJECT } from "../props/common.ts";
import { random } from "../random.ts";

// Helpers shared by creatures (SUR, CGEN, 0:a3ee) that chase the player.
// Object fields: +6 moving, +0x13/+0x16 facing (0..7), +0x3a heading (0..63, 0xff none),
// +0x89/+0x8a last seen player x/y, +0xa6 creature profile (+5 toughness), +0xae attack timer.

// 0:973a turnToward(heading): set the facing from heading (0..63) unless it is within half a step
// of the current facing; starts moving when it turns.
export function turnToward(m: Memory, heading: number): void {
  const h = ((heading & 0xff) << 24) >> 24;
  const obj = m.u16(UPDATE_OBJECT);
  const facing = m.s8(obj + 0x16);
  if ((((h + 6) >> 3) & 7) === facing) return;
  if ((((h + 2) >> 3) & 7) === facing) return;
  const dir = ((h + 4) >> 3) & 7;
  m.set8(obj + 0x16, dir);
  m.set8(obj + 0x13, dir);
  m.set8(obj + 6, 1);
}

// 0:9682 chasePlayer(range, arg): head for the player when 0:4027 sees him (returns -1), else for
// his last seen position (returns 1), or 0 when he was never seen.
export function chasePlayer(m: Memory, range: number, arg: number): number {
  let dir = call(m, "0:4027", m.u16(PLAYER), range, arg) & 0xff;
  let result: number;
  if (dir !== 0xff) {
    const player = m.u16(PLAYER);
    const obj = m.u16(UPDATE_OBJECT);
    m.set8(obj + 0x89, m.u8(player + 8));
    m.set8(obj + 0x8a, m.u8(player + 0xa));
    result = 0xffff;
  } else {
    const obj = m.u16(UPDATE_OBJECT);
    if (!m.u8(obj + 0x89)) return 0;
    const dy = ((m.u8(obj + 0x8a) - m.u8(obj + 0xa)) & 0xff) << 8;
    const dx = ((m.u8(obj + 0x89) - m.u8(obj + 8)) & 0xff) << 8;
    dir = angle(m, dx, dy) & 0xff;
    result = 1;
  }
  m.set8(m.u16(UPDATE_OBJECT) + 0x3a, dir);
  turnToward(m, dir);
  const obj = m.u16(UPDATE_OBJECT);
  m.set8(obj + 0x13, call(m, "0:4945", m.s8(obj + 0x3a) & 0xffff));
  return result;
}

// 0:91f2 resetAttackTimer(obj): random attack delay shortened by the profile toughness, plays a growl.
export function resetAttackTimer(m: Memory, obj: number): void {
  const r = random(m, 0x14) + 0x32;
  const v = (r - m.u8(m.u16(obj + 0xa6) + 5)) & 0xffff;
  m.set16(obj + 0xae, ((v << 16) >> 16) >> 1);
  const i = random(m, 5);
  call(m, "0:cff8", m.u16(0x10cb + i * 2), 4, 0x83);
}

register("0:973a", turnToward);
register("0:9682", chasePlayer);
register("0:91f2", resetAttackTimer);
