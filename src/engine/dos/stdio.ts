// The game's small stdio: 20 FILE records of 13 bytes at DS:2a4c (stdin, stdout, stderr first), printf, fread,
// fwrite and the scanf family.
// FILE: +0 next byte, +2 end of the buffered data (reading) or of the buffer (writing), +4 buffer, +6 flags
// (1 open, 2 buffer from malloc, 4 holds unwritten output, 8 end of file, 10h error, 20h temporary: unlink the
// name at +0bh on close), +7 handle, +8 one-byte buffer for console handles, +9 buffer size.
import { callNear, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { free, malloc, strchr, strcmp, vprinter } from "../runtime.ts";
import { EXIT_HOOK, close, isatty, open, read, unlink, write } from "./files.ts";

const FILES = 0x2a4c;
const FILES_END = 0x2b50;
const FILE_SIZE = 0xd;
const STDIN = 0x2a4c;
const STDOUT = 0x2a59;
const ERRNO = 0x2bd8;
// fopen modes: 5-byte records { mode string, open flags at +3 }, ended by an empty string.
const MODES = 0x2a1e;
// Mask applied to text read from stdin by scanf.
const STDIN_MASK = 0x29ee;
// Borland ctype table (index -1 = EOF): 4 digit, 10h white space.
const CTYPE = 0x2b55;
const DIGIT = 0x04;
const SPACE = 0x10;
// scanf state: getc callback (op 0 get, 1 unget), field width, last stdin character, sscanf source and its end flag.
const SCAN_GETC = 0x2d46;
const SCAN_WIDTH = 0x2d48;
const SCAN_STDIN_LAST = 0x2d40;
const SCAN_SOURCE = 0x2d43;
const SCAN_SOURCE_END = 0x2d42;
// Digit strings for scanNumber by conversion: 0 hex, 0ch decimal, 0eh octal; values at the same index in DIGIT_VALUES.
const DIGITS = 0x29f0;
const DIGIT_VALUES = 0x2a07;

const s16 = (v: number) => (v << 16) >> 16;

function ctype(m: Memory, c: number): number {
  return m.u8(CTYPE + c);
}

// 0:f460 free_stream(): the first FILE not in use, or 0.
export function freeStream(m: Memory): number {
  for (let fp = FILES; fp < FILES_END; fp += FILE_SIZE) if (!m.u8(fp + 6)) return fp;
  return 0;
}

// 0:f1b3 fopen(name, mode)
export function fopen(m: Memory, name: number, mode: number): number {
  const fp = freeStream(m);
  return fp ? freopen(m, name, mode, fp) : 0;
}

// 0:f1d7 freopen(name, mode, fp): fp, or 0 (errno 1 for an unknown mode).
export function freopen(m: Memory, name: number, mode: number, fp: number): number {
  fclose(m, fp);
  let entry = MODES;
  for (; ; entry += 5) {
    if (!m.u8(entry)) {
      m.set16(ERRNO, 1);
      return 0;
    }
    if (!strcmp(m, entry, mode)) break;
  }
  const handle = open(m, name, m.u16(entry + 3));
  if (handle === 0xffff) return 0;
  m.set8(fp + 7, handle);
  m.set8(fp + 6, 1);
  return fp;
}

// 0:f326 fclose(fp): flushes, closes the handle, frees the buffer; 0, or -1 when something failed.
export function fclose(m: Memory, fp: number): number {
  if (!fp) return 0xffff;
  let failed = 0;
  const flags = m.u8(fp + 6);
  if (flags) {
    if (flags & 4) failed = flushBuffer(m, fp, 0xffff);
    failed |= close(m, m.s8(fp + 7) & 0xffff);
    if (m.u8(fp + 6) & 2) free(m, m.u16(fp + 4));
    if (m.u8(fp + 6) & 0x20) {
      unlink(m, m.u16(fp + 0xb));
      free(m, m.u16(fp + 0xb));
    }
  }
  m.set16(fp, 0);
  m.set16(fp + 2, 0);
  m.set16(fp + 4, 0);
  m.set8(fp + 6, 0);
  return failed;
}

// 0:f310 fcloseall(): the exit hook once output was buffered.
export function fcloseall(m: Memory): void {
  for (let fp = FILES; fp < FILES_END; fp += FILE_SIZE) fclose(m, fp);
}

// 0:f47e alloc_buffer(fp): 1 KB from malloc, or the record's own byte for console handles (or when out of memory).
export function allocBuffer(m: Memory, fp: number): void {
  const buffer = isatty(m, m.s8(fp + 7) & 0xffff) ? 0 : malloc(m, 0x400);
  if (!buffer) {
    m.set16(fp + 9, 1);
    m.set16(fp + 4, fp + 8);
    return;
  }
  m.set16(fp + 9, 0x400);
  m.set8(fp + 6, m.u8(fp + 6) | 2);
  m.set16(fp + 4, buffer);
}

function writeError(m: Memory, fp: number): number {
  m.set8(fp + 6, m.u8(fp + 6) | 0x10);
  m.set16(fp, 0);
  m.set16(fp + 2, 0);
  return 0xffff;
}

// 0:f3a1 flush_buffer(fp, c): writes the buffered output, then starts a new buffer with c (c = -1: only
// flush). Returns c, 0 after a plain flush, -1 on error.
export function flushBuffer(m: Memory, fp: number, c: number): number {
  m.set16(EXIT_HOOK, 0xf310);
  const handle = m.s8(fp + 7) & 0xffff;
  if (m.u8(fp + 6) & 0x10) return 0xffff;
  if (m.u8(fp + 6) & 4) {
    const n = (m.u16(fp) - m.u16(fp + 4)) & 0xffff;
    if (write(m, handle, m.u16(fp + 4), n) !== n) return writeError(m, fp);
  }
  if (c === 0xffff) {
    m.set8(fp + 6, m.u8(fp + 6) & 0xfb);
    m.set16(fp, 0);
    m.set16(fp + 2, 0);
    return 0;
  }
  if (!m.u16(fp + 4)) allocBuffer(m, fp);
  if (m.u16(fp + 9) === 1) {
    const at = m.push(2);
    m.set16(at, c);
    const n = write(m, handle, at, 1);
    m.pop(2);
    return n === 1 ? c : writeError(m, fp);
  }
  const buffer = m.u16(fp + 4);
  m.set16(fp, buffer + 1);
  m.set16(fp + 2, buffer + m.u16(fp + 9));
  m.set8(fp + 6, m.u8(fp + 6) | 4);
  m.set8(buffer, c);
  return c & 0xff;
}

// 0:f2dc fputc(c, fp)
export function fputc(m: Memory, c: number, fp: number): number {
  const at = m.u16(fp);
  if (at >= m.u16(fp + 2)) return flushBuffer(m, fp, c & 0xff);
  m.set16(fp, at + 1);
  m.set8(at, c);
  return c & 0xff;
}

// 0:f2a9 fputc_text(c, fp): LF goes out as CR LF.
export function fputcText(m: Memory, c: number, fp: number): number {
  if (c === 0x0a && fputc(m, 0x0d, fp) === 0xffff) return 0xffff;
  return fputc(m, c, fp);
}

// 0:f295 printf's putc: to stdout.
export function putStdout(m: Memory, c: number): void {
  fputcText(m, c, STDOUT);
}

// 0:f27d printf(fmt, ...): characters written.
export function printf(m: Memory, fmt: number, ...args: number[]): number {
  return vprinter(m, putStdout, fmt, args);
}

// 0:f23b fwrite(buf, size, count, fp): count, or 0 on a write error.
export function fwrite(m: Memory, buf: number, size: number, count: number, fp: number): number {
  const total = Math.imul(size, count) & 0xffff;
  for (let i = 0; i < total; i++) if (fputc(m, m.u8(buf + i), fp) === 0xffff) return 0;
  return count;
}

// 0:e8a1 fgetc(fp): next byte, or -1 at end of file / on error (flags 8 / 10h).
export function fgetc(m: Memory, fp: number): number {
  if (m.u16(fp) >= m.u16(fp + 2)) {
    if (m.u8(fp + 6) & 0x18) return 0xffff;
    m.set8(fp + 6, m.u8(fp + 6) & 0xfb);
    if (!m.u16(fp + 4)) allocBuffer(m, fp);
    const n = read(m, m.s8(fp + 7) & 0xffff, m.u16(fp + 4), m.u16(fp + 9));
    if (n === 0 || n & 0x8000) {
      m.set8(fp + 6, m.u8(fp + 6) | (n ? 0x10 : 8));
      return 0xffff;
    }
    m.set16(fp, m.u16(fp + 4));
    m.set16(fp + 2, m.u16(fp + 4) + n);
  }
  const at = m.u16(fp);
  m.set16(fp, at + 1);
  return m.u8(at);
}

// 0:e7b1 fread(buf, size, count, fp): complete items read.
export function fread(m: Memory, buf: number, size: number, count: number, fp: number): number {
  let item = 0;
  for (; item < s16(count); item++) {
    for (let k = size; k; k = (k - 1) & 0xffff) {
      const c = fgetc(m, fp);
      if (c === 0xffff) return item;
      m.set8(buf, c);
      buf = (buf + 1) & 0xffff;
    }
  }
  return item;
}

// 0:e85f fgetc_text(fp): skips NUL and CR, ^Z is the end of file.
export function fgetcText(m: Memory, fp: number): number {
  for (;;) {
    const c = fgetc(m, fp);
    if (c === 0xffff) return c;
    const masked = c & m.u16(STDIN_MASK);
    if (masked === 0 || masked === 0x0d) continue;
    if (masked !== 0x1a) return masked;
    m.set8(fp + 6, m.u8(fp + 6) | 8);
    return 0xffff;
  }
}

// 0:e91d ungetc(c, fp): c, or -1 when it does not fit.
export function ungetc(m: Memory, c: number, fp: number): number {
  if (c === 0xffff || m.u16(fp) <= m.u16(fp + 4)) return 0xffff;
  const at = (m.u16(fp) - 1) & 0xffff;
  m.set16(fp, at);
  m.set8(at, c);
  return c;
}

// 0:e820 scanf's getc on stdin (op 0 get, otherwise unget the last character).
export function scanStdin(m: Memory, op: number): number {
  if (op) m.set16(SCAN_STDIN_LAST, ungetc(m, m.u16(SCAN_STDIN_LAST), STDIN));
  else m.set16(SCAN_STDIN_LAST, m.u8(STDIN + 6) & 8 ? 0xffff : fgetcText(m, STDIN));
  return m.u16(SCAN_STDIN_LAST);
}

// 0:ea7b sscanf's getc on the source string.
export function scanString(m: Memory, op: number): number {
  const at = m.u16(SCAN_SOURCE);
  if (!op) {
    if (m.u8(at)) {
      m.set16(SCAN_SOURCE, at + 1);
      return m.u8(at);
    }
    m.set8(SCAN_SOURCE_END, 1);
    return 0xffff;
  }
  if (m.u8(SCAN_SOURCE_END)) return 0xffff;
  m.set16(SCAN_SOURCE, at - 1);
  return m.u8(at - 1);
}

function scanGetc(m: Memory, op: number): number {
  return callNear(m, m.u16(SCAN_GETC), op) & 0xffff;
}

// 0:edd7 skip_space(): skips white space; -1 at the end of the input, else 0.
export function skipSpace(m: Memory): number {
  while (ctype(m, scanGetc(m, 0)) & SPACE);
  return scanGetc(m, 1) === 0xffff ? 0xffff : 0;
}

// 0:ee05 scan_number(digits, values, base, out): reads a signed number of at most the field width (DS:2d48)
// characters into the long at out (0x / 0X allowed in base 16); returns the characters taken.
export function scanNumber(m: Memory, digits: number, values: number, base: number, out: number): number {
  const width = s16(m.u16(SCAN_WIDTH));
  if (width <= 0) return 0;
  let negative = false;
  let taken = 0;
  let value = 0;
  const first = scanGetc(m, 0);
  if (first === 0x2d) {
    negative = true;
    taken++;
  } else if (first === 0x2b) {
    taken++;
  } else {
    scanGetc(m, 1);
  }
  for (; taken < s16(m.u16(SCAN_WIDTH)); taken++) {
    const c = scanGetc(m, 0);
    const p = strchr(m, digits, c);
    if (!p) {
      if (base === 0x10 && value === 0 && (c === 0x78 || c === 0x58)) continue;
      scanGetc(m, 1);
      break;
    }
    value = (Math.imul(value, s16(base)) + m.s8(values + p - digits)) | 0;
  }
  if (negative) value = -value | 0;
  m.set16(out, value);
  m.set16(out + 2, value >>> 16);
  return taken & 0xffff;
}

// 0:eabe scanner(getc, fmt, args): Borland-style scanf engine. Conversions %d %u %o %x %D %O %X (h / l size),
// %s, %c, %[set] / %[^set], %%, '*' suppression and a width; white space in the format skips white space.
// args points to the list of destination pointers. Returns the number of fields stored, -1 at end of input
// when none was.
export function scanner(m: Memory, getc: number, fmt: number, args: number): number {
  const frame = m.push(0x94);
  const value = frame + 0x90;
  const set = frame + 1;
  let stored = 0;
  m.set16(SCAN_GETC, getc);
  done: for (;;) {
    const ch = m.s8(fmt) & 0xffff;
    fmt = (fmt + 1) & 0xffff;
    if (!ch) break;
    if (ch !== 0x25) {
      if (ctype(m, ch) & SPACE) {
        if (skipSpace(m)) break;
        continue;
      }
    } else {
      let suppress = false;
      let long = false;
      let widthSet = false;
      m.set16(SCAN_WIDTH, 0x7f);
      if (m.u8(fmt) === 0x2a) {
        fmt = (fmt + 1) & 0xffff;
        suppress = true;
      }
      if (ctype(m, m.s8(fmt) & 0xffff) & DIGIT) {
        let width = 0;
        do {
          width = (width * 10 + m.s8(fmt) - 0x30) & 0xffff;
          fmt = (fmt + 1) & 0xffff;
        } while (ctype(m, m.s8(fmt) & 0xffff) & DIGIT);
        m.set16(SCAN_WIDTH, width);
        widthSet = true;
      }
      let conv: number;
      let type = 0;
      let base = 0;
      for (;;) {
        conv = m.s8(fmt) & 0xffff;
        fmt = (fmt + 1) & 0xffff;
        if (conv === 0x68) long = false;
        else if (conv === 0x6c) long = true;
        else break;
      }
      // String conversions: characters in (or, with negate, not in) the set are stored.
      let negate = false;
      switch (conv) {
        case 0x25:
          // %% matches a literal %.
          break;
        case 0x44:
        case 0x4f:
        case 0x58:
        case 0x64:
        case 0x75:
        case 0x6f:
        case 0x78: {
          if (conv === 0x44 || conv === 0x4f || conv === 0x58) long = true;
          if (conv === 0x4f || conv === 0x6f) [type, base] = [0xe, 8];
          else if (conv === 0x58 || conv === 0x78) [type, base] = [0, 0x10];
          else [type, base] = [0xc, 10];
          if (skipSpace(m)) break done;
          if (!scanNumber(m, DIGITS + type, DIGIT_VALUES + type, base, value)) break done;
          if (!suppress) {
            const dest = m.u16(args);
            args = (args + 2) & 0xffff;
            m.set16(dest, m.u16(value));
            if (long) m.set16(dest + 2, m.u16(value + 2));
            stored++;
          }
          continue;
        }
        case 0x5b:
        case 0x73:
        case 0x63: {
          if (conv === 0x5b) {
            if (m.u8(fmt) === 0x5e || m.u8(fmt) === 0x7e) {
              fmt = (fmt + 1) & 0xffff;
              negate = true;
            }
            let n = 0;
            for (;;) {
              conv = m.s8(fmt) & 0xffff;
              fmt = (fmt + 1) & 0xffff;
              if (conv === 0x5d) break;
              m.set8(set + n++, conv);
            }
            m.set8(set + n, 0);
          } else if (conv === 0x73) {
            negate = true;
            m.set8(set, 0x20);
            m.set8(set + 1, 9);
            m.set8(set + 2, 0x0a);
            m.set8(set + 3, 0);
          } else {
            if (!widthSet) m.set16(SCAN_WIDTH, 1);
            m.set8(set, 0);
            negate = true;
          }
          if (conv !== 0x63 && skipSpace(m)) break done;
          let dest = 0;
          if (!suppress) {
            dest = m.u16(args);
            args = (args + 2) & 0xffff;
          }
          let matched = false;
          for (;;) {
            const left = m.u16(SCAN_WIDTH);
            m.set16(SCAN_WIDTH, left - 1);
            if (!left) break;
            const c = scanGetc(m, 0);
            if (c === 0xffff) break;
            const inSet = strchr(m, set, c) !== 0;
            if (negate ? inSet : !inSet) {
              scanGetc(m, 1);
              break;
            }
            if (!suppress) {
              m.set8(dest, c);
              dest = (dest + 1) & 0xffff;
            }
            matched = true;
          }
          if (!matched) break done;
          if (!suppress) {
            if (conv !== 0x63) m.set8(dest, 0);
            stored++;
          }
          continue;
        }
        default:
          continue;
      }
    }
    if (scanGetc(m, 0) !== ch) {
      scanGetc(m, 1);
      break;
    }
  }
  m.pop(0x94);
  if (stored) return stored;
  if (scanGetc(m, 0) === 0xffff) return 0xffff;
  scanGetc(m, 1);
  return 0;
}

// 0:e802 scanf(fmt, ...pointers)
export function scanf(m: Memory, fmt: number, ...pointers: number[]): number {
  m.set16(SCAN_STDIN_LAST, 0);
  return scanWithArgs(m, 0xe820, fmt, pointers);
}

// 0:ea58 sscanf(source, fmt, ...pointers)
export function sscanf(m: Memory, source: number, fmt: number, ...pointers: number[]): number {
  m.set16(SCAN_SOURCE, source);
  m.set8(SCAN_SOURCE_END, 0);
  return scanWithArgs(m, 0xea7b, fmt, pointers);
}

function scanWithArgs(m: Memory, getc: number, fmt: number, pointers: number[]): number {
  const args = m.push(pointers.length * 2);
  pointers.forEach((p, i) => m.set16(args + i * 2, p));
  const n = scanner(m, getc, fmt, args);
  m.pop(pointers.length * 2);
  return n;
}

register("0:f460", freeStream);
register("0:f1b3", fopen);
register("0:f1d7", freopen);
register("0:f326", fclose);
register("0:f310", fcloseall);
register("0:f47e", allocBuffer);
register("0:f3a1", flushBuffer);
register("0:f2dc", fputc);
register("0:f2a9", fputcText);
register("0:f295", putStdout);
register("0:f27d", printf);
register("0:f23b", fwrite);
register("0:e8a1", fgetc);
register("0:e7b1", fread);
register("0:e85f", fgetcText);
register("0:e91d", ungetc);
register("0:e820", scanStdin);
register("0:ea7b", scanString);
register("0:edd7", skipSpace);
register("0:ee05", scanNumber);
register("0:eabe", scanner);
register("0:e802", scanf);
register("0:ea58", sscanf);
