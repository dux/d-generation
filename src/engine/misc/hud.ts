import { forEachObject } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { int21, regs } from "../dos/machine.ts";
import { drawText, wrapText } from "../geometry/draw.ts";
import type { Memory } from "../memory.ts";
import {
  farMemcpy,
  farMemsetSegFirst,
  sprintf,
  strncpy,
  timerAlloc,
  timerEnable,
  timerFreeze,
  timerGet,
  timerSet,
  timerThaw,
} from "../runtime.ts";
import { waitKey } from "./input.ts";
import { playSound } from "./sound.ts";

// Message panel at the bottom of the screen: rows DS:1980 (panel top) .. DS:309c of the screen buffer.

export const PANEL_TOP = 0x1980;
export const MESSAGE_POS = 0x2c36; // x, y
export const MESSAGE_TIMED = 0x2c3a;
export const MESSAGE_TIMER = 0x2c3c;
export const MESSAGE_TIME = 0x2c3e;
export const MESSAGE = 0x2c40; // pending text, 0xff bytes
export const MESSAGE_COLOR = 0x9984;
export const RESTORE_TOP = 0x3a7e; // rows below are restored from the background buffer
const TEXT_COLOR = 0x6225;
const CLOCK_SLOT = 0x33f4;
const BLINK_SLOT = 0x5f62;
const BLINK_ON = 0x9985;
const SCREEN_SEG = 0x27ca;
const BACKGROUND_SEG = 0x30ae;
const PITCH = 0x30be;
const SCREEN_ROWS = 0x309c;

const slot = (m: Memory, at: number) => m.s8(at) & 0xffff;

// 0:cb62 setHeldWalls(flag): 0:cb77 on every object.
export function setHeldWalls(m: Memory, flag: number): void {
  m.set16(0x9982, flag);
  forEachObject(m, 0xcb77);
}

// 0:cb77 callback(obj): class 2 objects get 0:4505(obj, 0xff when DS:9982 and +0x83 set, else 0) and +0x88 = 1.
function setHeldWallsEach(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 2) {
    call(m, "0:4505", obj, m.u16(0x9982) !== 0 && m.u8(obj + 0x83) !== 0 ? 0xff : 0);
    m.set8(obj + 0x88, 1);
  }
  return 0;
}

// 0:cbba getDate(month, day): the DOS date into the words at month and day.
export function getDate(m: Memory, month: number, day: number): void {
  const date = dosDate(m);
  m.set16(month, (date << 16) >> 24);
  m.set16(day, date & 0xff);
}

// 0:cbe3 dosDate(): int 21h AH=2Ah, DX = month << 8 | day.
export function dosDate(m: Memory): number {
  const r = regs(m, { ax: 0x2a00 });
  int21(m, r);
  return r.dx;
}

// 0:cbea clearPanel(color): fills the screen rows from the panel top down with color.
export function clearPanel(m: Memory, color: number): void {
  const start = (m.u16(PANEL_TOP) * m.u16(PITCH)) & 0xffff;
  const end = (m.u16(PITCH) * m.u16(SCREEN_ROWS)) & 0xffff;
  farMemsetSegFirst(m, m.u16(SCREEN_SEG), start, (end - start) & 0xffff, color);
}

// 0:cd0e restorePanel(top): rows top .. DS:3a7e back from the background buffer, the rest cleared to 0.
export function restorePanel(m: Memory, top: number): void {
  let start = (top * m.u16(PITCH)) & 0xffff;
  if (((top << 16) >> 16) < m.s16(RESTORE_TOP)) {
    const end = (m.u16(RESTORE_TOP) * m.u16(PITCH)) & 0xffff;
    farMemcpy(m, m.u16(BACKGROUND_SEG), start, m.u16(SCREEN_SEG), start, (end - start) & 0xffff);
    start = end;
  }
  const end = (m.u16(PITCH) * m.u16(SCREEN_ROWS)) & 0xffff;
  farMemsetSegFirst(m, m.u16(SCREEN_SEG), start, (end - start) & 0xffff, 0);
}

// 0:cf09 drawMessage(str, time, color): clears the panel and draws str with a shadow (colors DS:1ff8); a nonzero
// time starts the message timer.
export function drawMessage(m: Memory, str: number, time: number, color: number): void {
  const saved = timerGet(m, slot(m, CLOCK_SLOT));
  clearPanel(m, color);
  m.set16(MESSAGE_POS, m.u16(MESSAGE_POS) + 1);
  m.set16(MESSAGE_POS + 2, m.u16(MESSAGE_POS + 2) + 1);
  for (let i = 0; i < 2; i++) {
    m.set8(TEXT_COLOR, m.u8(0x1ff8 + i));
    drawText(m, MESSAGE_POS, str, 1 - i);
    m.set16(MESSAGE_POS, m.u16(MESSAGE_POS) - 1);
    m.set16(MESSAGE_POS + 2, m.u16(MESSAGE_POS + 2) - 1);
  }
  m.set16(MESSAGE_POS, m.u16(MESSAGE_POS) + 1);
  m.set16(MESSAGE_POS + 2, m.u16(MESSAGE_POS + 2) + 1);
  if (time !== 0) {
    m.set16(MESSAGE_TIMED, 1);
    timerSet(m, m.u16(MESSAGE_TIMER), time);
    timerFreeze(m, m.u16(MESSAGE_TIMER));
  } else {
    m.set16(MESSAGE_TIMED, 0);
  }
  timerSet(m, slot(m, CLOCK_SLOT), saved);
}

// 0:cfa6 updateMessage(): draws a pending message; clears the panel when a timed message expires.
export function updateMessage(m: Memory): void {
  if (m.u8(MESSAGE) !== 0) {
    drawMessage(m, MESSAGE, m.u16(MESSAGE_TIME), slot(m, MESSAGE_COLOR));
    m.set8(MESSAGE, 0);
    m.set16(RESTORE_TOP, m.u16(PANEL_TOP));
  }
  if (m.u16(MESSAGE_TIMED) !== 0 && timerGet(m, m.u16(MESSAGE_TIMER)) === 0) {
    m.set16(RESTORE_TOP, 0xb5);
    restorePanel(m, m.u16(PANEL_TOP));
    m.set8(0x1996, 1);
    m.set16(MESSAGE_TIMED, 0);
  }
}

// 0:cff8 setMessage(str, seconds, color): queues a message for 0:cfa6 (shown 55 ticks per second, 0 = until
// replaced).
export function setMessage(m: Memory, str: number, seconds: number, color: number): void {
  if (str === 0) return;
  strncpy(m, MESSAGE, str, 0xfe);
  m.set8(MESSAGE + 0xfe, 0);
  m.set16(MESSAGE_TIME, Math.imul(0x37, (seconds << 16) >> 16));
  m.set8(MESSAGE_COLOR, color);
  m.set8(TEXT_COLOR, 0xaf);
}

// 0:d02f messageInit()
export function messageInit(m: Memory): void {
  m.set16(MESSAGE_TIMER, timerAlloc(m));
  timerEnable(m, m.u16(MESSAGE_TIMER), 1);
  m.set16(MESSAGE_TIMED, 0);
  m.set8(MESSAGE, 0);
  m.set16(MESSAGE_POS, 0xa);
  m.set16(MESSAGE_POS + 2, m.u16(PANEL_TOP) + 3);
}

// 0:d05e showStats(): formats DS:1ffa with the counters at DS:3362.. and the level (DS:337e + 1) as a message.
export function showStats(m: Memory): void {
  const buf = m.push(0x78);
  sprintf(
    m,
    buf,
    0x1ffa,
    m.s8(0x3362) & 0xffff,
    m.s8(0x3365) & 0xffff,
    m.s8(0x3364) & 0xffff,
    m.s8(0x3363) & 0xffff,
    m.s8(0x3367) & 0xffff,
    m.u8(0x337e) + 1,
  );
  setMessage(m, buf, 6, 0x10);
  updateMessage(m);
  m.pop(0x78);
}

// 0:d0ab messageBox(str, color, lines, restore): word-wrapped text in a panel sized for lines (0 = measure,
// -1 = full screen), waits for a key; returns 1 for Enter.
export function messageBox(m: Memory, str: number, color: number, lines: number, restore: number): number {
  let enter = 0;
  const savedTop = m.u16(PANEL_TOP);
  const pos = m.push(4);
  m.set8(TEXT_COLOR, 0xaf);
  if (lines === 0) {
    m.set16(pos + 2, 0xb);
    m.set16(pos, 0xb);
    lines = wrapText(m, pos, str, 0, 0) & 0xffff;
    if (lines === 1) lines = 2;
  }
  if (lines === 0xffff) {
    m.set16(PANEL_TOP, 0);
    m.set16(pos + 2, 4);
    m.set16(pos, 0xb);
  } else {
    const top = (0xc3 - lines * 23) & 0xffff;
    m.set16(PANEL_TOP, top);
    m.set8(TEXT_COLOR, 0xaf);
    m.set16(pos + 2, top + 4);
    m.set16(pos, 0xb);
  }
  clearPanel(m, color);
  for (let i = 0; i < 2; i++) {
    m.set8(TEXT_COLOR, m.u8(0x1ff8 + i));
    wrapText(m, pos, str, 1, 1 - i);
    m.set16(pos, m.u16(pos) - 1);
    m.set16(pos + 2, m.u16(pos + 2) - 1);
  }
  if (waitKey(m, 1) === 0xd) enter = 1;
  if (m.u16(MESSAGE_TIMED) !== 0) {
    m.set16(RESTORE_TOP, 0xb5);
    m.set16(MESSAGE_TIMED, 0);
  }
  if ((restore & 0xff) !== 0) restorePanel(m, m.u16(PANEL_TOP));
  playSound(m, 0x1c3e);
  m.set16(PANEL_TOP, savedTop);
  m.set8(0x1996, 1);
  m.pop(4);
  return enter;
}

// 0:d1bd inputLine(buf, max, color, prompt, cursorColor): edits a line of letters and spaces in the panel with a
// blinking cursor; Esc empties it, Enter accepts, Ctrl-X clears, Backspace deletes.
export function inputLine(m: Memory, buf: number, max: number, color: number, prompt: number, cursorColor: number): void {
  let len = 0;
  const saved = timerGet(m, slot(m, CLOCK_SLOT));
  resetBlink(m, 0xb);
  m.set8(BLINK_ON, 0);
  m.set8(buf, 0);
  const pos = m.push(4);
  m.set16(MESSAGE_POS, 0xa);
  m.set16(pos, 0xa);
  let x = 0xa;
  m.set16(MESSAGE_POS + 2, m.u16(PANEL_TOP) + 3);
  const y = (m.u16(PANEL_TOP) + 3 + 0xb) & 0xffff;
  m.set16(pos + 2, y);
  const cursor = cursorColor & 0xff;
  clearPanel(m, color & 0xff);
  drawText(m, MESSAGE_POS, prompt, 0);
  for (;;) {
    while (call(m, "0:e732") === 0xffff) cursorBlink(m, x, y, 0x5f, 1, cursor);
    const key = call(m, "0:e719") & 0xff;
    if (key === 0x1b) {
      m.set8(buf, 0);
      break;
    }
    if (key === 0xd) break;
    if (key === 0x18) {
      len = 0;
      m.set8(buf, 0);
      clearPanel(m, color & 0xff);
      drawText(m, MESSAGE_POS, prompt, 0);
    } else if (key === 8) {
      if (len !== 0) {
        len--;
        m.set8(buf + len, 0);
      }
      m.set8(BLINK_ON, 0);
    } else if (key >= 0x20 && key <= 0x7a && (key <= 0x5a || key >= 0x61)) {
      if (((x << 16) >> 16) <= 0x131 && len !== max) {
        m.set8(buf + len, key);
        len++;
        m.set8(buf + len, 0);
      }
    }
    drawColorCode(m, x, y, cursor);
    x = drawText(m, pos, buf, 0) & 0xffff;
    drawColorCode(m, x, y, cursor);
    cursorBlink(m, x, y, 0x5f, 0, cursor);
  }
  restorePanel(m, m.u16(PANEL_TOP));
  timerSet(m, slot(m, CLOCK_SLOT), saved);
  m.set8(0x1996, 1);
  m.pop(4);
}

// 0:d365 cursorBlink(x, y, ch, blink, color): draws ch at x, y, or (blink phase off) only the color code.
export function cursorBlink(m: Memory, x: number, y: number, ch: number, blink: number, color: number): void {
  if ((blink & 0xff) !== 0 && timerGet(m, slot(m, BLINK_SLOT)) === 0) {
    m.set8(BLINK_ON, m.u8(BLINK_ON) ^ 1);
    resetBlink(m, 0xb);
  }
  if ((blink & 0xff) !== 0 && m.u8(BLINK_ON) === 0) {
    drawColorCode(m, x, y, ((color << 24) >> 24) & 0xffff);
    return;
  }
  m.set8(0x2056, ch);
  const pos = m.push(4);
  m.set16(pos, x);
  m.set16(pos + 2, y);
  drawText(m, pos, 0x2056, 0);
  m.pop(4);
}

// 0:d3c6 drawColorCode(x, y, color): draws the string at DS:2058 with color digit color + '0'.
export function drawColorCode(m: Memory, x: number, y: number, color: number): void {
  m.set8(0x2059, color + 0x30);
  m.set8(0x205a, 0x5d);
  const pos = m.push(4);
  m.set16(pos, x);
  m.set16(pos + 2, y);
  drawText(m, pos, 0x2058, 0);
  m.pop(4);
}

// 0:d3ee resetBlink(ticks): restarts the cursor blink timer.
export function resetBlink(m: Memory, ticks: number): void {
  const blink = slot(m, BLINK_SLOT);
  timerThaw(m, blink);
  timerSet(m, blink, ticks);
  timerEnable(m, blink, 1);
  timerFreeze(m, blink);
}

register("0:cb62", setHeldWalls);
register("0:cb77", setHeldWallsEach);
register("0:cbba", getDate);
register("0:cbe3", dosDate);
register("0:cbea", clearPanel);
register("0:cd0e", restorePanel);
register("0:cf09", drawMessage);
register("0:cfa6", updateMessage);
register("0:cff8", setMessage);
register("0:d02f", messageInit);
register("0:d05e", showStats);
register("0:d0ab", messageBox);
register("0:d1bd", inputLine);
register("0:d365", cursorBlink);
register("0:d3c6", drawColorCode);
register("0:d3ee", resetBlink);
