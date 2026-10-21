import type { Memory } from "./memory.ts";

// The original calls code through pointers stored in memory: class descriptors (DS:191d), qsort comparators,
// for-each callbacks, timer hooks. Ports register under their original address so those pointers resolve.

export type Ported = (m: Memory, ...args: number[]) => number | void;

const table = new Map<string, Ported>();

// label: "seg:off" with lowercase hex and a 4-digit offset, e.g. "0:4a69", "fff:1176".
export function register(label: string, fn: Ported): void {
  if (table.has(label)) throw new Error(`${label} registered twice`);
  table.set(label, fn);
}

// Near call through a code pointer of segment 0 (the original `call word ptr [...]`).
export function callNear(m: Memory, offset: number, ...args: number[]): number {
  return call(m, `0:${(offset & 0xffff).toString(16).padStart(4, "0")}`, ...args);
}

export function call(m: Memory, label: string, ...args: number[]): number {
  const fn = table.get(label);
  if (!fn) throw new Error(`no port registered for ${label}`);
  return fn(m, ...args) ?? 0;
}
