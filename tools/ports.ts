// Ported GAME.EXE functions by original address, collected from tools/ports/*.ts (one file per port module).
import { join } from "node:path";
import type { Memory } from "../src/engine/memory.ts";

export interface Port {
  fn: (m: Memory, ...args: number[]) => number | void;
  // What the original returns: AX, or DX:AX as one 32-bit number.
  returns?: "ax" | "dx:ax";
}

export const PORTS: Record<string, Port> = {};
for (const file of new Bun.Glob("*.ts").scanSync(join(import.meta.dir, "ports"))) {
  const mod: { ports: Record<string, Port> } = await import(join(import.meta.dir, "ports", file));
  for (const [label, port] of Object.entries(mod.ports)) {
    if (PORTS[label]) throw new Error(`${label} is registered twice`);
    PORTS[label] = port;
  }
}
