// Borland C runtime and small helpers called by the game code: timer slots, string/memory functions, qsort,
// sprintf, the near heap and far pointer helpers. All work on the flat memory image; DOS, BIOS and port I/O
// routines are not here.
import type { Memory } from "./memory.ts";

// Timer slots updated by the timer ISR (0:e345): 7 entries of { flags, counter }.
// Flags: 1 allocated, 2 frozen (counter latched), 4 enabled.
const TIMER_SLOTS = 0x998c;
const TIMER_SLOT_COUNT = 7;
const TIMER_CONTROL = 0x99a8;
const TIMER_HOOK = 0x99ac;
const TIMER_CHAIN = 0x99ae;

// Near heap: every block starts with a header word holding the address of the next block, bit 0 set when in use.
const HEAP_ROVER = 0x2d4e;
const HEAP_FIRST = 0x2d50;
const HEAP_LAST = 0x2b50;
const HEAP_SPLIT_STASH = 0x2d4c;
const BRK = 0x2bd6;
const ERRNO = 0x2bd8;
const HEAP_BASE = 0x2bde;
const BRK_GUARDED = 0x2be0;
const DOS_HEAP_MODE = 0x2c1a;
const STACK_GUARD = 0x2c16;
// brk compares the new break against SP - stack guard. SP inside brk when malloc grows the heap from the
// game's main loop (observed: 0xff76); the port has no real stack, so it uses this value.
const BRK_SP = 0xff76;

// sprintf output pointer (0:ef43 stores one char there and advances it).
const SPRINTF_OUT = 0x2d4a;

// Far segment of the game's big buffer (returned by 14c8:004d).
const FAR_BUFFER_SEG = 0x2efa;

// Joystick axis masks for port 201h: x, y and their sum.
const JOY_X_MASK = 0x2737;
const JOY_Y_MASK = 0x2738;
const JOY_MASK = 0x2739;

function slot(index: number): number {
  return TIMER_SLOTS + (((index << 24) >> 24) << 2);
}

// 0:e46a timer_alloc(): claims the first free timer slot (enabled off, counter 0); returns its index or -1.
export function timerAlloc(m: Memory): number {
  for (let i = 0; i < TIMER_SLOT_COUNT; i++) {
    const s = TIMER_SLOTS + i * 4;
    if (m.u16(s) & 1) continue;
    m.set16(s, (m.u16(s) | 1) & 0xfff9);
    m.set16(s + 2, 0);
    return i;
  }
  return 0xffff;
}

// 0:e4af timer_free(slot)
export function timerFree(m: Memory, index: number): void {
  m.set16(slot(index), 0);
}

// 0:e4c6 timer_set(slot, value): sets the slot counter (with interrupts off).
export function timerSet(m: Memory, index: number, value: number): void {
  m.set16(slot(index) + 2, value);
}

// 0:e4ec timer_enable(slot, on)
export function timerEnable(m: Memory, index: number, on: number): void {
  const s = slot(index);
  m.set16(s, on & 0xff ? m.u16(s) | 4 : m.u16(s) & 0xfffb);
}

// 0:e51b timer_freeze(slot): latches the counter and returns it.
export function timerFreeze(m: Memory, index: number): number {
  const s = slot(index);
  const value = m.u16(s + 2);
  m.set16(s, m.u16(s) | 2);
  return value;
}

// 0:e53f timer_thaw(slot): resumes counting; returns the counter.
export function timerThaw(m: Memory, index: number): number {
  const s = slot(index);
  m.set16(s, m.u16(s) & 0xfffd);
  return m.u16(s + 2);
}

// 0:e55a timer_get(slot)
export function timerGet(m: Memory, index: number): number {
  return m.u16(slot(index) + 2);
}

// 0:e56f timer_exchange(slot, value): sets the counter, returns the previous value.
export function timerExchange(m: Memory, index: number, value: number): number {
  const s = slot(index);
  const old = m.u16(s + 2);
  m.set16(s + 2, value);
  return old;
}

// 0:e5d3 timer_set_chain(handler): near routine the timer ISR calls (default 0:e345).
export function timerSetChain(m: Memory, handler: number): void {
  m.set16(TIMER_CHAIN, handler);
}

// 0:e5e0 timer_set_hook(value)
export function timerSetHook(m: Memory, value: number): void {
  m.set16(TIMER_HOOK, value);
}

// 0:e5ed timer_hook_on()
export function timerHookOn(m: Memory): void {
  m.set16(TIMER_CONTROL, m.u16(TIMER_CONTROL) | 2);
}

// 0:e5f4 timer_hook_off()
export function timerHookOff(m: Memory): void {
  m.set16(TIMER_CONTROL, m.u16(TIMER_CONTROL) & 0xfffd);
}

// 0:efb0 swap_bytes(a, b, count)
export function swapBytes(m: Memory, a: number, b: number, count: number): void {
  if (a === b) return;
  for (let i = 0; i < count; i++) {
    const t = m.u8(b + i);
    m.set8(b + i, m.u8(a + i));
    m.set8(a + i, t);
  }
}

// 0:e947 qsort(base, count, size, compare): Borland's quicksort (middle pivot, explicit stack, smaller side
// first). The order of equal keys follows this exact algorithm.
export function qsort(m: Memory, base: number, count: number, size: number, compare: (m: Memory, a: number, b: number) => number): void {
  const less = (a: number, b: number) => ((compare(m, a, b) << 16) >> 16) < 0;
  const stack: [number, number][] = [];
  let lo = base;
  let hi = (base + (count - 1) * size) & 0xffff;
  for (;;) {
    let mid = (lo + ((Math.floor(((hi - lo) & 0xffff) / size) >> 1) * size)) & 0xffff;
    let i = lo;
    let j = hi;
    do {
      while (less(i, mid)) i = (i + size) & 0xffff;
      while (less(mid, j)) j = (j - size) & 0xffff;
      if (i < j) {
        swapBytes(m, i, j, size);
        if (i === mid) mid = j;
        else if (j === mid) mid = i;
      }
      if (i <= j) {
        i = (i + size) & 0xffff;
        j = (j - size) & 0xffff;
      }
    } while (i <= j);
    if ((((j - lo) << 16) >> 16) < (((hi - i) << 16) >> 16)) {
      if (i < hi) stack.push([i, hi]);
      hi = j;
    } else {
      if (j > lo) stack.push([lo, j]);
      lo = i;
    }
    if (lo < hi) continue;
    const next = stack.pop();
    if (!next) return;
    [lo, hi] = next;
  }
}

// 0:f6b3 vprinter(putc, fmt, args): Borland's printf engine. Supports flags - + space # 0, width and precision
// (digits or *), size prefixes l h F N, conversions d i u o x X c s n p %; floats are not linked in.
// Returns the number of characters written.
export function vprinter(m: Memory, putc: (m: Memory, c: number) => void, fmt: number, args: number[]): number {
  let argi = 0;
  const arg = () => args[argi++] ?? 0;
  let written = 0;
  let upper = false;
  const out = (c: number) => {
    written++;
    if (upper && c >= 0x61 && c <= 0x7a) c -= 0x20;
    putc(m, c & 0xff);
  };
  let p = fmt;
  const next = () => m.u8(p++);
  // 0:f953: width/precision field.
  const field = (c: number): [number, number] => {
    if (c === 0x2a) return [(arg() << 16) >> 16, next()];
    let v = 0;
    while (c >= 0x30 && c <= 0x39) {
      v = (v * 10 + c - 0x30) & 0xffff;
      c = next();
    }
    return [(v << 16) >> 16, c];
  };
  for (;;) {
    upper = false;
    let c = next();
    if (c !== 0x25) {
      if (!c) return written;
      out(c);
      continue;
    }
    let pad = 0x20;
    let sign = 0;
    let prefix = 0;
    let left = false;
    let alt = false;
    let long = false;
    let far = false;
    for (;;) {
      c = next();
      if (c === 0x2d) left = true;
      else if (c === 0x2b) sign = 0x2b;
      else if (c === 0x20) sign ||= 0x20;
      else if (c === 0x23) alt = true;
      else break;
    }
    if (c === 0x30) {
      pad = 0x30;
      c = next();
    }
    let width: number;
    [width, c] = field(c);
    if (width < 0) {
      width = -width;
      left = true;
    }
    let precision = -1;
    if (c === 0x2e) {
      [precision, c] = field(next());
    }
    while (c === 0x4c || c === 0x6c || c === 0x68 || c === 0x46 || c === 0x4e) {
      if (c === 0x6c) long = true;
      else if (c === 0x46) far = true;
      c = next();
    }
    // Characters to print come from textSeg:text or `digits`.
    let digits: number[] | null = null;
    let textSeg = m.ds;
    let text = 0;
    let count: number;
    if (c === 0x64 || c === 0x69 || c === 0x75 || c === 0x6f || c === 0x78 || c === 0x58) {
      const radix = c === 0x6f ? 8 : c === 0x78 || c === 0x58 ? 16 : 10;
      const signed = c === 0x64 || c === 0x69;
      if (c === 0x58) upper = true;
      let value = arg();
      if (long) value = (value | (arg() << 16)) >>> 0;
      else if (signed) value = ((value << 16) >> 16) >>> 0;
      if (signed) {
        prefix = sign;
        if (value & 0x80000000) {
          prefix = 0x2d;
          value = (0x100000000 - value) >>> 0;
        }
      }
      if (precision < 0) precision = 1;
      digits = [];
      while (value) {
        digits.unshift("0123456789abcdef".charCodeAt(value % radix));
        value = Math.floor(value / radix);
      }
      if (alt && radix === 8) digits.unshift(0x30);
      else if (alt && radix === 16) prefix = 0x78;
      count = digits.length;
      precision -= count;
      if (precision > 0) width -= precision;
    } else if (c === 0x73) {
      text = arg();
      if (far) textSeg = arg();
      count = 0;
      while (m.farU8(textSeg, text + count)) count++;
      if (count > (precision & 0xffff)) count = precision & 0xffff;
      precision = 0;
    } else if (c === 0x63) {
      digits = [arg() & 0xff];
      count = 1;
      precision = 0;
    } else if (c === 0x6e) {
      const at = arg();
      if (far) arg();
      m.set16(at, written);
      if (long) m.set16(at + 2, 0);
      continue;
    } else if (c === 0x70) {
      continue;
    } else if (c === 0x65 || c === 0x45 || c === 0x66 || c === 0x67 || c === 0x47) {
      throw new Error("vprinter: floating point formats are not supported");
    } else {
      // Unknown conversion or %%: printed literally; a lone % at the end stops.
      if (!c) return written;
      out(c);
      continue;
    }
    if (prefix) width -= prefix === 0x78 ? 2 : 1;
    width -= count;
    const emitPrefix = () => {
      if (!prefix) return;
      if (prefix === 0x78) out(0x30);
      out(prefix);
      prefix = 0;
    };
    if (width > 0 && !left) {
      if (pad === 0x30) emitPrefix();
      for (; width > 0; width--) out(pad);
    }
    emitPrefix();
    for (; precision > 0; precision--) out(0x30);
    for (let k = 0; k < count; k++) out(digits ? digits[k] : m.farU8(textSeg, text + k));
    for (; width > 0; width--) out(0x20);
  }
}

// 0:ef18 sprintf(buf, fmt, ...): returns the length written (terminator not counted).
export function sprintf(m: Memory, buf: number, fmt: number, ...args: number[]): number {
  m.set16(SPRINTF_OUT, buf);
  // 0:ef43 sprintf's putc.
  const putc = (mm: Memory, c: number) => {
    const at = mm.u16(SPRINTF_OUT);
    mm.set16(SPRINTF_OUT, at + 1);
    mm.set8(at, c);
  };
  const n = vprinter(m, putc, fmt, args);
  m.set8(m.u16(SPRINTF_OUT), 0);
  return n;
}

// 0:ef88 strncpy(dst, src, n): returns dst.
export function strncpy(m: Memory, dst: number, src: number, n: number): number {
  let i = 0;
  for (; i < n; i++) {
    const c = m.u8(src + i);
    if (!c) break;
    m.set8(dst + i, c);
  }
  for (; i < n; i++) m.set8(dst + i, 0);
  return dst;
}

// 0:f104 memcpy(dst, src, n): copies words forward, then the odd byte; returns dst.
export function memcpy(m: Memory, dst: number, src: number, n: number): number {
  let i = 0;
  for (; i + 1 < n; i += 2) m.set16(dst + i, m.u16(src + i));
  if (n & 1) m.set8(dst + i, m.u8(src + i));
  return dst;
}

// 0:f12c memset(dst, value, n): returns dst.
export function memset(m: Memory, dst: number, value: number, n: number): number {
  for (let i = 0; i < n; i++) m.set8(dst + i, value);
  return dst;
}

// 0:f154 far_to_linear(off, seg): 20-bit linear address as DX:AX.
export function farToLinear(_m: Memory, off: number, seg: number): number {
  return seg * 16 + off;
}

// 0:f173 linear_to_far(lo, hi): normalised far pointer (offset 0..15) as DX:AX = seg:off.
export function linearToFar(_m: Memory, lo: number, hi: number): number {
  const seg = (((hi & 0xf) << 12) | ((lo >> 4) & 0xfff)) & 0xffff;
  return ((seg << 16) | (lo & 0xf)) >>> 0;
}

// 0:f194 strchr(s, c): pointer to the first c (the terminator matches c = 0), or 0.
export function strchr(m: Memory, s: number, c: number): number {
  for (let p = s; ; p = (p + 1) & 0xffff) {
    const v = m.u8(p);
    if (v === (c & 0xff)) return p;
    if (!v) return 0;
  }
}

function compareBytes(m: Memory, a: number, b: number, n: number): number {
  for (let i = 0; i < n; i++) {
    const x = m.u8(a + i);
    const y = m.u8(b + i);
    if (x !== y) return x < y ? 0xffff : 1;
    if (!x) return 0;
  }
  return 0;
}

// 0:fa32 strcmp(a, b): -1, 0 or 1.
export function strcmp(m: Memory, a: number, b: number): number {
  return compareBytes(m, a, b, Infinity);
}

// 0:fa50 strncmp(a, b, n): -1, 0 or 1.
export function strncmp(m: Memory, a: number, b: number, n: number): number {
  return compareBytes(m, a, b, n);
}

// 0:fa99 strlen(s)
export function strlen(m: Memory, s: number): number {
  let n = 0;
  while (m.u8(s + n)) n++;
  return n;
}

// 0:feca movmem(src, dst, n): overlap-safe copy.
export function movmem(m: Memory, src: number, dst: number, n: number): void {
  if (dst === src) return;
  if (dst > src) for (let i = n - 1; i >= 0; i--) m.set8(dst + i, m.u8(src + i));
  else for (let i = 0; i < n; i++) m.set8(dst + i, m.u8(src + i));
}

// 0:ff63 brk(addr): moves the heap break; 0 on success, -1 (errno ENOMEM) when it would hit the stack.
export function brk(m: Memory, addr: number): number {
  const top = (addr + 1) & 0xfffe;
  if (top >= m.u16(HEAP_BASE)) {
    if (m.u16(DOS_HEAP_MODE)) throw new Error("brk: DOS memory resize path is not ported");
    if (top < ((BRK_SP - m.u16(STACK_GUARD)) & 0xffff)) {
      m.set16(BRK, top);
      m.set16(BRK_GUARDED, top + m.u16(STACK_GUARD));
      return 0;
    }
  }
  m.set16(ERRNO, 0xfff8);
  return 0xffff;
}

// 0:ff2f sbrk(increment): returns the previous break, or -1.
export function sbrk(m: Memory, increment: number): number {
  const old = m.u16(BRK);
  let target = increment;
  let result = old;
  if (increment & 0x8000) {
    result = (old - increment) & 0xffff;
    if (old < increment) return sbrkFail(m);
  } else {
    target = old + increment;
    if (target > 0xffff) return sbrkFail(m);
  }
  return brk(m, target) ? 0xffff : result;
}

function sbrkFail(m: Memory): number {
  m.set16(ERRNO, 0xfff8);
  return 0xffff;
}

// 0:f536 malloc(size): first fit from the rover, merging free neighbours on the way; the heap grows by 1 KB
// through sbrk after a full lap. Returns the block (after its header) or 0.
export function malloc(m: Memory, size: number): number {
  size = (((size + 3) & 0xffff) >> 1) << 1;
  if (!m.u16(HEAP_ROVER)) {
    m.set16(HEAP_FIRST, HEAP_FIRST | 1);
    m.set16(HEAP_ROVER, HEAP_FIRST);
  }
  let laps = 0;
  let si = m.u16(HEAP_ROVER);
  let last = si;
  for (;;) {
    if (si === m.u16(HEAP_LAST) && ++laps > 1) {
      let grow = 0x400;
      let di = sbrk(m, grow);
      if (di === 0xffff) return 0;
      if (di !== ((si + 2) & 0xffff)) {
        m.set16(si, di | 1);
        grow -= 2;
        si = di;
      }
      di = (si + grow) & 0xffff;
      m.set16(si, di);
      m.set16(di, HEAP_FIRST | 1);
      m.set16(HEAP_LAST, di);
      if ((m.u16(last) & 0xfffe) === si) si = last;
    }
    if (!(m.u16(si) & 1)) {
      last = si;
      let di = m.u16(si) & 0xfffe;
      while (!(m.u16(di) & 1)) {
        m.set16(si, m.u16(di));
        di = m.u16(si) & 0xfffe;
      }
      const avail = (di - si) & 0xffff;
      if (avail >= size) {
        if (avail > size) {
          const split = (si + size) & 0xffff;
          m.set16(si, split);
          m.set16(HEAP_SPLIT_STASH, m.u16(split));
          m.set16(split, di);
        }
        m.set16(HEAP_ROVER, m.u16(si));
        m.set16(si, m.u16(si) | 1);
        return (si + 2) & 0xffff;
      }
    }
    si = m.u16(si) & 0xfffe;
  }
}

// 0:f634 free(block): marks the block free and makes it the rover; -1 if it was not in use.
export function free(m: Memory, block: number): number {
  const header = (block - 2) & 0xffff;
  if (!(m.u16(header) & 1)) return 0xffff;
  m.set16(header, m.u16(header) & 0xfffe);
  m.set16(HEAP_ROVER, header);
  return 0;
}

// 1485:02c8 reset_61a8(): clears the byte at DS:61a8 and the four dword pairs at DS:61b0.
export function reset61a8(m: Memory): void {
  m.set8(0x61a8, 0);
  for (let i = 0; i < 4; i++) {
    m.set16(0x61b2 + i * 4, 0);
    m.set16(0x61b0 + i * 4, 0);
  }
}

// 1485:03bb extract_dying(list, count): moves objects of type 2 with flags at +0x86 and +0x8a set from the
// list into DS:30ca (count in DS:3322), clearing +0x88/+0x8a; compacts the rest and returns their count.
export function extractDying(m: Memory, list: number, count: number): number {
  m.set16(0x3322, 0);
  let kept = 0;
  for (let i = 0; ((i << 16) >> 16) < ((count << 16) >> 16); i++) {
    const obj = m.u16(list + i * 2);
    if (m.u8(obj + 2) === 2 && m.u8(obj + 0x86) && m.u8(obj + 0x8a)) {
      const n = m.u16(0x3322);
      m.set16(0x3322, n + 1);
      m.set16(0x30ca + n * 2, obj);
      m.set8(obj + 0x88, 0);
      m.set8(obj + 0x8a, 0);
    } else {
      m.set16(list + kept * 2, obj);
      kept++;
    }
  }
  return kept;
}

// 14c8:004d far_buffer(off): far pointer DS:2efa:off as DX:AX.
export function farBuffer(m: Memory, off: number): number {
  return ((m.u16(FAR_BUFFER_SEG) << 16) | off) >>> 0;
}

// 14c8:0059 FP_SEG(off, seg)
export function fpSeg(_m: Memory, _off: number, seg: number): number {
  return seg;
}

// 14c8:0061 FP_OFF(off, seg)
export function fpOff(_m: Memory, off: number): number {
  return off;
}

// 14c8:0069 far_memset(seg, off, count, value): the offset wraps inside the segment.
export function farMemsetSegFirst(m: Memory, seg: number, off: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) m.bytes[seg * 16 + ((off + i) & 0xffff)] = value & 0xff;
}

// 14c8:0084 far_memcpy(src_seg, src_off, dst_seg, dst_off, count): forward byte copy.
export function farMemcpy(m: Memory, srcSeg: number, srcOff: number, dstSeg: number, dstOff: number, count: number): void {
  for (let i = 0; i < count; i++) m.bytes[dstSeg * 16 + ((dstOff + i) & 0xffff)] = m.bytes[srcSeg * 16 + ((srcOff + i) & 0xffff)];
}

// 14c8:0339 far_memset(off, seg, value, count)
export function farMemset(m: Memory, off: number, seg: number, value: number, count: number): void {
  farMemsetSegFirst(m, seg, off, count, value);
}

// 14c8:02df joy_rotate_axes(): cycles the joystick axis bit assignment (x,y) 1,2 -> 4,8 -> 8,4 -> 1,2... .
export function joyRotateAxes(m: Memory): void {
  const x = m.u8(JOY_X_MASK);
  const [nx, ny] = x === 1 ? [4, 8] : x === 2 ? [8, 4] : x === 4 ? [1, 2] : [2, 1];
  m.set8(JOY_X_MASK, nx);
  m.set8(JOY_Y_MASK, ny);
  m.set8(JOY_MASK, nx + ny);
}

// 14c8:032a joy_swap_axes()
export function joySwapAxes(m: Memory): void {
  const x = m.u8(JOY_X_MASK);
  m.set8(JOY_X_MASK, m.u8(JOY_Y_MASK));
  m.set8(JOY_Y_MASK, x);
}
