// Replays calls recorded from the original game (tools/emu/trace.py) against the TypeScript port.
// Usage: bun run difftest [seg:off...]   (default: every recorded function that has a port in tools/ports.ts)
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Memory } from "../src/engine/memory.ts";
import { PORTS } from "./ports.ts";

interface Case {
  memory: string;
  ds: number;
  ss: number;
  sp: number;
  args: number[];
  dac: string;
  dac_after: string;
  ax: number;
  dx: number;
  changes: [number, number][];
}

const ROOT = join(import.meta.dir, "..");
const DIR = join(ROOT, "out", "difftest");
const STACK_SLACK = 0x600;

const wanted = process.argv.slice(2);
let failures = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const { function: label, cases }: { function: string; cases: Case[] } = await Bun.file(join(DIR, file)).json();
  if (wanted.length ? !wanted.includes(label) : !PORTS[label]) continue;
  const port = PORTS[label];
  if (!port) {
    console.log(`${label}: not ported`);
    failures++;
    continue;
  }
  let failed = 0;
  let first = "";
  for (const c of cases) {
    const m = new Memory(c.ds);
    m.bytes.set(Bun.gunzipSync(new Uint8Array(await Bun.file(join(DIR, "mem", `${c.memory}.bin.gz`)).arrayBuffer())));
    m.dac.set(Uint8Array.fromHex(c.dac));
    const start = m.bytes.slice();
    const ret = port.fn(m, ...c.args);
    const problems: string[] = [];
    if (port.returns === "ax" && ((ret ?? 0) & 0xffff) !== c.ax) problems.push(`ax ${ret} want ${c.ax}`);
    if (port.returns === "dx:ax" && (ret ?? 0) >>> 0 !== ((c.dx << 16) | c.ax) >>> 0) problems.push(`dx:ax ${ret} want ${(c.dx << 16) | c.ax}`);
    if (m.dac.toHex() !== c.dac_after) problems.push("DAC differs");
    const expected = new Map(c.changes);
    const stackTop = c.ss * 16 + c.sp;
    const ds = c.ds * 16;
    for (let i = 0; i < m.bytes.length; i++) {
      if (i >= stackTop - STACK_SLACK && i < stackTop + 0x40) continue;
      const want = expected.get(i) ?? start[i];
      if (m.bytes[i] !== want) {
        const where = i >= ds && i < ds + 0x10000 ? `DS:${(i - ds).toString(16)}` : `${i.toString(16)}`;
        problems.push(`${where}=${m.bytes[i]} want ${want}`);
      }
    }
    if (problems.length) {
      failed++;
      first ||= `${c.memory} args ${c.args.map((a) => a.toString(16)).join(",")}: ${problems.slice(0, 8).join(", ")}${problems.length > 8 ? ` (+${problems.length - 8})` : ""}`;
    }
  }
  if (failed) failures++;
  console.log(`${label}: ${cases.length - failed}/${cases.length}${first ? `\n  first failure ${first}` : ""}`);
}
process.exit(failures ? 1 : 0);
