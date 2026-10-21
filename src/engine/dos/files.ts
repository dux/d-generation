// Borland C runtime on top of DOS: handle-level file I/O, DOS call wrappers, far heap, program start and exit.
import { call, callNear, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { movmem, sbrk } from "../runtime.ts";
import { CF, type Regs, int21, intr, regs } from "./machine.ts";

const ERRNO = 0x2bd8;
// Per handle 0..: 1 when the handle is a console device (reads and writes go through the console handlers).
export const IS_CONSOLE = 0x2c1c;
// Near handlers for console handles: read (0:fe03) and write (0:fe68).
const CONSOLE_READ = 0x2c30;
const CONSOLE_WRITE = 0x2c32;
// Line buffer of the console reader: remaining count, read pointer, buffer (0x104 bytes).
const CONSOLE_LEFT = 0x99b0;
const CONSOLE_NEXT = 0x2e5a;
const CONSOLE_BUFFER = 0x2d56;
const CONSOLE_BUFFER_SIZE = 0x104;
const NEWLINE = 0x2c34;
const CARRIAGE_RETURN = 0x2c35;
// Near routine exit() runs first: 0:fc65 (nothing) until stdio output is buffered, then 0:f310 (close all streams).
export const EXIT_HOOK = 0x2c02;
const ARGC = 0x2d52;
const ARGV = 0x2d54;
const PROGRAM_NAME = 0x2c04;
const TOO_MANY_ARGS = 0x2c05;

function dos(m: Memory, init: Partial<Regs>): Regs {
  const r = regs(m, init);
  int21(m, r);
  return r;
}

// AX, or -1 with errno set when DOS reports an error.
function result(m: Memory, r: Regs): number {
  if (!(r.flags & CF)) return r.ax;
  m.set16(ERRNO, r.ax);
  return 0xffff;
}

// 0, or -1 with errno set when DOS reports an error.
function status(m: Memory, r: Regs): number {
  return result(m, r) === 0xffff && r.flags & CF ? 0xffff : 0;
}

// 0:efd5 farmalloc(lo, hi): DOS block of hi:lo bytes; far pointer seg:0 as DX:AX, 0 when it fails.
export function farmalloc(m: Memory, lo: number, hi: number): number {
  if (hi & 0x8000) return 0;
  const paras = (hi * 0x10000 + lo + 0xf) >>> 4;
  if (paras > 0xffff) return 0;
  const r = dos(m, { ax: 0x4800, bx: paras });
  return r.flags & CF ? 0 : r.ax * 0x10000;
}

// 0:f00b farfree(off, seg): 0, or -1 when DOS refuses.
export function farfree(m: Memory, _off: number, seg: number): number {
  return dos(m, { ax: 0x4900, es: seg }).flags & CF ? 0xffff : 0;
}

// 0:f04e int86x(n, in, out): `int n` with the REGS at in (ax bx cx dx si di ds es), results to out; returns FLAGS.
export function int86x(m: Memory, n: number, input: number, output: number): number {
  const r = regs(m, {
    ax: m.u16(input),
    bx: m.u16(input + 2),
    cx: m.u16(input + 4),
    dx: m.u16(input + 6),
    si: m.u16(input + 8),
    di: m.u16(input + 0xa),
    ds: m.u16(input + 0xc),
    es: m.u16(input + 0xe),
    flags: 0x0202,
  });
  intr(m, n & 0xff, r);
  [r.ax, r.bx, r.cx, r.dx, r.si, r.di, r.ds, r.es].forEach((v, i) => m.set16(output + i * 2, v));
  return r.flags;
}

// 0:f0cf dos_call(ax, bx, cx, dx, ds, di, si): int 21h (AH = AL when AH is 0); AX, or -1 with errno.
export function dosCall(m: Memory, ax: number, bx: number, cx: number, dx: number, ds: number, di: number, si: number): number {
  if (!(ax >> 8)) ax = (ax << 8) & 0xffff;
  return result(m, dos(m, { ax, bx, cx, dx, ds, di, si }));
}

// 0:fab6 dos_path_call(ax, a, b): int 21h with DS:DX = a and CX = b (DS:SI = a, DX = b for 47h); AX, or -1 with
// errno. Functions below 0Ah return AL.
export function dosPathCall(m: Memory, ax: number, a: number, b: number): number {
  if (!(ax >> 8)) ax = (ax << 8) & 0xffff;
  if (ax >> 8 < 0x0a) return dos(m, { ax, dx: a }).ax & 0xff;
  return result(m, dos(m, ax >> 8 === 0x47 ? { ax, si: a, dx: b } : { ax, dx: a, cx: b }));
}

// 0:f99c open(path, oflag): Borland O_* flags (100h create, 200h truncate, 400h exclusive, 800h append); the
// handle, or -1 with errno.
export function open(m: Memory, path: number, oflag: number): number {
  const fn = oflag & 0x200 ? 0x3c00 : (oflag & 0xf3) | 0x3d00;
  let handle = dosPathCall(m, fn, path, 0);
  if (handle === 0xffff) {
    if (oflag & 0x100) handle = dosPathCall(m, 0x3c, path, 0);
  } else if (oflag & 0x400) {
    close(m, handle);
    m.set16(ERRNO, 0x13);
    return 0xffff;
  }
  if (!(handle & 0x8000)) {
    if (oflag & 0x800) lseek(m, handle, 0, 0, 2);
    m.set8(IS_CONSOLE + handle, isatty(m, handle));
  }
  return handle;
}

function readWrite(m: Memory, ah: number, handle: number, buf: number, n: number): number {
  return result(m, dos(m, { ax: ah << 8, bx: handle, dx: buf, cx: n }));
}

// 0:fd49 _read(handle, buf, n): bytes read, or -1 with errno.
export function rawRead(m: Memory, handle: number, buf: number, n: number): number {
  return readWrite(m, 0x3f, handle, buf, n);
}

// 0:fd53 _write(handle, buf, n): bytes written, or -1 with errno.
export function rawWrite(m: Memory, handle: number, buf: number, n: number): number {
  return readWrite(m, 0x40, handle, buf, n);
}

// 0:fd5d read(handle, buf, n): console handles go through the console reader.
export function read(m: Memory, handle: number, buf: number, n: number): number {
  if (m.u8(IS_CONSOLE + handle)) return callNear(m, m.u16(CONSOLE_READ), handle, buf, n);
  return rawRead(m, handle, buf, n);
}

// 0:fd64 write(handle, buf, n): console handles go through the console writer.
export function write(m: Memory, handle: number, buf: number, n: number): number {
  if (m.u8(IS_CONSOLE + handle)) return callNear(m, m.u16(CONSOLE_WRITE), handle, buf, n);
  return rawWrite(m, handle, buf, n);
}

// 0:fd93 close(handle): 0, or -1 with errno.
export function close(m: Memory, handle: number): number {
  return status(m, dos(m, { ax: 0x3e00, bx: handle }));
}

// 0:fdab lseek(handle, lo, hi, whence): new position as DX:AX, or -1 with errno.
export function lseek(m: Memory, handle: number, lo: number, hi: number, whence: number): number {
  const r = dos(m, { ax: 0x4200 | (whence & 0xff), bx: handle, dx: lo, cx: hi });
  if (status(m, r)) return 0xffffffff;
  return (r.dx * 0x10000 + r.ax) >>> 0;
}

// 0:fdca unlink(path): 0, or -1 with errno.
export function unlink(m: Memory, path: number): number {
  return status(m, dos(m, { ax: 0x4100, dx: path }));
}

// 0:ff0f isatty(handle): 1 for a character device that is the console input or output.
export function isatty(m: Memory, handle: number): number {
  const r = dos(m, { ax: 0x4400, bx: handle });
  return !(r.flags & CF) && r.dx & 0x80 && r.dx & 3 ? 1 : 0;
}

// 0:fe03 console_read(handle, buf, n): hands out a line read whole into the line buffer (CR LF -> LF).
export function consoleRead(m: Memory, handle: number, buf: number, n: number): number {
  let count = m.u16(CONSOLE_LEFT);
  if (!count) {
    count = rawRead(m, handle, CONSOLE_BUFFER, CONSOLE_BUFFER_SIZE);
    if (count && m.u8(CONSOLE_BUFFER - 1 + count) === 0x0a) {
      count = (count - 1) & 0xffff;
      m.set8(CONSOLE_BUFFER - 1 + count, m.u8(NEWLINE));
    }
    m.set16(CONSOLE_NEXT, CONSOLE_BUFFER);
    m.set16(CONSOLE_LEFT, count);
  }
  if (((count << 16) >> 16) > ((n << 16) >> 16)) count = n;
  if (count) movmem(m, m.u16(CONSOLE_NEXT), buf, count);
  m.set16(CONSOLE_NEXT, m.u16(CONSOLE_NEXT) + count);
  m.set16(CONSOLE_LEFT, m.u16(CONSOLE_LEFT) - count);
  return count;
}

// 0:fe68 console_write(handle, buf, n): writes n bytes, each LF followed by a CR; returns n.
export function consoleWrite(m: Memory, handle: number, buf: number, n: number): number {
  let start = buf;
  let p = buf;
  for (let left = n; left; left = (left - 1) & 0xffff) {
    if (m.u8(p) === 0x0a) {
      p = (p + 1) & 0xffff;
      rawWrite(m, handle, start, (p - start) & 0xffff);
      rawWrite(m, handle, CARRIAGE_RETURN, 1);
      start = p;
    } else {
      p = (p + 1) & 0xffff;
    }
  }
  if (p !== start) rawWrite(m, handle, start, (p - start) & 0xffff);
  return n;
}

// 0:fc40 _exit(status): DOS 4Ch (throws DosExit).
export function exitNow(m: Memory, status: number): void {
  dos(m, { ax: 0x4c00 | (status & 0xff) });
}

// 0:fd35 exit(status): runs the exit hook, then _exit.
export function exit(m: Memory, status: number): void {
  callNear(m, m.u16(EXIT_HOOK));
  exitNow(m, status);
}

// 0:fc65 the initial exit hook.
export function noExitHook(): number {
  return 0;
}

// 0:fd47 startup check (clears carry: nothing to report).
export function startupCheck(): void {}

// 0:fc69 start(tail, argc): console flags for handles 0-2, splits the command tail (copied to the heap) at spaces
// and tabs into argv (argv[0] = ""), calls main(argc, argv) (0:1a9c) and exits with 0.
export function start(m: Memory, tail: number, argc: number): void {
  const [n, argv] = startArgs(m, tail, argc);
  call(m, "0:1a9c", n, argv);
  exit(m, 0);
}

// The part of 0:fc69 before main(): returns main's (argc, argv). The browser runs main() as init + frame loop.
export function startArgs(m: Memory, tail: number, argc: number): [number, number] {
  for (let h = 0; h < 3; h++) m.set8(IS_CONSOLE + h, isatty(m, h));
  const argv = sbrk(m, (argc * 2 + 2) & 0xffff);
  m.set16(ARGV, argv);
  m.set16(argv, PROGRAM_NAME);
  m.set16(ARGC, argc);
  let slot = (argv + argc * 2) & 0xffff;
  let p = tail;
  for (;;) {
    while (m.u8(p) === 0x20 || m.u8(p) === 9) p = (p + 1) & 0xffff;
    if (!m.u8(p)) break;
    m.set16(slot, p);
    slot = (slot + 2) & 0xffff;
    m.set16(ARGC, m.u16(ARGC) + 1);
    if (sbrk(m, 2) === 0xffff) {
      write(m, 2, TOO_MANY_ARGS, 0xe);
      exitNow(m, 0xc8);
    }
    for (p = (p + 1) & 0xffff; m.u8(p); p = (p + 1) & 0xffff) {
      const c = m.u8(p);
      if (c === 0x20 || c === 9) {
        m.set8(p, 0);
        p = (p + 1) & 0xffff;
        break;
      }
    }
  }
  m.set16(slot, 0);
  return [m.u16(ARGC), m.u16(ARGV)];
}

register("0:efd5", farmalloc);
register("0:f00b", farfree);
register("0:f04e", int86x);
register("0:f0cf", dosCall);
register("0:fab6", dosPathCall);
register("0:f99c", open);
register("0:fd49", rawRead);
register("0:fd53", rawWrite);
register("0:fd5d", read);
register("0:fd64", write);
register("0:fd93", close);
register("0:fdab", lseek);
register("0:fdca", unlink);
register("0:ff0f", isatty);
register("0:fe03", consoleRead);
register("0:fe68", consoleWrite);
register("0:fc40", exitNow);
register("0:fd35", exit);
register("0:fc65", noExitHook);
register("0:fd47", startupCheck);
register("0:fc69", start);
