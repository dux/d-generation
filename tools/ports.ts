// Ported GAME.EXE functions by original address, collected from tools/ports/*.ts (one file per port module).
import { join } from "node:path";
import type { Memory } from "../src/engine/memory.ts";

// DOS/BIOS/hardware state recorded by tools/emu/trace.py next to memory (it lives in the emulator, not in RAM).
export interface Machine {
  files: Record<string, [path: string | null, position: number, size: number]>;
  next_handle: number;
  alloc_next: number;
  ticks: number;
  retrace: number;
  keys: number[];
  dac_w: number;
}

// One recorded call (out/difftest/<label>.json).
export interface Case {
  memory: string;
  ds: number;
  ss: number;
  sp: number;
  args: number[];
  dac: string;
  dac_after: string;
  machine: Machine;
  machine_after: Machine;
  ax: number;
  dx: number;
  changes: [number, number][];
}

export interface Port {
  fn: (m: Memory, ...args: number[]) => number | void;
  // What the original returns: AX, or DX:AX as one 32-bit number.
  returns?: "ax" | "dx:ax";
  // For ports that use machine state: set it up from the case before the call, and compare it afterwards.
  prepare?: (m: Memory, c: Case) => void;
  check?: (m: Memory, c: Case) => string[];
}

export const PORTS: Record<string, Port> = {};
// Globbed instead of imported statically so each port module owner adds a file without editing a shared list.
for (const file of new Bun.Glob("*.ts").scanSync(join(import.meta.dir, "ports"))) {
  const mod: { ports: Record<string, Port> } = await import(join(import.meta.dir, "ports", file));
  for (const [label, port] of Object.entries(mod.ports)) {
    if (PORTS[label]) throw new Error(`${label} is registered twice`);
    PORTS[label] = port;
  }
}
