import { classInList, drawObjectPart, enter, leave, sound, writeRecord } from "../actors/helpers.ts";
import { call, register } from "../dispatch.ts";
import { nextObjectOfClass } from "../geometry/math.ts";
import { boxesOverlap } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";
import { DRAW_OBJECT, RECEIVER, RECORD_BYTE, SENDER, UPDATE_OBJECT } from "../props/common.ts";
import { random } from "../random.ts";
import { sendMessage } from "../world/objects.ts";

// Class 3, TEL.VGA: teleporter pad. +0x8e link id (pads with the same id are connected), +0x88 teleport
// animation running, +0x83 last handled frame of it, +0x84 animation period, +0x89 passenger, +0x8f its id
// word, +0x8c destination pad, +0x8b passenger still standing on the pad (no retrigger until it steps off).

const TELEPORTABLE = 0x63f; // classes that can use a pad, negative-terminated

// 0:4a69 init(record, object): record byte 3 = link id (low 2 bits kept per pad).
export function telInit(m: Memory, record: number, obj: number): void {
  const link = m.u8(record + 3);
  m.set8(RECORD_BYTE, link);
  m.set8(obj + 0x8e, link & 3);
  m.set16(obj + 0x84, 0x15e);
  m.set8(obj + 0x18, 1);
}

// 0:4a8c save(object, record): record byte 3 = link id.
export function telSave(m: Memory, obj: number, record: number): void {
  m.set8(record + 3, m.u8(obj + 0x8e));
  writeRecord(m, obj, record);
}

// 0:4aaa update().
export function telUpdate(m: Memory): void {
  telCheckPassenger(m);
  telCheckLeft(m);
  telAnimate(m);
}

// 0:4ab4 telCheckPassenger(): stop the pad when the passenger slot no longer holds the same object.
export function telCheckPassenger(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (!m.u8(obj + 0x88) && !m.u8(obj + 0x8b)) return;
  if (m.u16(m.u16(obj + 0x89)) === m.u16(obj + 0x8f)) return;
  m.set8(obj + 6, 0);
  m.set8(obj + 0x8b, 0);
  m.set8(obj + 0x88, 0);
}

// 0:4aef telAnimate(): run the events of the animation frames passed since the last update: 1 sound, 5 send the
// passenger (0:4bb0), 6 passenger visible again, 9 done.
export function telAnimate(m: Memory): void {
  let obj = m.u16(UPDATE_OBJECT);
  const passenger = m.u16(obj + 0x89);
  if (!m.u8(obj + 0x88)) return;
  if (m.u8(obj + 0x83) === m.u8(obj + 6)) return;
  for (let i = (m.u8(obj + 0x83) + 1) & 0xff; m.s8(m.u16(UPDATE_OBJECT) + 6) >= ((i << 24) >> 24); i = (i + 1) & 0xff) {
    switch ((i << 24) >> 24) {
      case 1:
        sound(m, m.u8(passenger + 2) === 0 ? 0x1afa : 0x1aa6);
        break;
      case 5:
        telSend(m);
        break;
      case 6:
        m.set8(passenger + 0x37, 0);
        break;
      case 9:
        m.set8(m.u16(UPDATE_OBJECT) + 0x88, 0);
        break;
    }
  }
  obj = m.u16(UPDATE_OBJECT);
  m.set8(obj + 0x83, m.u8(obj + 6));
}

// 0:4b8a telCheckLeft(): clear the standing flag once the passenger no longer overlaps the pad.
export function telCheckLeft(m: Memory): void {
  const obj = m.u16(UPDATE_OBJECT);
  if (!m.u8(obj + 0x8b)) return;
  if (!boxesOverlap(m, obj, m.u16(obj + 0x89))) m.set8(m.u16(UPDATE_OBJECT) + 0x8b, 0);
}

// 0:4bb0 telSend(): message 2 (teleport) to the passenger with the destination pad's position (one unit up).
// On success the destination takes the passenger as standing on it and DS:8e = 2; otherwise it stays here.
export function telSend(m: Memory): void {
  const bp = enter(m, 0x12);
  let obj = m.u16(UPDATE_OBJECT);
  const dest = m.u16(obj + 0x8c);
  const ev = bp - 0x12;
  m.set16(ev, obj);
  m.set16(ev + 2, m.u16(obj + 0x89));
  m.set16(ev + 5, m.u16(dest + 7));
  m.set16(ev + 7, m.u16(dest + 9) + 0xff00);
  if (sendMessage(m, 2, ev)) {
    m.set16(dest + 0x89, m.u16(m.u16(UPDATE_OBJECT) + 0x89));
    m.set8(dest + 0x8b, 1);
    m.set8(0x8e, 2);
  } else {
    obj = m.u16(UPDATE_OBJECT);
    m.set8(obj + 0x8b, 1);
    m.set8(m.u16(obj + 0x89) + 0x37, 0);
  }
  leave(m, 0x12);
}

// 0:4c24 telPickDestination(pad): a random other pad with the same link id, 0 if none.
export function telPickDestination(m: Memory, pad: number): number {
  const bp = enter(m, 2);
  const index = bp - 2;
  let count = 0;
  m.set8(index, 0);
  while (telNextLinked(m, pad, index)) count = (count + 1) & 0xff;
  let found = 0;
  if (count) {
    let n = (random(m, (count << 24) >> 24) << 24) >> 24;
    m.set8(index, 0);
    do {
      found = telNextLinked(m, pad, index);
      n--;
    } while (n >= 0);
  }
  leave(m, 2);
  return found;
}

// 0:4c82 telNextLinked(pad, index*): next class 3 object other than pad with the same link id, 0 at the end.
export function telNextLinked(m: Memory, pad: number, index: number): number {
  for (;;) {
    const o = nextObjectOfClass(m, 3, index);
    if (o === 0) return 0;
    if (o !== pad && m.u8(pad + 0x8e) === m.u8(o + 0x8e)) return o;
  }
}

// 0:4cc4 message(msg, arg): 6 (stepped on) starts a teleport (0:4d0c); every other message returns 0.
export function telMessage(m: Memory, msg: number, _arg: number): number {
  return ((msg << 24) >> 24) === 6 ? telStart(m) : 0;
}

// 0:4d0c telStart(): when an idle pad is stepped on by a teleportable sender, pick a destination and, if the
// sender accepts message 2 for it, start the animation on both pads. Returns 1 when started.
export function telStart(m: Memory): number {
  const bp = enter(m, 0x12);
  let result = 0;
  const self = m.u16(RECEIVER);
  if (
    !m.u8(self + 0x8b) &&
    !m.u8(self + 0x88) &&
    classInList(m, m.s8(m.u16(SENDER) + 2) & 0xffff, TELEPORTABLE)
  ) {
    const dest = telPickDestination(m, m.u16(RECEIVER));
    if (dest && !m.u8(dest + 0x88)) {
      const pad = m.u16(RECEIVER);
      m.set16(pad + 0x8c, dest);
      const ev = bp - 0x10;
      m.set16(ev, pad);
      m.set16(ev + 2, m.u16(SENDER));
      m.set16(ev + 5, m.u16(pad + 7));
      m.set16(ev + 7, m.u16(pad + 9) + 0xff00);
      if (sendMessage(m, 2, ev)) {
        const sender = m.u16(SENDER);
        m.set8(sender + 0x37, 1);
        const me = m.u16(RECEIVER);
        m.set8(me + 0x88, 1);
        m.set8(me + 0x83, 0);
        const cls = m.u8(sender + 2);
        m.set8(bp - 0x11, cls);
        m.set16(me + 0x84, cls === 0x14 || cls === 0x13 ? 0x140 : 0x1c2);
        m.set16(me + 0x89, sender);
        m.set16(dest + 0x89, sender);
        const id = m.u16(sender);
        m.set16(me + 0x8f, id);
        m.set16(dest + 0x8f, id);
        m.set8(me + 6, 0);
        result = 1;
      }
    }
  }
  leave(m, 0x12);
  return result;
}

// 0:4e0d post-update(): 12cc:1a8a.
export function telPostUpdate(m: Memory): void {
  call(m, "12cc:1a8a");
}

// 0:4e13 draw(): pad (part 0) and beam (part 1).
export function telDraw(m: Memory): void {
  drawObjectPart(m, m.u16(DRAW_OBJECT), 0);
  drawObjectPart(m, m.u16(DRAW_OBJECT), 1);
}

register("0:4a69", telInit);
register("0:4a8c", telSave);
register("0:4aaa", telUpdate);
register("0:4ab4", telCheckPassenger);
register("0:4aef", telAnimate);
register("0:4b8a", telCheckLeft);
register("0:4bb0", telSend);
register("0:4c24", telPickDestination);
register("0:4c82", telNextLinked);
register("0:4cc4", telMessage);
register("0:4d0c", telStart);
register("0:4e0d", telPostUpdate);
register("0:4e13", telDraw);
