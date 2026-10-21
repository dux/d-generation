import { join } from "node:path";
import * as files from "../../src/engine/dos/files.ts";
import * as hw from "../../src/engine/dos/hardware.ts";
import { Machine, attachMachine, machine, normalize } from "../../src/engine/dos/machine.ts";
import * as stdio from "../../src/engine/dos/stdio.ts";
import type { Memory } from "../../src/engine/memory.ts";
import type { Case, Port } from "../ports.ts";

const GAME = join(import.meta.dir, "..", "..", "dgener");
const gameFiles: [string, Uint8Array][] = [];
for (const name of new Bun.Glob("**/*").scanSync({ cwd: GAME })) {
  gameFiles.push([name, new Uint8Array(await Bun.file(join(GAME, name)).arrayBuffer())]);
}

// The DOS state of the case: open files (with the game's data), handles, DOS memory, ticks, ports, keys.
function prepare(m: Memory, c: Case): void {
  const mc = attachMachine(m, new Machine(gameFiles));
  if (!c.machine) return;
  for (const [handle, [path, pos, size]] of Object.entries(c.machine.files)) {
    const data = path === null ? new Uint8Array(size) : mc.files.get(normalize(path))?.slice();
    if (!data) throw new Error(`game file ${path} missing`);
    mc.open.set(Number(handle), { data, pos, path: path === null ? null : normalize(path) });
  }
  mc.nextHandle = c.machine.next_handle;
  mc.allocNext = c.machine.alloc_next;
  mc.ticks = c.machine.ticks;
  mc.retrace = c.machine.retrace;
  mc.keys = [...c.machine.keys];
  mc.dacWrite = c.machine.dac_w;
}

function check(m: Memory, c: Case): string[] {
  if (!c.machine_after) return ["case recorded without the DOS machine state (record it again)"];
  const mc = machine(m);
  const want = c.machine_after;
  const problems: string[] = [];
  const open = [...mc.open].map(([h, f]) => `${h}:${f.path}@${f.pos}/${f.data.length}`).join(" ");
  const wantOpen = Object.entries(want.files)
    .map(([h, [path, pos, size]]) => `${h}:${path === null ? null : normalize(path)}@${pos}/${size}`)
    .join(" ");
  if (open !== wantOpen) problems.push(`files ${open} want ${wantOpen}`);
  // The VGA ports (vga.ts, geometry) write the DAC directly and skip retrace waits, so the DAC index and the
  // retrace toggle are not compared (the DAC contents are).
  const scalars: [string, number, number][] = [
    ["next_handle", mc.nextHandle, want.next_handle],
    ["alloc_next", mc.allocNext, want.alloc_next],
    ["ticks", mc.ticks, want.ticks],
  ];
  for (const [name, got, expected] of scalars) if (got !== expected) problems.push(`${name} ${got} want ${expected}`);
  if (mc.keys.join() !== want.keys.join()) problems.push(`keys ${mc.keys} want ${want.keys}`);
  return problems;
}

// For ports of any module that reach DOS, BIOS or the hardware: `{ fn, ...machineState }`.
export const machineState = { prepare, check };
const io = machineState;

// The timer handler pushes the registers of the code it interrupted (DS:2792-27a1, BP at DS:278c) on its own
// stack; cases do not record those registers, so they are taken from the recorded result.
function prepareTimerInterrupt(m: Memory, c: Case): void {
  prepare(m, c);
  const ds = c.ds * 16;
  for (const [at, value] of c.changes) {
    const off = at - ds;
    if (off === 0x278c || off === 0x278d || (off >= 0x2792 && off < 0x27a2)) m.bytes[at] = value;
  }
}

export const ports: Record<string, Port> = {
  "0:efd5": { fn: (m, lo, hi) => files.farmalloc(m, lo, hi), returns: "dx:ax", ...io },
  "0:f00b": { fn: (m, off, seg) => files.farfree(m, off, seg), returns: "ax", ...io },
  "0:f04e": { fn: (m, n, input, output) => files.int86x(m, n, input, output), ...io },
  "0:f0cf": { fn: (m, ax, bx, cx, dx, ds, di, si) => files.dosCall(m, ax, bx, cx, dx, ds, di, si), returns: "ax", ...io },
  "0:fab6": { fn: (m, ax, a, b) => files.dosPathCall(m, ax, a, b), returns: "ax", ...io },
  "0:f99c": { fn: (m, path, oflag) => files.open(m, path, oflag), returns: "ax", ...io },
  "0:fd49": { fn: (m, h, buf, n) => files.rawRead(m, h, buf, n), returns: "ax", ...io },
  "0:fd53": { fn: (m, h, buf, n) => files.rawWrite(m, h, buf, n), returns: "ax", ...io },
  "0:fd5d": { fn: (m, h, buf, n) => files.read(m, h, buf, n), returns: "ax", ...io },
  "0:fd64": { fn: (m, h, buf, n) => files.write(m, h, buf, n), returns: "ax", ...io },
  "0:fd93": { fn: (m, h) => files.close(m, h), returns: "ax", ...io },
  "0:fdab": { fn: (m, h, lo, hi, whence) => files.lseek(m, h, lo, hi, whence), returns: "dx:ax", ...io },
  "0:fdca": { fn: (m, path) => files.unlink(m, path), returns: "ax", ...io },
  "0:ff0f": { fn: (m, h) => files.isatty(m, h), returns: "ax", ...io },
  "0:fe03": { fn: (m, h, buf, n) => files.consoleRead(m, h, buf, n), returns: "ax", ...io },
  "0:fe68": { fn: (m, h, buf, n) => files.consoleWrite(m, h, buf, n), returns: "ax", ...io },
  "0:fc40": { fn: (m, status) => files.exitNow(m, status), ...io },
  "0:fd35": { fn: (m, status) => files.exit(m, status), ...io },
  "0:fc69": { fn: (m, tail, argc) => files.start(m, tail, argc), ...io },
  "0:fc65": { fn: () => files.noExitHook(), returns: "ax", ...io },
  "0:fd47": { fn: () => files.startupCheck(), ...io },
  "0:f460": { fn: (m) => stdio.freeStream(m), returns: "ax", ...io },
  "0:f1b3": { fn: (m, name, mode) => stdio.fopen(m, name, mode), returns: "ax", ...io },
  "0:f1d7": { fn: (m, name, mode, fp) => stdio.freopen(m, name, mode, fp), returns: "ax", ...io },
  "0:f326": { fn: (m, fp) => stdio.fclose(m, fp), returns: "ax", ...io },
  "0:f310": { fn: (m) => stdio.fcloseall(m), ...io },
  "0:f47e": { fn: (m, fp) => stdio.allocBuffer(m, fp), ...io },
  "0:f3a1": { fn: (m, fp, c) => stdio.flushBuffer(m, fp, c), returns: "ax", ...io },
  "0:f2dc": { fn: (m, c, fp) => stdio.fputc(m, c, fp), returns: "ax", ...io },
  "0:f2a9": { fn: (m, c, fp) => stdio.fputcText(m, c, fp), returns: "ax", ...io },
  "0:f295": { fn: (m, c) => stdio.putStdout(m, c), ...io },
  "0:f27d": { fn: (m, fmt, ...args) => stdio.printf(m, fmt, ...args), returns: "ax", ...io },
  "0:f23b": { fn: (m, buf, size, count, fp) => stdio.fwrite(m, buf, size, count, fp), returns: "ax", ...io },
  "0:e8a1": { fn: (m, fp) => stdio.fgetc(m, fp), returns: "ax", ...io },
  "0:e7b1": { fn: (m, buf, size, count, fp) => stdio.fread(m, buf, size, count, fp), returns: "ax", ...io },
  "0:e85f": { fn: (m, fp) => stdio.fgetcText(m, fp), returns: "ax", ...io },
  "0:e91d": { fn: (m, c, fp) => stdio.ungetc(m, c, fp), returns: "ax", ...io },
  "0:e802": { fn: (m, fmt, ...args) => stdio.scanf(m, fmt, ...args), returns: "ax", ...io },
  "0:ea58": { fn: (m, source, fmt, ...args) => stdio.sscanf(m, source, fmt, ...args), returns: "ax", ...io },
  "0:eabe": { fn: (m, getc, fmt, args) => stdio.scanner(m, getc, fmt, args), returns: "ax", ...io },
  "0:edd7": { fn: (m) => stdio.skipSpace(m), returns: "ax", ...io },
  "0:ee05": { fn: (m, d, v, base, out) => stdio.scanNumber(m, d, v, base, out), returns: "ax", ...io },
  "0:e820": { fn: (m, op) => stdio.scanStdin(m, op), returns: "ax", ...io },
  "0:ea7b": { fn: (m, op) => stdio.scanString(m, op), returns: "ax", ...io },
  "0:ef5b": { fn: (m, port) => hw.inportb(m, port), returns: "ax", ...io },
  "0:ef70": { fn: (m, port, value) => hw.outportb(m, port, value), ...io },
  "14c8:034f": { fn: (m, port) => hw.inportbFar(m, port), returns: "ax", ...io },
  "14c8:01e5": { fn: () => hw.disable(), ...io },
  "14c8:01e7": { fn: () => hw.enable(), ...io },
  "14c8:002a": { fn: (m, n, off, seg) => hw.setvect(m, n, off, seg), ...io },
  "14c8:003b": { fn: (m, n) => hw.getvect(m, n), returns: "dx:ax", ...io },
  "14c8:0117": { fn: (m, off, seg) => hw.setOldTimer(m, off, seg), ...io },
  "14c8:01cb": { fn: (m, off, seg) => hw.setOldKeyboard(m, off, seg), ...io },
  "14c8:0131": { fn: (m, divisor) => hw.setTimerDivisor(m, divisor), ...io },
  "0:e346": { fn: (m) => hw.timerTick(m), returns: "ax", ...io },
  "14c8:00a8": { fn: (m) => hw.timerInterruptHandler(m), prepare: prepareTimerInterrupt, check },
  "14c8:0141": { fn: (m) => hw.keyboardInterruptHandler(m), ...io },
  "0:e3b3": { fn: (m) => hw.timerInstall(m), ...io },
  "0:e41f": { fn: (m) => hw.timerRestore(m), ...io },
  "0:e5fb": { fn: (m) => hw.keyboardInstall(m), ...io },
  "0:e62b": { fn: (m) => hw.keyboardRestore(m), ...io },
  "0:e345": { fn: () => hw.noTimerHook(), ...io },
  "0:e740": { fn: (m, ax) => hw.translateKey(m, ax), returns: "ax", ...io },
  "0:e719": { fn: (m) => hw.getch(m), returns: "ax", ...io },
  "0:e732": { fn: (m) => hw.kbhit(m), returns: "ax", ...io },
  "0:e75b": { fn: (m, c) => hw.echo(m, c), returns: "ax", ...io },
  "0:e79a": { fn: (m, ax, bx, cx, dx) => hw.video(m, ax, bx, cx, dx), returns: "ax", ...io },
  "14c8:01e9": { fn: (m, x, y) => hw.readJoystick(m, x, y), returns: "ax", ...io },
  "14c8:02af": { fn: (m) => hw.joystickPresent(m), returns: "ax", ...io },
  "14fd:000a": { fn: (m) => hw.detectAdapter(m), returns: "ax", ...io },
  "fff:2bd5": { fn: (m) => hw.restoreVideo(m), returns: "ax", ...io },
};
