import { register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";

// 0:1408 qsort comparator: two object pointers by the y high byte at obj+0xa (back to front).
export function compareDepth(m: Memory, a: number, b: number): number {
  return m.u8(m.u16(a) + 0xa) - m.u8(m.u16(b) + 0xa);
}

register("0:1408", compareDepth);
