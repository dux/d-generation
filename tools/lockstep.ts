// Boots the TypeScript port and runs it frame by frame next to memory captured from the original by
// tools/emu/lockstep.py (same timer rule), reporting where memory first differs.
// Usage: bun tools/lockstep.ts [frames]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { bootGame } from "../src/engine/boot.ts";
import { gameFrame } from "../src/engine/core/game.ts";
import { Machine } from "../src/engine/dos/machine.ts";
import "../src/engine/index.ts";
import type { Memory } from "../src/engine/memory.ts";

const ROOT = join(import.meta.dir, "..");
const GAME = join(ROOT, "dgener");
const DIR = join(ROOT, "out", "lockstep");

function gameFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(GAME, path).replaceAll("/", "\\").toUpperCase(), new Uint8Array(readFileSync(path)));
    }
  };
  walk(GAME);
  return files;
}

// Bytes that legitimately differ: the stack (SS = DS, top of DGROUP), the timer handler's own stack, the
// registers and SS:SP of the code it interrupted (its stack DS:2740-27a1, 14c8:010f-0112), and sprintf's cursor (DS:2d4a),
// all of which depend on how deep the original's call stack was.
function ignored(m: Memory, at: number): boolean {
  const ds = m.ds * 16;
  const isr = (m.ds - 0x254b + 0x14c8) * 16;
  if (at >= ds + 0xd000 && at < ds + 0x10000) return true;
  if (at >= ds + 0x2740 && at < ds + 0x27a2) return true;
  if (at >= isr + 0x10f && at < isr + 0x113) return true;
  return at === ds + 0x2d4a || at === ds + 0x2d4b;
}

function compare(m: Memory, name: string): string[] {
  const want = Bun.gunzipSync(new Uint8Array(readFileSync(join(DIR, `${name}.bin.gz`))));
  const ds = m.ds * 16;
  const ranges: string[] = [];
  let start = -1;
  for (let i = 0; i <= want.length; i++) {
    const differs = i < want.length && m.bytes[i] !== want[i] && !ignored(m, i);
    if (differs && start < 0) start = i;
    if (!differs && start >= 0) {
      const where = start >= ds && start < ds + 0x10000 ? `DS:${(start - ds).toString(16)}` : start.toString(16);
      ranges.push(`${where}+${i - start} (${[...m.bytes.subarray(start, Math.min(i, start + 6))]} want ${[...want.subarray(start, Math.min(i, start + 6))]})`);
      start = -1;
    }
  }
  return ranges;
}

const frames = Number(process.argv[2] ?? 20);
const m = bootGame(new Machine(gameFiles()));
for (let k = 0; k <= frames; k++) {
  if (k > 0 && gameFrame(m)) {
    console.log(`frame ${k}: game quit`);
    break;
  }
  if (!existsSync(join(DIR, `${k}.bin.gz`))) continue;
  const diff = compare(m, String(k));
  console.log(`frame ${k}: ${diff.length ? `${diff.length} ranges differ: ${diff.slice(0, 12).join(", ")}` : "identical"}`);
  if (diff.length) break;
}
