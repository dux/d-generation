import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, RECEIVER, RECORD_BYTE, SCENE, SENDER, TEXT, UPDATE_OBJECT } from "../props/common.ts";

// Class 4, SWITCH: wall switch for the doors and turrets (class 2, 10) of a group. +0x85 = group (7 = hidden),
// +0x88 = action sent (1 toggle, 0 close, -1 open), +0x89 = second group, or with +0x8f the floor whose bomb
// count it checks, +0x8a/+0x8b = overlap flag and object, +0x8d word = cooldown, +0x8f = one-shot / bomb switch.

const SWITCH_HIT = 0x61c0;
const BOMBS_FOUND = 0x3367;
const SWITCH_LIST = 0x813; // classes that can press a switch

// 0:7741 update()
export function switchUpdate(m: Memory): void {
  switchCooldown(m);
  switchOverlap(m);
}

// 0:7748 switchCooldown(): count the cooldown (+0x8d) down to 0.
export function switchCooldown(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  const t = (m.u16(cur + 0x8d) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(cur + 0x8d, t & 0x8000 ? 0 : t);
}

// 0:7764 switchOverlap(): clear +0x8a once the switch no longer overlaps the object in +0x8b (fff:27b4).
export function switchOverlap(m: Memory): void {
  const cur = m.u16(UPDATE_OBJECT);
  if (!m.u8(cur + 0x8a)) return;
  if (!call(m, "fff:27b4", cur, m.u16(cur + 0x8b))) m.set8(m.u16(UPDATE_OBJECT) + 0x8a, 0);
}

// 0:778a message(kind, msg): 0 (touched) and 6 press the switch.
export function switchMessage(m: Memory, kind: number, msg: number): number {
  const k = kind & 0xff;
  return k === 0 || k === 6 ? switchPress(m, msg) : 0;
}

// 0:77dd switchPress(msg): an overlapping presser of list DS:813 facing the switch, off cooldown, signals the
// group (0:7920). Bomb switches only react to the player and need the floor's bombs (DS:3367); the switch of
// scene 0x88 ends the game. Returns -1.
export function switchPress(m: Memory, _msg: number): number {
  if (!call(m, "fff:27b4", m.u16(SENDER), m.u16(RECEIVER))) return 0xffff;
  const cls = m.s8(m.u16(SENDER) + 2);
  if (!call(m, "0:5bd0", cls & 0xffff, SWITCH_LIST)) return 0xffff;
  if (m.u16(m.u16(RECEIVER) + 0x8d)) return 0xffff;
  if (!switchFacing(m)) return 0xffff;
  if (cls !== 0x13 && cls !== 0x14) m.set16(m.u16(RECEIVER) + 0x8d, 0xf00);
  const r = m.u16(RECEIVER);
  if (!m.u8(r + 0x8f)) {
    if (signalSwitchGroup(m)) {
      call(m, "0:b5c3", 0x1d5e);
      m.set8(m.u16(RECEIVER) + 0x87, 1);
    }
    return 0xffff;
  }
  if (m.u8(m.u16(SENDER) + 2) !== 0) return 0xffff;
  if (m.s8(r + 0x89) >= m.s8(BOMBS_FOUND)) {
    call(m, "0:ef18", TEXT, 0x890, (m.s8(m.u16(RECEIVER) + 0x89) + 1) & 0xffff);
    call(m, "0:cff8", TEXT, 4, 0x5c);
    return 0xffff;
  }
  if (!signalSwitchGroup(m)) return 0xffff;
  if (m.u8(SCENE) === 0x88) {
    call(m, "0:b5c3", 0x1ca2);
    call(m, "0:cff8", 0x81b, 4, 4);
    m.set8(0x199a, 1);
    m.set16(0x3406, 0);
    m.set16(0x3404, 0x4100);
    m.set8(0x340a, 6);
  } else if (m.u8(SCENE) !== 0x85) {
    call(m, "0:b5c3", 0x1d5e);
    call(m, "0:cff8", 0x86b, 4, 0x10);
  }
  return 0xffff;
}

// 0:7920 signalSwitchGroup(): message 4 to every door/turret of the receiver's group(s); 1 when one reacted.
export function signalSwitchGroup(m: Memory): number {
  m.set16(SWITCH_HIT, 0);
  call(m, "0:1811", 0x7932);
  return m.u16(SWITCH_HIT);
}

// 0:7932 for-each callback of signalSwitchGroup.
export function signalSwitchVisit(m: Memory, obj: number): number {
  const sw = m.u16(RECEIVER);
  const cls = m.s8(obj + 2);
  if (cls !== 2 && cls !== 0xa) return 0;
  const group = m.s8(obj + 0x3e);
  if (group === 7) return 0;
  if (m.u8(sw + 0x8f)) {
    if (m.s8(sw + 0x85) !== group) return 0;
  } else if (m.s8(sw + 0x85) !== group && m.s8(sw + 0x89) !== group) {
    return 0;
  }
  const msg = m.push(0x12);
  m.set16(msg, sw);
  m.set16(msg + 2, obj);
  m.set8(msg + 0xd, m.u8(sw + 0x88));
  if (call(m, "0:2c71", 4, msg)) m.set16(SWITCH_HIT, 1);
  m.pop(0x12);
  return 0;
}

// 0:79c9 switchFacing(): 1 when the presser faces the switch (facing difference 5..7).
export function switchFacing(m: Memory): number {
  return ((m.s8(m.u16(SENDER) + 0x13) - m.s8(m.u16(RECEIVER) + 0x13)) & 7) >= 5 ? 1 : 0;
}

// 0:79f0 post(): 12cc:0e05.
export function switchPost(m: Memory): void {
  call(m, "12cc:0e05");
}

// 0:79f6 draw(): hidden switches (group 7) are not drawn.
export function switchDraw(m: Memory): void {
  const d = m.u16(DRAW_OBJECT);
  if (m.u8(d + 0x85) !== 7) call(m, "0:3f81", d, 0);
}

// 0:7a0d init(record, object)
export function switchInit(m: Memory, record: number, obj: number): void {
  m.set8(RECORD_BYTE, m.u8(record + 3));
  switchDecode(m, obj);
  m.set8(obj + 9, 0);
  m.set8(obj + 7, 0);
  m.set8(obj + 0xc, 0xa);
  call(m, "0:dd61", obj);
  call(m, "fff:1c3b", obj);
}

// 0:7aba switchDecode(object): record byte 3 (DS:611f) = group | group2 << 3 | action (0 toggle, 0x40 close,
// 0x80 open, 0xc0 close once); scene 0x6c uses group2 9, scene 0x85 holds a one-shot open switch.
export function switchDecode(m: Memory, obj: number): void {
  const b = m.u8(RECORD_BYTE);
  m.set8(obj + 0x85, b & 7);
  m.set8(obj + 0x89, m.u8(SCENE) === 0x6c ? 9 : (((b << 24) >> 24) >> 3) & 7);
  let action: number;
  if (m.u8(SCENE) === 0x85) {
    m.set8(obj + 0x8f, 1);
    action = 0xff;
  } else {
    switch (b & 0xc0) {
      case 0:
        action = 1;
        break;
      case 0x40:
        action = 0;
        break;
      case 0x80:
        action = 0xff;
        break;
      default:
        action = 0;
        m.set8(obj + 0x8f, 1);
    }
  }
  m.set8(obj + 0x88, action);
}

// 0:7a42 save(object, record): record byte 3 as read by switchDecode.
export function switchSave(m: Memory, obj: number, record: number): void {
  const action = m.s8(obj + 0x88);
  const bits = action === -1 ? 0x80 : action === 0 ? (m.u8(obj + 0x8f) ? 0xc0 : 0x40) : 0;
  m.set8(record + 3, bits | m.s8(obj + 0x85) | (m.s8(obj + 0x89) << 3));
  call(m, "0:4642", obj, record);
}

register("0:7741", switchUpdate);
register("0:7748", switchCooldown);
register("0:7764", switchOverlap);
register("0:778a", switchMessage);
register("0:77dd", switchPress);
register("0:7920", signalSwitchGroup);
register("0:7932", signalSwitchVisit);
register("0:79c9", switchFacing);
register("0:79f0", switchPost);
register("0:79f6", switchDraw);
register("0:7a0d", switchInit);
register("0:7aba", switchDecode);
register("0:7a42", switchSave);
