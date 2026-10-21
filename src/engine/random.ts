import type { Memory } from "./memory.ts";
import { register } from "./dispatch.ts";

const SEED_A = 0x3922;
const SEED_B = 0x3923;
const DEMO_PLAYBACK = 0x1987;
const DEMO_RECORD = 0x1986;

// fff:1176 random(range): two 8-bit linear congruential generators. Returns 0..range-1, or a raw byte
// when range is 0. Demo playback/recording resets the seed every call so demos replay identically.
export function random(m: Memory, range: number): number {
  if (m.u8(DEMO_PLAYBACK) || m.u8(DEMO_RECORD)) m.set16(SEED_A, 0x898d);
  const a = (m.u8(SEED_A) * 17 + 0xa1) & 0xff;
  m.set8(SEED_A, a);
  const b = (m.u8(SEED_B) * 31 + 0xbf) & 0xff;
  m.set8(SEED_B, b);
  const mixed = (a + b) & 0xff;
  return range ? ((mixed * range) >> 8) & 0xff : mixed;
}

register("fff:1176", random);
