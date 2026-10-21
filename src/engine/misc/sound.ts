import { call, register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { memset, timerHookOff, timerHookOn, timerSetChain, timerSetHook } from "../runtime.ts";

// PC speaker: a ring of 4-byte notes { divisor, ticks } at DS:97ec..9978 played by the timer chain (0:b772).
// A sound is a list of notes ending with a zero divisor.

export const SOUND_OFF = 0x19ec; // sound disabled
export const SPEAKER_ON = 0x19ea;
export const QUEUE_HEAD = 0x97e4; // write pointer
export const QUEUE_TAIL = 0x97e6; // read pointer
export const QUEUE_LAST = 0x97e8;
export const QUEUE_FIRST = 0x97ea;
// Sounds started this frame (20 words, zero-terminated).
export const PLAYED = 0x97bc;

const cli = (m: Memory) => call(m, "14c8:01e5");
const sti = (m: Memory) => call(m, "14c8:01e7");
const inportb = (m: Memory, port: number) => call(m, "0:ef5b", port);
const outportb = (m: Memory, port: number, value: number) => call(m, "0:ef70", port, value);

// 0:b5c3 playSound(sound): queues the sound once per frame; returns 1 if the queue overflowed.
export function playSound(m: Memory, sound: number): number {
  let full = 0;
  if (m.u16(SOUND_OFF) !== 0 || markPlayed(m, sound) !== 0) return 0;
  if (m.u8(0x3375) !== 0 && sound !== 0x1c66) return 0;
  while (m.u16(sound) !== 0) {
    const note = sound;
    sound = (sound + 4) & 0xffff;
    if (queueNote(m, note) !== 0) full = 1;
  }
  return full;
}

// 0:b618 markPlayed(sound): 1 if already in the played list, else adds it (when room) and returns 0.
export function markPlayed(m: Memory, sound: number): number {
  let i = 0;
  for (; i < 20 && m.u16(PLAYED + i * 2) !== 0; i++) {
    if (m.u16(PLAYED + i * 2) === sound) return 1;
  }
  if (i < 20) m.set16(PLAYED + i * 2, sound);
  return 0;
}

// 0:b662 clearPlayed()
export function clearPlayed(m: Memory): void {
  memset(m, PLAYED, 0, 0x28);
}

// 0:b675 queueNote(note): 1 when the queue is full; starts the speaker if idle.
export function queueNote(m: Memory, note: number): number {
  let full: number;
  cli(m);
  if (queueNext(m, m.u16(QUEUE_HEAD)) === m.u16(QUEUE_TAIL)) {
    full = 1;
  } else {
    const head = m.u16(QUEUE_HEAD);
    m.set16(head, m.u16(note));
    m.set16(head + 2, m.u16(note + 2));
    m.set16(QUEUE_HEAD, queueNext(m, head));
    full = 0;
  }
  if (m.u16(SPEAKER_ON) === 0) speakerStart(m);
  sti(m);
  return full;
}

// 0:b6cc dequeueNote(dst): copies the next note to dst and returns 0, or 1 when empty.
export function dequeueNote(m: Memory, dst: number): number {
  if (m.u16(QUEUE_HEAD) === m.u16(QUEUE_TAIL)) return 1;
  const tail = m.u16(QUEUE_TAIL);
  m.set16(dst, m.u16(tail));
  m.set16(dst + 2, m.u16(tail + 2));
  m.set16(QUEUE_TAIL, queueNext(m, tail));
  return 0;
}

// 0:b700 queueNext(p): next ring slot.
export function queueNext(m: Memory, p: number): number {
  p = (p + 4) & 0xffff;
  return p > m.u16(QUEUE_LAST) ? m.u16(QUEUE_FIRST) : p;
}

// 0:b71d speakerStart(): hooks the timer, plays the first note and gates the speaker on.
export function speakerStart(m: Memory): void {
  m.set16(SPEAKER_ON, 1);
  timerSetHook(m, 5);
  timerHookOn(m);
  speakerTick(m);
  outportb(m, 0x61, inportb(m, 0x61) | 3);
}

// 0:b748 speakerStop()
export function speakerStop(m: Memory): void {
  cli(m);
  timerHookOff(m);
  outportb(m, 0x61, inportb(m, 0x61) & 0xfc);
  m.set16(SPEAKER_ON, 0);
  sti(m);
}

// 0:b772 speakerTick(): timer chain; programs PIT channel 2 with the next note, or stops when empty.
export function speakerTick(m: Memory): void {
  const note = m.push(4);
  if (dequeueNote(m, note) !== 0) {
    speakerStop(m);
  } else {
    let divisor = m.u16(note);
    if (m.u8(0x3370) !== 0) divisor = (divisor << 1) & 0xffff;
    outportb(m, 0x43, 0xb6);
    outportb(m, 0x42, divisor & 0xff);
    outportb(m, 0x42, divisor >> 8);
    timerSetHook(m, m.u16(note + 2));
  }
  m.pop(4);
}

// 0:b7d4 soundInit()
export function soundInit(m: Memory): void {
  speakerStop(m);
  cli(m);
  m.set16(QUEUE_HEAD, 0x97ec);
  m.set16(QUEUE_TAIL, 0x97ec);
  m.set16(QUEUE_FIRST, 0x97ec);
  m.set16(QUEUE_LAST, 0x9978);
  sti(m);
  clearPlayed(m);
  timerSetChain(m, 0xb772);
}

register("0:b5c3", playSound);
register("0:b618", markPlayed);
register("0:b662", clearPlayed);
register("0:b675", queueNote);
register("0:b6cc", dequeueNote);
register("0:b700", queueNext);
register("0:b71d", speakerStart);
register("0:b748", speakerStop);
register("0:b772", speakerTick);
register("0:b7d4", soundInit);
