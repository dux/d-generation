// PC hardware as the game drives it: port I/O, interrupt vectors, the PIT timer and its interrupt handler, the
// keyboard handler, the BIOS keyboard and video services, the joystick on port 201h, adapter detection.
import { callNear, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { timerFree } from "../runtime.ts";
import { ZF, chain, codeSegment, inPort, int10, int16, int21, outPort, regs } from "./machine.ts";

// Timer slots counted by the timer tick (owned by runtime.ts): 7 x { flags, counter }.
const TIMER_SLOTS = 0x998c;
const TIMER_SLOT_COUNT = 7;
const TIMER_CONTROL = 0x99a8;
const TIMER_HOOK_COUNT = 0x99aa;
const TIMER_HOOK = 0x99ac;
const TIMER_CHAIN = 0x99ae;
// 32-bit count of timer interrupts.
const TIMER_TICKS = 0x27b2;
// Timer interrupts since the BIOS handler last ran (it runs every 4th: 18.2 Hz at divisor 3fffh).
const BIOS_DIVIDER = 0x998a;
const OLD_TIMER_OFF = 0x9986;
const OLD_TIMER_SEG = 0x9988;
const OLD_KEYBOARD_OFF = 0x27b6;
const OLD_KEYBOARD_SEG = 0x27b8;
// The timer handler switches to its own stack at DS:27a2.
const ISR_STACK = 0x27a2;
// Direction keys held (bit per key, see DIRECTION_KEYS) and the same rotated by the view (DS:04ac bit 0: right,
// bit 1: left), which the game reads.
const KEYS_HELD = 0x273b;
const KEY_DIRS = 0x273a;
const VIEW_ROTATION = 0x04ac;
// Scancodes of up, PgUp, right, PgDn, down, End, left, Home (bits 0-7).
const DIRECTION_KEYS = [0x48, 0x49, 0x4d, 0x51, 0x50, 0x4f, 0x4b, 0x47];
// Joystick: present flag, axis bits for x and y on port 201h and both together.
const JOYSTICK = 0x6229;
const JOY_X_MASK = 0x2737;
const JOY_Y_MASK = 0x2738;
const JOY_MASK = 0x2739;
// getch echoes keys when set; attribute word for the echo.
const ECHO = 0x29ea;
const ECHO_ATTR = 0x29ec;
// Display codes by int 10h 1Ah display combination code.
const DISPLAY_CODES = 0x27a4;
// Video mode and BIOS equipment byte from before the game switched to mode 13h.
const OLD_VIDEO_MODE = 0x6e80;
const OLD_EQUIPMENT = 0x6e81;
const BIOS_EQUIPMENT = 0x410;

// Words stored in segment 14c8 (the handlers keep their state in their code segment).
function codeWord(m: Memory, off: number): number {
  const at = codeSegment(m, 0x14c8) * 16 + off;
  return m.bytes[at] | (m.bytes[at + 1] << 8);
}

function setCodeWord(m: Memory, off: number, value: number): void {
  const at = codeSegment(m, 0x14c8) * 16 + off;
  m.bytes[at] = value & 0xff;
  m.bytes[at + 1] = (value >> 8) & 0xff;
}

// 0:ef5b inportb(port)
export function inportb(m: Memory, port: number): number {
  return inPort(m, port) & 0xff;
}

// 0:ef70 outportb(port, value)
export function outportb(m: Memory, port: number, value: number): void {
  outPort(m, port, value & 0xff);
}

// 14c8:034f inportb(port), far.
export function inportbFar(m: Memory, port: number): number {
  return inPort(m, port) & 0xff;
}

// 14c8:01e5 disable(): cli. Handlers only run between ported calls, so there is nothing to mask.
export function disable(): void {}

// 14c8:01e7 enable(): sti.
export function enable(): void {}

// 14c8:002a setvect(n, off, seg)
export function setvect(m: Memory, n: number, off: number, seg: number): void {
  int21(m, regs(m, { ax: 0x2500 | (n & 0xff), dx: off, ds: seg }));
}

// 14c8:003b getvect(n): seg:off as DX:AX.
export function getvect(m: Memory, n: number): number {
  const r = regs(m, { ax: 0x3500 | (n & 0xff) });
  int21(m, r);
  return (r.es * 0x10000 + r.bx) >>> 0;
}

// 14c8:0117 set_old_timer(off, seg): where the timer handler chains to (14c8:010b).
export function setOldTimer(m: Memory, off: number, seg: number): void {
  setCodeWord(m, 0x10b, off);
  setCodeWord(m, 0x10d, seg);
}

// 14c8:01cb set_old_keyboard(off, seg): where the keyboard handler chains to (14c8:01b3).
export function setOldKeyboard(m: Memory, off: number, seg: number): void {
  setCodeWord(m, 0x1b3, off);
  setCodeWord(m, 0x1b5, seg);
}

// 14c8:0131 set_timer_divisor(divisor): PIT channel 0 reload value.
export function setTimerDivisor(m: Memory, divisor: number): void {
  outPort(m, 0x40, divisor & 0xff);
  outPort(m, 0x40, divisor >> 8);
}

// 0:e345 the default timer hook (ret).
export function noTimerHook(): void {}

// 0:e346 timer_tick(), far: counts the interrupt (DS:27b2), steps the enabled timer slots (flag 4 counts down to
// 0, otherwise up) and every DS:99ac ticks calls the near hook DS:99ae while DS:99a8 bit 1 is set. Its frame is
// written because the timer handler runs it on the handler's own stack, outside the stack slack of a call.
export function timerTick(m: Memory): number {
  const ticks = (m.u16(TIMER_TICKS) | (m.u16(TIMER_TICKS + 2) << 16)) + 1;
  m.set16(TIMER_TICKS, ticks);
  m.set16(TIMER_TICKS + 2, ticks >>> 16);
  for (let i = 0; i < TIMER_SLOT_COUNT; i++) {
    const slot = TIMER_SLOTS + i * 4;
    const flags = m.u16(slot);
    if (!(flags & 2)) continue;
    if (!(flags & 4)) m.set16(slot + 2, m.u16(slot + 2) + 1);
    else if (m.u16(slot + 2)) m.set16(slot + 2, m.u16(slot + 2) - 1);
  }
  // Saved BP (left alone: it belongs to the interrupted code) and the loop counter.
  const frame = m.push(4);
  m.set16(frame, TIMER_SLOT_COUNT);
  let ax = TIMER_SLOT_COUNT;
  if (m.u16(TIMER_CONTROL) & 2) {
    ax = (m.u16(TIMER_HOOK_COUNT) + 1) & 0xffff;
    m.set16(TIMER_HOOK_COUNT, ax);
    if (ax >= m.u16(TIMER_HOOK)) {
      m.set16(TIMER_HOOK_COUNT, 0);
      m.set16(m.push(2), 0xe3af);
      ax = callNear(m, m.u16(TIMER_CHAIN));
      m.pop(2);
    }
  }
  m.pop(4);
  return ax;
}

// 14c8:00a8 timer interrupt handler: on its own stack (interrupted SS:SP kept at 14c8:010f), runs the timer tick,
// then acknowledges the interrupt, except every 4th time when it jumps to the previous handler instead.
export function timerInterruptHandler(m: Memory): void {
  setCodeWord(m, 0x10f, m.ds);
  setCodeWord(m, 0x111, m.sp);
  const sp = m.sp;
  m.sp = ISR_STACK;
  // ds es si di ax bx cx dx of the interrupted code.
  m.push(16);
  const ret = m.push(4);
  m.set16(ret, 0x00d1);
  m.set16(ret + 2, codeSegment(m, 0x14c8));
  timerTick(m);
  m.sp = sp;
  m.set8(BIOS_DIVIDER, m.u8(BIOS_DIVIDER) + 1);
  if (m.s8(BIOS_DIVIDER) < 4) {
    outPort(m, 0x20, 0x20);
    return;
  }
  m.set8(BIOS_DIVIDER, 0);
  chain(m, 8, codeWord(m, 0x10d), codeWord(m, 0x10b));
}

// 14c8:0141 keyboard interrupt handler: direction keys (make and break codes) update DS:273b and DS:273a and are
// swallowed; every other key goes to the previous handler (the BIOS: into the int 16h buffer).
export function keyboardInterruptHandler(m: Memory): void {
  const code = inPort(m, 0x60);
  const key = DIRECTION_KEYS.indexOf(code & 0x7f);
  if (key < 0) {
    chain(m, 9, codeWord(m, 0x1b5), codeWord(m, 0x1b3));
    return;
  }
  const held = (code & 0x80 ? m.u8(KEYS_HELD) & ~(1 << key) : m.u8(KEYS_HELD) | (1 << key)) & 0xff;
  m.set8(KEYS_HELD, held);
  const view = m.u8(VIEW_ROTATION);
  let dirs = held;
  if (view & 1) dirs = (held >> 1) | (held << 7);
  else if (view & 2) dirs = (held << 1) | (held >> 7);
  m.set8(KEY_DIRS, dirs);
  const control = inPort(m, 0x61);
  outPort(m, 0x61, control | 0x80);
  outPort(m, 0x61, control);
  outPort(m, 0x20, 0x20);
}

// 0:e3b3 timer_install(): frees the timer slots, saves vector 08h, installs 14c8:00a8 and programs the PIT to
// divisor 3fffh (72.8 Hz).
export function timerInstall(m: Memory): void {
  for (let i = 0; i < TIMER_SLOT_COUNT; i++) timerFree(m, i);
  m.set16(TIMER_CONTROL, 0);
  m.set16(TIMER_CHAIN, 0xe345);
  m.set16(BIOS_DIVIDER, 0);
  const old = getvect(m, 8);
  m.set16(OLD_TIMER_SEG, old >>> 16);
  m.set16(OLD_TIMER_OFF, old);
  setOldTimer(m, old & 0xffff, old >>> 16);
  setvect(m, 8, 0x00a8, codeSegment(m, 0x14c8));
  setTimerDivisor(m, 0x3fff);
}

// 0:e41f timer_restore(): frees the timer slots, puts vector 08h back and the PIT to divisor ffffh.
export function timerRestore(m: Memory): void {
  for (let i = 0; i < TIMER_SLOT_COUNT; i++) timerFree(m, i);
  m.set16(TIMER_CONTROL, 0);
  m.set16(TIMER_CHAIN, 0xe345);
  setvect(m, 8, m.u16(OLD_TIMER_OFF), m.u16(OLD_TIMER_SEG));
  setTimerDivisor(m, 0xffff);
}

// 0:e5fb keyboard_install(): saves vector 09h and installs 14c8:0141.
export function keyboardInstall(m: Memory): void {
  const old = getvect(m, 9);
  m.set16(OLD_KEYBOARD_SEG, old >>> 16);
  m.set16(OLD_KEYBOARD_OFF, old);
  setOldKeyboard(m, old & 0xffff, old >>> 16);
  setvect(m, 9, 0x0141, codeSegment(m, 0x14c8));
}

// 0:e62b keyboard_restore(): puts vector 09h back if keyboard_install saved it.
export function keyboardRestore(m: Memory): void {
  if (m.u16(OLD_KEYBOARD_SEG) || m.u16(OLD_KEYBOARD_OFF)) setvect(m, 9, m.u16(OLD_KEYBOARD_OFF), m.u16(OLD_KEYBOARD_SEG));
}

// 0:e740 translate_key(ax): int 16h key -> ascii, scancode | 80h for keys without ascii, 0 for scancode 3,
// -2 for 0.
export function translateKey(_m: Memory, ax: number): number {
  if (ax & 0xff) return ax & 0xff;
  const scancode = ax >> 8;
  if (!scancode) return 0xfffe;
  return scancode === 3 ? 0 : scancode | 0x80;
}

// 0:e719 getch(): next key (translated), echoed while DS:29ea is set. The machine returns Esc when no key is
// waiting.
export function getch(m: Memory): number {
  const r = regs(m);
  int16(m, r);
  const key = translateKey(m, r.ax);
  if (m.u8(ECHO) && key < 0x80) echo(m, key);
  return key;
}

// 0:e732 kbhit(): the waiting key (translated, left in the buffer), or -1 when there is none.
export function kbhit(m: Memory): number {
  const r = regs(m, { ax: 0x0100 });
  int16(m, r);
  return r.flags & ZF ? 0xffff : translateKey(m, r.ax);
}

// 0:e75b echo(c): prints c at the cursor (with attribute DS:29ec for printable characters).
export function echo(m: Memory, c: number): number {
  const ch = c & 0xff;
  if (ch >= 0x20) video(m, 0x0900 | ch, m.u16(ECHO_ATTR), 1, 0);
  video(m, 0x0e00 | ch, m.u16(ECHO_ATTR), 0, 0);
  return ch;
}

// 0:e79a video(ax, bx, cx, dx): int 10h; returns AX.
export function video(m: Memory, ax: number, bx: number, cx: number, dx: number): number {
  const r = regs(m, { ax, bx, cx, dx });
  int10(m, r);
  return r.ax;
}

// 14c8:01e9 read_joystick(x, y): times both axes of the joystick with PIT channel 0 and stores them as longs;
// 0, or -1 without a joystick (DS:6229 clear) or when an axis never settles.
export function readJoystick(m: Memory, xOut: number, yOut: number): number {
  if (!m.u8(JOYSTICK)) return 0xffff;
  outPort(m, 0x43, 0);
  outPort(m, 0x201, 0);
  outPort(m, 0x201, 0);
  const start = inPort(m, 0x40) | (inPort(m, 0x40) << 8);
  let mask = m.u8(JOY_MASK);
  let count = 0x4fff;
  let x = 0;
  let y = 0;
  do {
    let changed: number;
    do {
      changed = (inPort(m, 0x201) & m.u8(JOY_MASK)) ^ mask;
      count = (count - 1) & 0xffff;
    } while (count && !changed);
    if (!count) return 0xffff;
    outPort(m, 0x43, 0);
    const now = (inPort(m, 0x40) << 8) | inPort(m, 0x40);
    if (m.u8(JOY_X_MASK) & changed) {
      x = now;
      mask &= m.u8(JOY_Y_MASK);
    }
    if (m.u8(JOY_Y_MASK) & changed) {
      y = now;
      mask &= m.u8(JOY_X_MASK);
    }
  } while (mask);
  // Counter values are read high byte first; the PIT counts down from 3fffh.
  const elapsed = (v: number) => {
    const t = ((v >> 8) | (v << 8)) & 0xffff;
    return (start < t ? start + 0x3fff - t : start - t) & 0x7fff;
  };
  m.set16(xOut, elapsed(x));
  m.set16(xOut + 2, 0);
  m.set16(yOut, elapsed(y));
  m.set16(yOut + 2, 0);
  return 0;
}

// 14c8:02af joystick_present(): 1 when both axis bits of port 201h are set and then one of them drops.
export function joystickPresent(m: Memory): number {
  outPort(m, 0x201, 0);
  const mask = m.u8(JOY_MASK);
  if ((inPort(m, 0x201) & mask) !== mask || (inPort(m, 0x201) & mask) !== mask) return 0;
  let count = 0x4fff;
  let changed: number;
  do {
    changed = (inPort(m, 0x201) & m.u8(JOY_MASK)) ^ mask;
    count = (count - 1) & 0xffff;
  } while (count && !changed);
  return count ? 1 : 0;
}

// 14fd:000a detect_adapter(): display code from the int 10h 1Ah display combination (VGA BIOS): AH for the
// secondary display, AL for the active one.
export function detectAdapter(m: Memory): number {
  const r = regs(m, { ax: 0x1a00 });
  int10(m, r);
  const secondary = r.bx >> 8;
  const ah = secondary ? m.u8(DISPLAY_CODES + secondary) : 0;
  return (ah << 8) | m.u8(DISPLAY_CODES + (r.bx & 0xff));
}

// fff:2bd5 restore_video(): puts back the BIOS equipment byte and the video mode from before the game.
export function restoreVideo(m: Memory): number {
  m.bytes[BIOS_EQUIPMENT] = m.u8(OLD_EQUIPMENT);
  const r = regs(m, { ax: m.u8(OLD_VIDEO_MODE) });
  int10(m, r);
  return r.ax;
}

register("0:ef5b", inportb);
register("0:ef70", outportb);
register("14c8:034f", inportbFar);
register("14c8:01e5", disable);
register("14c8:01e7", enable);
register("14c8:002a", setvect);
register("14c8:003b", getvect);
register("14c8:0117", setOldTimer);
register("14c8:01cb", setOldKeyboard);
register("14c8:0131", setTimerDivisor);
register("0:e345", noTimerHook);
register("0:e346", timerTick);
register("14c8:00a8", timerInterruptHandler);
register("14c8:0141", keyboardInterruptHandler);
register("0:e3b3", timerInstall);
register("0:e41f", timerRestore);
register("0:e5fb", keyboardInstall);
register("0:e62b", keyboardRestore);
register("0:e740", translateKey);
register("0:e719", getch);
register("0:e732", kbhit);
register("0:e75b", echo);
register("0:e79a", video);
register("14c8:01e9", readJoystick);
register("14c8:02af", joystickPresent);
register("14fd:000a", detectAdapter);
register("fff:2bd5", restoreVideo);
