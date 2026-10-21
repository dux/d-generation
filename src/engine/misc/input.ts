import { findObject } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { updateBox } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { timerGet, timerSet } from "../runtime.ts";
import { playSound } from "./sound.ts";

// Fire buttons (joystick port 201h, or keys) and the demo recorder. Button states returned by readButton:
// 1 just pressed, 2 held, 3 just released, 4 up.
// Demo events: 5-byte records { u32 time, u8 code } at DS:8556; code < 0x32 button 1 state, 0x32 button 0 press,
// 100 + id object position follows in the next two records (time words = x, y).

export const RECORDING = 0x1986;
export const PLAYBACK = 0x1987;
export const DEMO_CLOCK = 0x1982; // u32
export const DEMO_INDEX = 0x3920;
const DEMO_EVENTS = 0x8556;
const PLAYER = 0x3400;

function event(m: Memory): number {
  return (DEMO_EVENTS + m.u16(DEMO_INDEX) * 5) & 0xffff;
}

function eventTime(m: Memory, e: number): number {
  return (m.u16(e) | (m.u16(e + 2) << 16)) >>> 0;
}

function clock(m: Memory): number {
  return (m.u16(DEMO_CLOCK) | (m.u16(DEMO_CLOCK + 2) << 16)) >>> 0;
}

// Appends the time words of one event (and its code when code >= 0).
function record(m: Memory, lo: number, hi: number, code: number): void {
  const e = event(m);
  if (code >= 0) m.set8(e + 4, code);
  m.set16(e + 2, hi);
  m.set16(e, lo);
  m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 1);
}

// 0:bc9d waitKey(click): waits for buttons up, then a key (Esc for button 0, Enter for button 1), then buttons up
// again, ticking the demo clock; returns the key.
export function waitKey(m: Memory, click: number): number {
  let key = 0;
  const clockSlot = m.s8(0x33f4) & 0xffff;
  const saved = timerGet(m, clockSlot);
  m.set16(0x1998, 0);
  while (readButton(m, 0) < 3 || readButton(m, 1) < 3) demoTick(m);
  for (;;) {
    demoTick(m);
    if (call(m, "0:e732") !== 0xffff) {
      key = call(m, "0:e719") & 0xff;
      break;
    }
    if (readButton(m, 0) === 2) {
      key = 0x1b;
      break;
    }
    if (readButton(m, 1) === 2) {
      key = 0xd;
      break;
    }
  }
  if ((click & 0xff) !== 0) playSound(m, 0x1c3e);
  m.set16(0x1998, 0);
  while (readButton(m, 0) < 3 || readButton(m, 1) < 3) demoTick(m);
  timerSet(m, m.s8(0x33f4) & 0xffff, saved);
  return ((key << 24) >> 24) & 0xffff;
}

// 0:bd5c demoTick(): while recording or playing back, every 100 calls runs 0:1ff6 and advances the demo clock by
// DS:3408.
export function demoTick(m: Memory): void {
  if (m.u8(RECORDING) === 0 && m.u8(PLAYBACK) === 0) return;
  const n = m.u16(0x1998);
  m.set16(0x1998, n + 1);
  if (n !== 0x64) return;
  call(m, "0:1ff6");
  m.set16(0x1998, 0);
  const t = (clock(m) + m.s16(0x3408)) >>> 0;
  m.set16(DEMO_CLOCK, t & 0xffff);
  m.set16(DEMO_CLOCK + 2, t >>> 16);
}

// 0:c77b readButton(which): state of fire button 0 or 1 (see top), from the joystick or demo playback; records
// button 1 changes and button 0 presses while recording.
export function readButton(m: Memory, which: number): number {
  which &= 0xff;
  let state = 0;
  if (m.u8(PLAYBACK) !== 0) {
    if (which === 1) return playbackButton1(m);
    if (which === 0) return playbackButton0(m);
  }
  if (m.u8(0x6229) === 0) {
    state = 4;
  } else {
    const bits = call(m, "14c8:034f", 0x201) & 0xf0;
    if (m.u8(0x997d) === 0) {
      if (bits !== m.u8(0x997c)) {
        m.set8(0x997d, 1);
        const diff = (((((bits << 24) >> 24) ^ m.s8(0x997c)) & 0xffff) >> 4) & 0xf;
        m.set8(0x997f, m.u8(0x1fd6 + diff * 2));
        m.set8(0x9980, m.u8(0x1fd7 + diff * 2));
        const both = (m.s8(0x997f) & ((bits << 24) >> 24)) === m.s8(0x997f) ? 1 : 0;
        m.set8(0x9981, both);
        if (both) {
          m.set8(0x1ff7, 0);
          m.set8(0x1ff6, 0);
        } else {
          m.set8(0x1ff6, m.u8(0x997f));
          m.set8(0x1ff7, m.u8(0x9980));
        }
      } else {
        state = 4;
      }
    }
    if (m.u8(0x997d) !== 0) {
      let mask: number;
      let prev: number;
      if (which === 0) {
        mask = m.u8(0x9980);
        prev = m.u8(0x1ff7);
        m.set8(0x1ff7, bits & mask);
      } else {
        mask = m.u8(0x997f);
        prev = m.u8(0x1ff6);
        m.set8(0x1ff6, bits & mask);
      }
      if (m.u8(0x9981) !== 0) {
        if (bits & mask) state = prev ? 1 : 2;
        else state = prev ? 3 : 4;
      } else {
        const pressed = bits & mask ? 1 : 0;
        if (m.u8(RECORDING) !== 0 && which === 1 && pressed !== m.u8(0x391e)) {
          m.set8(0x391e, pressed);
          record(m, m.u16(DEMO_CLOCK), m.u16(DEMO_CLOCK + 2), pressed);
        }
        if (pressed) state = prev ? 4 : 3;
        else state = prev ? 2 : 1;
      }
    }
  }
  if (m.u8(RECORDING) !== 0 && which === 0 && state === 2) {
    if (m.u8(0x1997) !== 0) record(m, m.u16(DEMO_CLOCK), m.u16(DEMO_CLOCK + 2), 0x32);
    else recordObject(m, m.u16(m.u16(PLAYER)));
  }
  return state;
}

// 0:c993 recordObject(id): while recording, logs the object's position (x +7, y +9).
export function recordObject(m: Memory, id: number): void {
  if (m.u8(RECORDING) === 0) return;
  const obj = findObject(m, id);
  record(m, m.u16(DEMO_CLOCK), m.u16(DEMO_CLOCK + 2), (id + 0x64) & 0xff);
  record(m, m.u16(obj + 7), 0, -1);
  record(m, m.u16(obj + 9), 0, -1);
}

// 0:ca27 playbackButton1(): replays due events and returns button 1's state.
export function playbackButton1(m: Memory): number {
  m.set8(0x997e, m.u8(0x391e));
  const e = event(m);
  if (eventTime(m, e) <= clock(m)) {
    if (m.u8(e + 4) < 0x32) {
      m.set8(0x391e, m.u8(e + 4));
      m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 1);
    } else {
      playbackObject(m);
    }
  }
  const was = m.u8(0x997e) !== 0;
  if (m.u8(0x391e) !== 0) return was ? 4 : 3;
  return was ? 2 : 1;
}

// 0:caa6 playbackObject(): applies a recorded object position (code 100 = the player).
export function playbackObject(m: Memory): void {
  const code = m.u8(event(m) + 4);
  const obj = code === 0x64 ? m.u16(PLAYER) : findObject(m, (code - 100) & 0xffff);
  if (obj === 0) {
    m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 3);
    return;
  }
  m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 1);
  m.set16(obj + 7, m.u16(event(m)));
  m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 1);
  m.set16(obj + 9, m.u16(event(m)));
  m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 1);
  updateBox(m, obj);
}

// 0:cb29 playbackButton0(): 2 when a recorded button 0 press is due (consuming it), else 4.
export function playbackButton0(m: Memory): number {
  const e = event(m);
  if (eventTime(m, e) <= clock(m) && m.u8(e + 4) === 0x32) {
    m.set16(DEMO_INDEX, m.u16(DEMO_INDEX) + 1);
    return 2;
  }
  return 4;
}

register("0:bc9d", waitKey);
register("0:bd5c", demoTick);
register("0:c77b", readButton);
register("0:c993", recordObject);
register("0:ca27", playbackButton1);
register("0:caa6", playbackObject);
register("0:cb29", playbackButton0);
