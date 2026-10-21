import { forEachObject } from "../core/objects.ts";
import { call, register } from "../dispatch.ts";
import { nameMatches, namePick, nextObjectOfClass } from "../geometry/math.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, PLAYER, RECEIVER, RECORD_BYTE, ROUND, SCENE, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { playSound } from "../misc/sound.ts";
import { random } from "../random.ts";
import { setPalette } from "../vga.ts";

// Class 7, CUB.VGA: cubicles/terminals. Kind (record byte 3 low 3 bits, obj+0x83) and state (bits 5-7, obj+0x84);
// kind 6 is the room-event terminal (room 0x16 / 0x51 / 0x85 scripts), obj+0x89 a pickup id from the room's name pick.

const s8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;
const s16 = (v: number): number => ((v & 0xffff) ^ 0x8000) - 0x8000;

const INPUT = 0x61d4; // text input buffer

// 0:85b0 cubFade(level): set the 3+3+3 palette entries at 0x6d and 0x3d for brightness level.
export function cubFade(m: Memory, level: number): void {
  const al = (level + 0x30) & 0xff;
  m.set8(0x9a9, s8(al) > 0x3f ? 0x3f : al);
  m.set8(0x9a6, level + 0x17);
  m.set8(0x9ac, level + 0x23);
  setPalette(m, 0x9a6, 0x6d, 3);
  const a = (0x33 - level) & 0xff;
  m.set8(0x9af, a);
  m.set8(0x9b1, a);
  const b = (0x1a - level) & 0xff;
  m.set8(0x9b2, b);
  m.set8(0x9b4, b);
  const c = (0x26 - level) & 0xff;
  m.set8(0x9b5, c);
  m.set8(0x9b7, c);
  setPalette(m, 0x9af, 0x3d, 3);
}

// 0:8515 cubCountdown(): run the obj+0x8a countdown (one step per 0x258 ticks), fading and finally ending it.
export function cubCountdown(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0x8a) === 0) return;
  const t = (m.u16(obj + 0x8b) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(obj + 0x8b, t);
  if (s16(t) >= 0) return;
  m.set16(obj + 0x8b, t + 0x258);
  const v = (m.u8(obj + 0x8a) - 1) & 0xff;
  m.set8(obj + 0x8a, v);
  if (v !== 0) {
    cubFade(m, s8(m.u8(0x96d + s8(v))));
    if (v === 0x20) {
      const bp = m.push(0x12) + 0x12;
      m.set8(bp - 0xf, 0);
      const found = nextObjectOfClass(m, 0x1a, bp - 0xf);
      if (found) {
        m.set16(bp - 0xc, found);
        m.set16(bp - 0xe, m.u16(UPDATE_OBJECT));
        call(m, "0:2c71", 9, bp - 0xe);
      }
      m.pop(0x12);
    }
  } else {
    cubFade(m, 0xfffe);
    call(m, "0:7d8f", 6, 0);
  }
}

// 0:867c isIdleClass2(obj): for-each callback, obj of class 2 with obj+0x83 == 0.
export function isIdleClass2(m: Memory, obj: number): number {
  return m.u8(obj + 2) === 2 && m.u8(obj + 0x83) === 0 ? 1 : 0;
}

// 0:8667 noIdleClass2(): 1 when no class-2 object has obj+0x83 == 0.
export function noIdleClass2(m: Memory): number {
  return forEachObject(m, 0x867c) ? 0 : 1;
}

// 0:8629 cubStartCountdown(): in room 0x85 with DS:3c5 set, start the countdown once no class-2 object is idle.
export function cubStartCountdown(m: Memory): void {
  if (m.u8(SCENE) !== 0x85) return;
  if (m.u8(m.u16(UPDATE_OBJECT) + 0x8a) !== 0 || m.u8(0x3c5) === 0) return;
  if (!noIdleClass2(m)) return;
  m.set8(m.u16(UPDATE_OBJECT) + 0x8a, 0x39);
  playSound(m, 0x1ae6);
}

// 0:8484 cubUpdate(): countdown, common update, and spawn a 0x86 object toward the player when obj+0x87 is set.
export function cubUpdate(m: Memory): void {
  cubStartCountdown(m);
  cubCountdown(m);
  call(m, "0:6f77");
  const obj = m.u16(UPDATE_OBJECT);
  if (m.u8(obj + 0x87) === 0 || m.u16(PLAYER) === 0) return;
  const dir = call(m, "0:4027", m.u16(PLAYER), 0x50, 4) & 0xff;
  if (dir === 0xff) return;
  m.set8(obj + 3, m.u8(ROUND));
  const bp = m.push(6) + 6;
  m.set8(bp - 4, ((((s8(dir) + 4) >> 3) & 7) << 4) | 0x86);
  m.set8(bp - 3, m.u8(obj + 8));
  m.set8(bp - 2, m.u8(obj + 0xa));
  if (call(m, "0:2818", bp - 4) & 0xffff) {
    playSound(m, 0x1d7e);
    call(m, "0:1de6", 0, 2);
  }
  m.pop(6);
}

// 0:8a0e cubEvent07(): room 7 terminal text.
export function cubEvent07(m: Memory): void {
  call(m, "0:3ae1", 0xa, 0);
  call(m, "0:d0ab", 0xa93, 0, 0xffff, 0);
}

// 0:8a33 cubEvent11(): room 0x11 terminal texts.
export function cubEvent11(m: Memory): void {
  call(m, "0:3ae1", 0xa, 0);
  call(m, "0:d0ab", 0xc0c, 0, 0xffff, 0);
  call(m, "0:3ae1", 0xa, 0);
  call(m, "0:d0ab", 0xe32, 0, 0xffff, 0);
}

function prompt(m: Memory, text: number): boolean {
  call(m, "0:d1bd", INPUT, 0x50, 0, text, 8);
  if (m.u8(INPUT) === 0) return false;
  call(m, "12cc:17b4", INPUT);
  return true;
}

// 0:8a7c cubEvent16(): room 0x16 two-question password terminal.
export function cubEvent16(m: Memory): void {
  let first = 0;
  if (!prompt(m, 0xf9c)) return;
  if (nameMatches(m, INPUT, 0xfab)) first = 1;
  if (!prompt(m, 0xfb3)) return;
  if (nameMatches(m, INPUT, 0xfc1) && first) {
    call(m, "0:7d8f", 0, 0);
    call(m, "0:cff8", 0xfc8, 4, 0);
  } else {
    call(m, "0:cff8", 0xfd7, 4, 0);
  }
}

// 0:8b49 cubEvent51(): room 0x51 password terminal (answer picked by DS:6224).
export function cubEvent51(m: Memory): void {
  if (!prompt(m, 0xff7)) return;
  if (nameMatches(m, INPUT, m.u16(0x8ba + 2 * s8(m.u8(0x6224))))) {
    call(m, "0:7d8f", 0, 0);
    call(m, "0:cff8", 0x1018, 4, 0);
  } else {
    call(m, "0:cff8", 0x1027, 4, 0);
  }
}

// 0:8bc4 cubEvent85(): room 0x85 password terminal; sets DS:3c5 and dims the palette.
export function cubEvent85(m: Memory): void {
  if (m.u8(0x3c5) !== 0) return;
  if (!prompt(m, 0x1041)) return;
  if (nameMatches(m, INPUT, 0x1067)) {
    m.set8(0x3c5, 1);
    cubFade(m, 0xfffe);
    call(m, "0:cff8", 0x1071, 4, 0);
  } else {
    call(m, "0:cff8", 0x10ad, 4, 0);
  }
}

// 0:8896 cubTerminal(): kind-6 terminal used by the player: room script or full-screen text page.
export function cubTerminal(m: Memory): void {
  const room = m.u8(SCENE);
  if (room === 0x16) return cubEvent16(m);
  if (room === 0x51) return cubEvent51(m);
  if (room === 0x85) return cubEvent85(m);
  const saved282b = m.u16(0x282b);
  m.set16(0x282b, m.u16(0x2829));
  m.set16(0x3924, 0);
  const saved3a7e = m.u16(0x3a7e);
  m.set16(0x3a7e, m.u16(0x309e) + 1);
  const saved27cc = m.u16(0x27cc);
  m.set16(0x27cc, m.u16(0x27ca));
  if (room === 7) call(m, "0:c570", 0x1e);
  else if (room === 0x23) call(m, "0:c570", 0x1f);
  else if (room === 0x2b) call(m, "0:c570", 0x20);
  if (room !== 0x11) {
    call(m, "0:0b79");
    const ptr = (m.u16(0x196d) + m.u16(m.u16(0x196b))) & 0xffff;
    call(m, "0:c244", 0, 0, ptr, m.u16(0x196f));
    call(m, "0:3ae1", 0xa, 0);
    call(m, "0:bc9d", 1);
  }
  if (room === 7) cubEvent07(m);
  else if (room === 0x11) cubEvent11(m);
  m.set16(0x27cc, saved27cc);
  m.set16(0x282b, saved282b);
  call(m, "0:0bc6", 0, 0, m.u16(0x30be), m.u16(0x309c) + 1);
  m.set16(0x3a7e, saved3a7e);
}

// 0:87e1 cubUse(sender): player (class 0) uses the cube: terminal, or pickup obj+0x89 (counter and message).
export function cubUse(m: Memory, _sender: number): number {
  const obj = m.u16(RECEIVER);
  const playerSent = m.u8(m.u16(SENDER) + 2) === 0;
  if (m.u8(obj + 0x83) === 6 && playerSent) {
    cubTerminal(m);
    return 1;
  }
  const item = m.u8(obj + 0x89);
  if (item === 0xff || !playerSent) return 1;
  call(m, "0:cff8", m.u16(0x9bd + 2 * s8(item)), 4, 0x10);
  m.set8(obj + 3, m.u8(ROUND));
  playSound(m, 0x1d7e);
  const counter = [0, 0x3365, 0x336b, 0x336d, 0x336c, 0x336e, 0x3362][s8(item)];
  if (counter !== undefined && counter) m.set8(counter, m.u8(counter) + 1);
  return 1;
}

// 0:86fc cubOpen(sender): open a closed (state 1) kind-1 cube hit by class 0x11 or a class listed at DS:9b8.
// Returns the AX the original leaves (msg, callee result).
export function cubOpen(m: Memory, _sender: number): number {
  let bx = m.u16(RECEIVER);
  if (m.u8(bx + 0x83) !== 1 || m.u8(bx + 0x84) !== 1) return 6;
  bx = m.u16(SENDER);
  if (m.u8(bx + 2) !== 0x11) {
    const r = call(m, "0:5bd0", s8(m.u8(bx + 2)) & 0xffff, 0x9b8) & 0xffff;
    if (!r) return r;
    if (m.u8(m.u16(SENDER) + 0xc) !== 0) return r;
  }
  bx = m.u16(SENDER);
  if (m.u8(bx + 2) === 0x11 && m.u8(bx + 0x86) !== 0x13) m.set8(bx + 0x3b, 0);
  const bp = m.push(0xe) + 0xe;
  m.set16(bp - 0xe, m.u16(RECEIVER));
  m.set16(bp - 0xc, bx);
  call(m, "0:2c71", 9, bp - 0xe);
  call(m, "0:1de6", 0, 6);
  const r = call(m, "0:42bd", m.u16(RECEIVER), 0, 0, 0);
  const obj = m.u16(RECEIVER);
  m.set8(obj + 3, 0);
  m.set8(obj + 0x84, 2);
  m.pop(0xe);
  return r;
}

// 0:879c cubHit(sender): classes 0x13/0x14/0x15/0x0b knock the cube (0x14 not when obj+0x87).
// Returns the AX the original leaves (sender class or callee result).
export function cubHit(m: Memory, _sender: number): number {
  const cls = m.u8(m.u16(SENDER) + 2);
  const obj = m.u16(RECEIVER);
  if (m.u8(obj + 0x87) !== 0 && cls === 0x14) return cls;
  if (cls === 0x13 || cls === 0x14 || cls === 0x15 || cls === 0xb) return call(m, "0:42bd", obj, 1, 0, 0);
  return cls;
}

// 0:869b cubMessage(msg, arg): message dispatcher.
export function cubMessage(m: Memory, msg: number, arg: number): number {
  switch (s8(msg)) {
    case 0: return cubUse(m, arg);
    case 6: return cubOpen(m, arg);
    case 8: return call(m, "0:7145", arg);
    case 9: return cubHit(m, arg);
    default: return 1;
  }
}

// 0:8c42 cubPostUpdate(): shared animation post-update.
export function cubPostUpdate(m: Memory): void {
  call(m, "12cc:0cd2");
}

// 0:8c48 cubDraw(): draw DS:3360.
export function cubDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

// 0:8c57 cubInit(record, object): kind/state from record byte 3, pickup id, room-7 variants by map position.
export function cubInit(m: Memory, record: number, obj: number): void {
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  const kind = b & 7;
  m.set8(obj + 0x83, kind);
  if (kind === 6) {
    m.set8(obj + 0xc, 9);
    cubFade(m, (-s8(m.u8(0x3c5)) << 1) & 0xffff);
  }
  const state = (s8(m.u8(RECORD_BYTE)) >> 5) & 7;
  m.set8(obj + 0x84, state);
  if (kind === 1 && (state === 1 || state === 2)) {
    m.set8(obj + 0x18, 1);
    m.set8(obj + 6, random(m, 6));
    m.set8(obj + 0x82, 1);
  }
  m.set8(obj + 0x89, 0xff);
  if (kind === 0 && state === 0) {
    const pick = namePick(m, m.u8(SCENE) + 1) & 0xff;
    if (pick) m.set8(obj + 0x89, pick);
  }
  if (m.u8(SCENE) !== 7) return;
  const bp = m.push(8) + 8;
  call(m, "0:cbba", bp - 5, bp - 7);
  if (m.u16(bp - 5) === 0xc && s16(m.u16(bp - 7)) > 0xf) m.set8(obj + 0x88, 1);
  call(m, "0:cbba", bp - 5, bp - 7);
  const x = m.u16(bp - 5);
  const y = s16(m.u16(bp - 7));
  if ((x === 0xc && y >= 7 && y < 0xf) || (x === 0xa && y >= 3 && y < 0xf)) m.set8(obj + 0x88, 2);
  m.pop(8);
}

// 0:8d63 cubSave(object, record): write kind/state back to record byte 3 (state 7 resets unless obj+0x87).
export function cubSave(m: Memory, obj: number, record: number): void {
  if (m.u8(obj + 0x87) === 0 && m.u8(obj + 0x84) === 7) m.set8(obj + 0x84, 0);
  m.set8(record + 3, (s8(m.u8(obj + 0x84)) << 5) | s8(m.u8(obj + 0x83)));
  call(m, "0:4642", obj, record);
}

register("0:85b0", cubFade);
register("0:8515", cubCountdown);
register("0:867c", isIdleClass2);
register("0:8667", noIdleClass2);
register("0:8629", cubStartCountdown);
register("0:8484", cubUpdate);
register("0:8a0e", cubEvent07);
register("0:8a33", cubEvent11);
register("0:8a7c", cubEvent16);
register("0:8b49", cubEvent51);
register("0:8bc4", cubEvent85);
register("0:8896", cubTerminal);
register("0:87e1", cubUse);
register("0:86fc", cubOpen);
register("0:879c", cubHit);
register("0:869b", cubMessage);
register("0:8c42", cubPostUpdate);
register("0:8c48", cubDraw);
register("0:8c57", cubInit);
register("0:8d63", cubSave);
