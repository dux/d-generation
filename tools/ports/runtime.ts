import type { Memory } from "../../src/engine/memory.ts";
import * as rt from "../../src/engine/runtime.ts";
import type { Port } from "../ports.ts";

// Comparators the game passes to qsort, by near address.
const COMPARATORS: Record<number, (m: Memory, a: number, b: number) => number> = {
  // 0:1408 compares two object pointers by the depth byte at obj+0xa.
  0x1408: (m, a, b) => m.u8(m.u16(a) + 0xa) - m.u8(m.u16(b) + 0xa),
};

export const ports: Record<string, Port> = {
  "0:e46a": { fn: (m) => rt.timerAlloc(m), returns: "ax" },
  "0:e4af": { fn: (m, i) => rt.timerFree(m, i) },
  "0:e4c6": { fn: (m, i, v) => rt.timerSet(m, i, v) },
  "0:e4ec": { fn: (m, i, on) => rt.timerEnable(m, i, on) },
  "0:e51b": { fn: (m, i) => rt.timerFreeze(m, i), returns: "ax" },
  "0:e53f": { fn: (m, i) => rt.timerThaw(m, i), returns: "ax" },
  "0:e55a": { fn: (m, i) => rt.timerGet(m, i), returns: "ax" },
  "0:e56f": { fn: (m, i, v) => rt.timerExchange(m, i, v), returns: "ax" },
  "0:e5d3": { fn: (m, v) => rt.timerSetChain(m, v) },
  "0:e5e0": { fn: (m, v) => rt.timerSetHook(m, v) },
  "0:e5ed": { fn: (m) => rt.timerHookOn(m) },
  "0:e5f4": { fn: (m) => rt.timerHookOff(m) },
  "0:e947": {
    fn: (m, base, count, size, cmp) => {
      const compare = COMPARATORS[cmp];
      if (!compare) throw new Error(`qsort comparator ${cmp.toString(16)} not ported`);
      rt.qsort(m, base, count, size, compare);
    },
  },
  "0:efb0": { fn: (m, a, b, n) => rt.swapBytes(m, a, b, n) },
  "0:ef18": { fn: (m, buf, fmt, ...args) => rt.sprintf(m, buf, fmt, ...args), returns: "ax" },
  "0:ef88": { fn: (m, d, s, n) => rt.strncpy(m, d, s, n), returns: "ax" },
  "0:f104": { fn: (m, d, s, n) => rt.memcpy(m, d, s, n), returns: "ax" },
  "0:f12c": { fn: (m, d, v, n) => rt.memset(m, d, v, n), returns: "ax" },
  "0:f154": { fn: (m, off, seg) => rt.farToLinear(m, off, seg), returns: "dx:ax" },
  "0:f173": { fn: (m, lo, hi) => rt.linearToFar(m, lo, hi), returns: "dx:ax" },
  "0:f194": { fn: (m, s, c) => rt.strchr(m, s, c), returns: "ax" },
  "0:fa32": { fn: (m, a, b) => rt.strcmp(m, a, b), returns: "ax" },
  "0:fa50": { fn: (m, a, b, n) => rt.strncmp(m, a, b, n), returns: "ax" },
  "0:fa99": { fn: (m, s) => rt.strlen(m, s), returns: "ax" },
  "0:feca": { fn: (m, s, d, n) => rt.movmem(m, s, d, n) },
  "0:f536": { fn: (m, size) => rt.malloc(m, size), returns: "ax" },
  "0:f634": { fn: (m, p) => rt.free(m, p), returns: "ax" },
  "0:ff2f": { fn: (m, n) => rt.sbrk(m, n), returns: "ax" },
  "0:ff63": { fn: (m, a) => rt.brk(m, a), returns: "ax" },
  "1485:02c8": { fn: (m) => rt.reset61a8(m) },
  "1485:03bb": { fn: (m, list, count) => rt.extractDying(m, list, count), returns: "ax" },
  "14c8:004d": { fn: (m, off) => rt.farBuffer(m, off), returns: "dx:ax" },
  "14c8:0059": { fn: (m, off, seg) => rt.fpSeg(m, off, seg), returns: "ax" },
  "14c8:0061": { fn: (m, off) => rt.fpOff(m, off), returns: "ax" },
  "14c8:0069": { fn: (m, seg, off, n, v) => rt.farMemsetSegFirst(m, seg, off, n, v) },
  "14c8:0084": { fn: (m, ss, so, ds, dof, n) => rt.farMemcpy(m, ss, so, ds, dof, n) },
  "14c8:0339": { fn: (m, off, seg, v, n) => rt.farMemset(m, off, seg, v, n) },
  "14c8:02df": { fn: (m) => rt.joyRotateAxes(m) },
  "14c8:032a": { fn: (m) => rt.joySwapAxes(m) },
};
