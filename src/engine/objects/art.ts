import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, FRAME_TICKS, PLAYER, RECEIVER, RECORD_BYTE, ROUND, SENDER, signalGroup, TEXT, UPDATE_OBJECT } from "../props/common.ts";

// Class 11, ART: artefacts and devices picked up or used by the player. +0x85 = kind (2 bomb pack, 4 bomb map,
// 5 group sensor, 7 bomb), +0x86 = parameter (floor / count / sensor direction), +0x87 = sensor fired,
// +0x89 word = bomb fuse, +0x8b word = tick sound timer.

const BOMBS_FOUND = 0x3367;
const BOMBS = 0x3365;
const BLAST_SOURCE = 0x61c2; // message pair {bomb, victim} of the bomb blast
const BLAST_VICTIM = 0x61c4;
const FLASH_TARGET = 0x5f6c;
const ART_LIST = 0x8f4; // classes that can take an artefact

// 0:6017 markPlacedBombs(): stamp every bomb (class 11 kind 7) in the room as used up.
export function markPlacedBombs(m: Memory): number {
  return call(m, "0:1811", 0x6020);
}

// 0:6020 for-each callback of markPlacedBombs.
export function markPlacedBombVisit(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 0xb && m.u8(obj + 0x85) === 7) m.set8(obj + 3, m.u8(ROUND));
  return 0;
}

// 0:7c28 update(): kind 5 senses, kind 7 burns its fuse.
export function artUpdate(m: Memory): void {
  if (m.u8(m.u16(UPDATE_OBJECT) + 0x85) === 5) artSense(m);
  if (m.u8(m.u16(UPDATE_OBJECT) + 0x85) === 7) artFuse(m);
}

// 0:7c45 artFuse(): tick sound every 0x300 in the last 0x3200; when the fuse runs out the bomb explodes (0:42bd),
// hits everything around (0:7cba) and flashes the screen.
export function artFuse(m: Memory): void {
  let cur = m.u16(UPDATE_OBJECT);
  if (m.u16(cur + 0x89) < 0x3200) {
    const t = (m.u16(cur + 0x8b) - m.u16(FRAME_TICKS)) & 0xffff;
    m.set16(cur + 0x8b, t);
    if (!t || t & 0x8000) {
      m.set16(cur + 0x8b, t + 0x300);
      call(m, "0:b5c3", 0x1d96);
    }
  }
  cur = m.u16(UPDATE_OBJECT);
  const fuse = (m.u16(cur + 0x89) - m.u16(FRAME_TICKS)) & 0xffff;
  m.set16(cur + 0x89, fuse);
  if (fuse <= 0xfa00) return;
  call(m, "0:42bd", cur, 2, 0, 0);
  artBlast(m, m.u16(UPDATE_OBJECT));
  m.set16(FLASH_TARGET, 0x8de);
  call(m, "0:1de6", 0, 0xf);
  call(m, "0:b5c3", 0x1a76);
}

// 0:7cba artBlast(bomb): message 9 from the bomb to every door within 0xf and every object within 0x3c.
export function artBlast(m: Memory, bomb: number): void {
  m.set16(BLAST_SOURCE, bomb);
  call(m, "0:1811", 0x7ccf);
}

// 0:7ccf for-each callback of artBlast.
export function artBlastVisit(m: Memory, obj: number): number {
  if (m.u8(obj + 2) === 2) {
    if (!call(m, "0:414b", obj, 0xf)) return 0;
  } else if ((call(m, "0:4027", obj, 0x3c, 4) & 0xffff) === 0xffff) {
    return 0;
  }
  m.set16(BLAST_VICTIM, obj);
  call(m, "0:2c71", 9, BLAST_SOURCE);
  return 0;
}

// 0:7d27 artSense(): a sensor fires once when the player comes within 0x3c in its direction: it opens group 0
// (0:7d8f) with a sound; it re-arms when the player leaves.
export function artSense(m: Memory): void {
  if (!m.u16(PLAYER)) return;
  const dir = (m.s8(m.u16(UPDATE_OBJECT) + 0x86) << 3) & 0xffff;
  if ((call(m, "0:4043", m.u16(PLAYER), 0x3c, dir, 4) & 0xffff) === 0xffff) {
    m.set8(m.u16(UPDATE_OBJECT) + 0x87, 0);
    return;
  }
  if (!m.u8(m.u16(UPDATE_OBJECT) + 0x87) && signalGroup(m, 0, 0xffff)) call(m, "0:b5c3", 0x1d9e);
  m.set8(m.u16(UPDATE_OBJECT) + 0x87, 1);
}

// 0:7df8 message(kind, msg): 6 = taken; always 1 otherwise.
export function artMessage(m: Memory, kind: number, msg: number): number {
  return (kind & 0xff) === 6 ? artTaken(m, msg) : 1;
}

// 0:7e44 artTaken(msg): a taker of list DS:8f4 uses the artefact by kind (2 bombs, 4 map, 5 sensor); returns 0.
export function artTaken(m: Memory, _msg: number): number {
  if (!call(m, "0:5bd0", m.s8(m.u16(SENDER) + 2) & 0xffff, ART_LIST)) return 0;
  switch (m.s8(m.u16(RECEIVER) + 0x85)) {
    case 2:
      artBombPack(m);
      break;
    case 4:
      artBombMap(m);
      break;
    case 5:
      artSensorTaken(m);
      break;
  }
  return 0;
}

// 0:7e9c artBombMap(): the player learns the bombs of floor +0x86 (DS:3367) and is told so.
export function artBombMap(m: Memory): void {
  if (m.u8(m.u16(SENDER) + 2) !== 0) return;
  const floor = m.s8(m.u16(RECEIVER) + 0x86);
  if (floor >= m.s8(BOMBS_FOUND)) m.set8(BOMBS_FOUND, floor + 1);
  call(m, "0:ef18", TEXT, 0x8f8, (floor + 1) & 0xffff);
  call(m, "0:cff8", TEXT, 4, 0x10);
  call(m, "0:b5c3", 0x1dbe);
  m.set8(m.u16(RECEIVER) + 3, m.u8(ROUND));
}

// 0:7efe artSensorTaken(): a sensor is used up when touched by class 0x13/0x14, with a message.
export function artSensorTaken(m: Memory): void {
  const cls = m.s8(m.u16(SENDER) + 2);
  if (cls !== 0x14 && cls !== 0x13) return;
  m.set8(m.u16(RECEIVER) + 3, m.u8(ROUND));
  call(m, "0:cff8", 0x91e, 3, 0x10);
}

// 0:7f39 artBombPack(): the player gets +0x86 + 1 bombs (DS:3365) and is told so.
export function artBombPack(m: Memory): void {
  if (m.u8(m.u16(SENDER) + 2) !== 0) return;
  const r = m.u16(RECEIVER);
  const n = (m.u8(r + 0x86) + 1) & 0xff;
  m.set8(BOMBS, m.u8(BOMBS) + n);
  m.set8(r + 3, m.u8(ROUND));
  call(m, "0:ef18", TEXT, 0x944, ((n << 24) >> 24) & 0xffff, n === 1 ? 0x965 : 0x967);
  call(m, "0:cff8", TEXT, 3, 0x10);
  call(m, "0:b5c3", 0x1dbe);
}

// 0:7f9f post(): 12cc:0aa0, with a tick sound when it reports a change.
export function artPost(m: Memory): void {
  if (call(m, "12cc:0aa0")) call(m, "0:b5c3", 0x1d96);
}

// 0:7fb1 draw(): parts 1 and 0.
export function artDraw(m: Memory): void {
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 1);
  call(m, "0:3f81", m.u16(DRAW_OBJECT), 0);
}

// 0:7fce init(record, object): record byte 3 = kind | parameter << 3.
export function artInit(m: Memory, record: number, obj: number): void {
  const b = m.u8(record + 3);
  m.set8(RECORD_BYTE, b);
  const kind = b & 7;
  m.set8(obj + 0x85, kind);
  m.set8(obj + 0x86, (((b << 24) >> 24) >> 3) & 7);
  if (kind === 3 || kind === 5) {
    m.set8(obj + 0xc, 9);
  } else if (kind === 6) {
    m.set8(obj + 0xc, 0x16);
    m.set8(obj + 0x82, 1);
  } else if (kind === 7) {
    m.set16(obj + 0x89, 0xf000);
  } else if (kind === 1) {
    m.set8(obj + 0xc, 0x10);
  } else {
    m.set8(obj + 6, call(m, "fff:1176", 3));
  }
  m.set8(obj + 0x18, 1);
}

// 0:8058 save(object, record): record byte 3 as read by init.
export function artSave(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, (m.s8(obj + 0x86) << 3) | m.s8(obj + 0x85));
  call(m, "0:4642", obj, record);
}

register("0:6017", markPlacedBombs);
register("0:6020", markPlacedBombVisit);
register("0:7c28", artUpdate);
register("0:7c45", artFuse);
register("0:7cba", artBlast);
register("0:7ccf", artBlastVisit);
register("0:7d27", artSense);
register("0:7df8", artMessage);
register("0:7e44", artTaken);
register("0:7e9c", artBombMap);
register("0:7efe", artSensorTaken);
register("0:7f39", artBombPack);
register("0:7f9f", artPost);
register("0:7fb1", artDraw);
register("0:7fce", artInit);
register("0:8058", artSave);
