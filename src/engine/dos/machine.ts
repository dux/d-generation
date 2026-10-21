// The DOS, BIOS and hardware the game talks to, with the same behaviour as tools/emu/dosemu.py (the emulator the
// difftest cases come from): DOS file handles from 5, DOS memory blocks after the PSP, the int 21h/16h/10h subset,
// the VGA DAC and retrace ports, the BIOS tick count at 0:046c. The interrupt vector table lives in memory (0:0000).
// Ported code calls int21/int10/int16/intr and inPort/outPort; the browser drives the timer and keyboard IRQs.
import { call } from "../dispatch.ts";
import type { Memory } from "../memory.ts";

export interface Regs {
  ax: number;
  bx: number;
  cx: number;
  dx: number;
  si: number;
  di: number;
  ds: number;
  es: number;
  flags: number;
}

export const CF = 0x01;
export const ZF = 0x40;

export const PSP = 0x0800;
const HEAP_TOP = 0x9fff;
// Every vector starts at an `iret` stub in the BIOS segment.
const STUB_SEG = 0xf000;
const STUB_OFF = 0xff00;
const BIOS_TICKS = 0x46c;
const BIOS_VIDEO_MODE = 0x449;
// Data segment paragraph in the load image; the code segments sit at the same distance below DS as in GAME.EXE.
const IMAGE_DS = 0x254b;

export interface OpenFile {
  data: Uint8Array;
  pos: number;
  // DOS path of a file opened from the game folder, null for a created file.
  path: string | null;
  // Name of a created file: its data goes into the game files when it is closed (save games).
  created?: string;
}

export class Machine {
  readonly open = new Map<number, OpenFile>();
  nextHandle = 5;
  allocNext = 0x9000;
  // BIOS keyboard buffer: scancode << 8 | ascii, read by int 16h.
  keys: number[] = [];
  retrace = 0;
  dacWrite = 0;
  ticks = 0;
  // Last byte on the keyboard data port (60h).
  scancode = 0;
  // PIT channel 0 reload value written through port 40h (low byte, then high byte); 0 means 65536.
  pitDivisor = 0;
  pitHighByte = false;
  // BIOS shift state (1 left, 2 right) for translating scancodes.
  shift = 0;
  // Text written to stdout/stderr.
  output = "";
  exitCode: number | null = null;
  // Called before every timer interrupt delivered by a wait loop (dos/hardware.ts waitTick): the browser sleeps
  // until the tick is due; tests leave it unset.
  pace?: () => void;
  // Game files by normalized DOS path.
  readonly files = new Map<string, Uint8Array>();

  // files: game files by DOS path relative to the game folder ("DATA\\SCENE1.DLT"), any case.
  constructor(files: Iterable<[string, Uint8Array]> = []) {
    for (const [name, data] of files) this.files.set(normalize(name), data);
  }
}

// Thrown by DOS function 4Ch (exit); the game is over when it reaches the caller.
export class DosExit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

const machines = new WeakMap<Memory, Machine>();

export function attachMachine(m: Memory, machine: Machine): Machine {
  machines.set(m, machine);
  return machine;
}

export function machine(m: Memory): Machine {
  return machines.get(m) ?? attachMachine(m, new Machine());
}

// Paragraph of an image code segment (e.g. 0x14c8) in memory.
export function codeSegment(m: Memory, seg: number): number {
  return (m.ds - IMAGE_DS + seg) & 0xffff;
}

export function regs(m: Memory, init: Partial<Regs> = {}): Regs {
  return { ax: 0, bx: 0, cx: 0, dx: 0, si: 0, di: 0, ds: m.ds, es: m.ds, flags: 0, ...init };
}

// Path relative to the game folder in upper case ("C:\\DGENER\\data/x.dat" -> "DATA\\X.DAT").
export function normalize(name: string): string {
  let path = name.replace(/\//g, "\\");
  if (path.includes(":")) path = path.slice(path.indexOf(":") + 1);
  path = path.replace(/^\\+/, "");
  if (path.toUpperCase().startsWith("DGENER\\")) path = path.slice(7);
  return path
    .split("\\")
    .filter((p) => p && p !== ".")
    .join("\\")
    .toUpperCase();
}

function cstr(m: Memory, seg: number, off: number): string {
  let s = "";
  for (let i = 0; i < 128; i++) {
    const c = m.bytes[seg * 16 + ((off + i) & 0xffff)];
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function linear(seg: number, off: number): number {
  return (seg * 16 + (off & 0xffff)) & 0xfffff;
}

function ok(r: Regs, ax?: number): void {
  if (ax !== undefined) r.ax = ax & 0xffff;
  r.flags &= ~CF;
}

function err(r: Regs, code: number): void {
  r.ax = code;
  r.flags |= CF;
}

export function getVector(m: Memory, n: number): { seg: number; off: number } {
  const at = (n & 0xff) * 4;
  return { off: m.bytes[at] | (m.bytes[at + 1] << 8), seg: m.bytes[at + 2] | (m.bytes[at + 3] << 8) };
}

export function setVector(m: Memory, n: number, seg: number, off: number): void {
  const at = (n & 0xff) * 4;
  m.bytes[at] = off & 0xff;
  m.bytes[at + 1] = (off >> 8) & 0xff;
  m.bytes[at + 2] = seg & 0xff;
  m.bytes[at + 3] = (seg >> 8) & 0xff;
}

export function isStub(seg: number, off: number): boolean {
  return seg === STUB_SEG && off === STUB_OFF;
}

// Runs the ported handler a far pointer points to (an ISR installed by the game). Returns its result.
export function callFar(m: Memory, seg: number, off: number): number {
  const image = (seg - (m.ds - IMAGE_DS)) & 0xffff;
  return call(m, `${image.toString(16)}:${off.toString(16).padStart(4, "0")}`);
}

// Default handlers behind the stub vectors. The emulator's stub is a bare `iret`; only the keyboard IRQ, which
// the emulator never raises, gets the BIOS behaviour (key into the int 16h buffer).
function bios(m: Memory, n: number): void {
  if (n === 9) biosKeyboard(m, machine(m).scancode);
}

// Interrupt n (IRQ, or `int n` to a vector the game installed): the CPU pushes flags, CS and IP on the interrupted
// stack and enters the handler.
export function raise(m: Memory, n: number): void {
  const v = getVector(m, n);
  if (isStub(v.seg, v.off)) {
    bios(m, n);
    return;
  }
  m.push(6);
  callFar(m, v.seg, v.off);
  m.pop(6);
}

// A handler of vector n jumping to the previous handler seg:off, which returns through the same frame.
export function chain(m: Memory, n: number, seg: number, off: number): void {
  if (isStub(seg, off)) bios(m, n);
  else callFar(m, seg, off);
}

// `int n` executed by the game. DOS, video and keyboard services are always the machine's own.
export function intr(m: Memory, n: number, r: Regs): void {
  const v = getVector(m, n);
  if (n !== 0x21 && n !== 0x10 && n !== 0x16 && !isStub(v.seg, v.off)) {
    raise(m, n);
    return;
  }
  const mc = machine(m);
  switch (n) {
    case 0x21:
      int21(m, r);
      break;
    case 0x10:
      int10(m, r);
      break;
    case 0x16:
      int16(m, r);
      break;
    case 0x1a:
      r.cx = 0;
      r.dx = mc.ticks & 0xffff;
      break;
    case 0x33:
      r.ax = 0;
      break;
    case 0x11:
      r.ax = 0x0021;
      break;
    case 0x12:
      r.ax = 640;
      break;
    case 0x15:
      r.flags |= CF;
      break;
  }
}

export function int10(m: Memory, r: Regs): void {
  const ah = r.ax >> 8;
  if (ah === 0x0f) {
    r.ax = m.bytes[BIOS_VIDEO_MODE] === 3 ? 0x5003 : 0x2813;
    r.bx = 0;
  } else if (ah === 0x00) {
    m.bytes[BIOS_VIDEO_MODE] = r.ax & 0x7f;
  } else if (ah === 0x10 && (r.ax & 0xff) === 0x12) {
    const src = linear(r.es, r.dx);
    for (let i = r.bx * 3; i < (r.bx + r.cx) * 3 && i < 768; i++) m.dac[i] = m.bytes[src + i - r.bx * 3];
  } else if (ah === 0x1a) {
    r.ax = 0x001a;
    r.bx = 0x0008;
  } else if (ah === 0x12) {
    r.bx = 0x0003;
    r.cx = 0x0009;
  }
}

export function int16(m: Memory, r: Regs): void {
  const ah = r.ax >> 8;
  const keys = machine(m).keys;
  if (ah === 0x01 || ah === 0x11) {
    if (keys.length) {
      r.ax = keys[0];
      r.flags &= ~ZF;
    } else {
      r.flags |= ZF;
    }
  } else if (ah === 0x00 || ah === 0x10) {
    // An empty buffer returns Esc instead of waiting, as in the emulator.
    r.ax = keys.shift() ?? 0x011b;
  } else if (ah === 0x02) {
    r.ax = 0;
  }
}

export function int21(m: Memory, r: Regs): void {
  const mc = machine(m);
  const ah = r.ax >> 8;
  const al = r.ax & 0xff;
  switch (ah) {
    case 0x30:
      r.ax = 0x0005;
      r.bx = 0;
      r.cx = 0;
      break;
    case 0x25:
      setVector(m, al, r.ds, r.dx);
      break;
    case 0x35: {
      const v = getVector(m, al);
      r.bx = v.off;
      r.es = v.seg;
      break;
    }
    case 0x4a:
      if (r.es === PSP) mc.allocNext = r.es + r.bx + 1;
      ok(r);
      break;
    case 0x48:
      if (r.bx === 0xffff || mc.allocNext + r.bx > HEAP_TOP) {
        r.bx = Math.max(0, HEAP_TOP - mc.allocNext) & 0xffff;
        err(r, 8);
      } else {
        const seg = mc.allocNext;
        mc.allocNext += r.bx + 1;
        ok(r, seg);
      }
      break;
    case 0x49:
      ok(r);
      break;
    case 0x3d: {
      const path = normalize(cstr(m, r.ds, r.dx));
      const data = mc.files.get(path);
      if (!data) {
        err(r, 2);
        break;
      }
      const handle = mc.nextHandle++;
      mc.open.set(handle, { data: data.slice(), pos: 0, path });
      ok(r, handle);
      break;
    }
    case 0x3c: {
      const handle = mc.nextHandle++;
      mc.open.set(handle, { data: new Uint8Array(0), pos: 0, path: null, created: normalize(cstr(m, r.ds, r.dx)) });
      ok(r, handle);
      break;
    }
    case 0x3e: {
      const f = mc.open.get(r.bx);
      if (f?.created) mc.files.set(f.created, f.data);
      mc.open.delete(r.bx);
      ok(r);
      break;
    }
    case 0x3f: {
      const f = mc.open.get(r.bx);
      if (!f) {
        ok(r, 0);
        break;
      }
      const chunk = f.data.subarray(Math.min(f.pos, f.data.length), Math.min(f.pos + r.cx, f.data.length));
      const dst = linear(r.ds, r.dx);
      for (let i = 0; i < chunk.length; i++) m.bytes[(dst + i) & 0xfffff] = chunk[i];
      f.pos += chunk.length;
      ok(r, chunk.length);
      break;
    }
    case 0x40: {
      const src = linear(r.ds, r.dx);
      const data = m.bytes.slice(src, src + r.cx);
      if (r.bx === 1 || r.bx === 2) {
        mc.output += String.fromCharCode(...data);
      } else {
        const f = mc.open.get(r.bx);
        if (f) {
          // Python slice assignment: a write past the end appends.
          const at = Math.min(f.pos, f.data.length);
          const tail = f.data.subarray(Math.min(at + r.cx, f.data.length));
          const grown = new Uint8Array(at + data.length + tail.length);
          grown.set(f.data.subarray(0, at));
          grown.set(data, at);
          grown.set(tail, at + data.length);
          f.data = grown;
          f.pos += r.cx;
        }
      }
      ok(r, r.cx);
      break;
    }
    case 0x42: {
      const f = mc.open.get(r.bx);
      if (!f) {
        err(r, 6);
        break;
      }
      const offset = ((r.cx << 16) | r.dx) | 0;
      const base = [0, f.pos, f.data.length][al] ?? 0;
      f.pos = base + offset;
      r.dx = (f.pos >> 16) & 0xffff;
      ok(r, f.pos & 0xffff);
      break;
    }
    case 0x44:
      if (al === 0) {
        r.dx = r.bx < 5 ? 0x80d3 : 0x0002;
        ok(r);
      } else {
        ok(r, 0);
      }
      break;
    case 0x4c:
      mc.exitCode = al;
      throw new DosExit(al);
    case 0x2a:
      r.cx = 1991;
      r.dx = 0x0101;
      ok(r);
      break;
    case 0x2c:
      r.cx = 0x0c00;
      r.dx = mc.ticks & 0xff;
      ok(r);
      break;
    case 0x19:
      ok(r, 2);
      break;
    case 0x0e:
      ok(r, 5);
      break;
    case 0x47: {
      const dst = linear(r.ds, r.si);
      [..."DGENER\0"].forEach((c, i) => (m.bytes[dst + i] = c.charCodeAt(0)));
      ok(r);
      break;
    }
    case 0x4e:
      err(r, 18);
      break;
    case 0x0b:
      ok(r, 0);
      break;
    default:
      ok(r);
  }
}

// `in al, dx`
export function inPort(m: Memory, port: number): number {
  const mc = machine(m);
  switch (port & 0xffff) {
    case 0x3da:
      mc.retrace ^= 0x09;
      return mc.retrace;
    case 0x60:
      return mc.scancode;
    case 0x201:
      return 0xf0;
    default:
      return 0;
  }
}

// `out dx, al`
export function outPort(m: Memory, port: number, value: number): void {
  const mc = machine(m);
  switch (port & 0xffff) {
    case 0x3c8:
      mc.dacWrite = (value & 0xff) * 3;
      break;
    case 0x3c9:
      if (mc.dacWrite < 768) m.dac[mc.dacWrite++] = value & 0x3f;
      break;
    case 0x40:
      mc.pitDivisor = mc.pitHighByte ? (mc.pitDivisor & 0xff) | ((value & 0xff) << 8) : value & 0xff;
      mc.pitHighByte = !mc.pitHighByte;
      break;
  }
}

// --- Driving the machine from the host (browser).

const PIT_HZ = 1193182;

// Timer IRQ rate in Hz for the current PIT divisor (the game programs 0x3fff: ~72.8 Hz).
export function timerRate(m: Memory): number {
  return PIT_HZ / (machine(m).pitDivisor || 0x10000);
}

// IRQ 0, to be raised timerRate(m) times per second. As in the emulator, the BIOS tick count at 0:046c advances
// once per timer interrupt (the game never reads it).
export function timerInterrupt(m: Memory): void {
  const mc = machine(m);
  mc.ticks = (mc.ticks + 1) & 0xffff;
  m.bytes.set([mc.ticks & 0xff, mc.ticks >> 8, 0, 0], BIOS_TICKS);
  raise(m, 8);
}

// US keyboard: scancode -> [ascii, shifted ascii] for the BIOS buffer.
const ASCII: Record<number, [number, number]> = {};
const ROWS: [number, string, string][] = [
  [0x02, "1234567890-=", "!@#$%^&*()_+"],
  [0x10, "qwertyuiop[]", "QWERTYUIOP{}"],
  [0x1e, "asdfghjkl;'`", 'ASDFGHJKL:"~'],
  [0x2b, "\\zxcvbnm,./", "|ZXCVBNM<>?"],
];
for (const [first, plain, shifted] of ROWS) {
  for (let i = 0; i < plain.length; i++) ASCII[first + i] = [plain.charCodeAt(i), shifted.charCodeAt(i)];
}
ASCII[0x01] = [0x1b, 0x1b];
ASCII[0x0e] = [0x08, 0x08];
ASCII[0x0f] = [0x09, 0x09];
ASCII[0x1c] = [0x0d, 0x0d];
ASCII[0x39] = [0x20, 0x20];
const LEFT_SHIFT = 0x2a;
const RIGHT_SHIFT = 0x36;

// BIOS keyboard handler (INT 09h default): make codes go into the int 16h buffer (function keys and arrows
// with ascii 0), shift state is tracked.
function biosKeyboard(m: Memory, scancode: number): void {
  const mc = machine(m);
  const code = scancode & 0x7f;
  const release = (scancode & 0x80) !== 0;
  if (code === LEFT_SHIFT || code === RIGHT_SHIFT) {
    const bit = code === LEFT_SHIFT ? 1 : 2;
    mc.shift = release ? mc.shift & ~bit : mc.shift | bit;
    return;
  }
  if (release) return;
  const keys = mc.keys;
  if (keys.length >= 15) return;
  const ascii = ASCII[code]?.[mc.shift ? 1 : 0] ?? 0;
  keys.push((code << 8) | ascii);
}

// IRQ 1: a byte from the keyboard (make code, or break code = make | 80h) on port 60h.
export function keyboardInterrupt(m: Memory, scancode: number): void {
  machine(m).scancode = scancode & 0xff;
  raise(m, 9);
}
