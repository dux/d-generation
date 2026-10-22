import type { FrameInput } from "./model.ts";

// Keyboard and joystick state of the input handler h0:12f2c/h0:130a4, the pending-key queue h0:14ad0/14b0c/14b1e,
// the VBlank pad reader h0:14b80 and the button reader h0:14c80.
export interface InputState {
  // g:de6a: 50-word ring, read index g:46d6, write index g:46d7.
  queue: number[];
  head: number;
  tail: number;
  // g:ddb2: held direction bits (0x01 up, 0x02 up-right, ... 0x80 up-left).
  held: number;
  // g:42f6..g:4304: LShift, RShift, LAlt, RAlt, LAmiga, RAmiga, Ctrl, Caps Lock (raw codes 0x60..0x67).
  modifiers: number[];
  // g:4314: Alt-numpad accumulator; g:3ff4: text entry (direction keys also type).
  altNumber: number;
  textEntry: number;
  // ReadJoyPort(1) word; g:de60 last pad direction index; g:de62 last word (button edges); g:46d9 rotated pad.
  joy: number;
  padDirection: number;
  padPrevious: number;
  padRotated: number;
  // g:46d8: the CD32 on-screen keyboard holds the pad reader off while set.
  padBusy: number;
  // g:6090 / g:6091: BLUE / RED state at the previous h0:14c80 read.
  buttons: number[];
}

export function createInputState(): InputState {
  return {
    queue: Array<number>(50).fill(0), head: 0, tail: 0, held: 0, modifiers: Array<number>(8).fill(0),
    altNumber: 0, textEntry: 0, joy: 0x10000000, padDirection: 0, padPrevious: 0, padRotated: 0, padBusy: 0, buttons: [0, 0],
  };
}

// h0:130d6: raw code -> g:ddb2 bit (I O P / J L / N M , keypad 7 8 9 4 6 1 2 3 and the cursor keys).
const DIRECTION_BITS = new Map([
  [0x17, 0x80], [0x18, 0x01], [0x19, 0x02], [0x1d, 0x20], [0x1e, 0x10], [0x1f, 0x08], [0x26, 0x40], [0x28, 0x04],
  [0x2d, 0x40], [0x2f, 0x04], [0x36, 0x20], [0x37, 0x10], [0x38, 0x08], [0x3d, 0x80], [0x3e, 0x01], [0x3f, 0x02],
  [0x4c, 0x01], [0x4d, 0x10], [0x4e, 0x04], [0x4f, 0x40],
]);

// g:3ff6: [plain, shift, ctrl, alt] translated words per raw code 0x00..0x5f (0 queues nothing).
const KEY_TABLE: readonly (readonly [number, number, number, number])[] = [
  [0x27, 0x7e, 0, 0], [0x31, 0x21, 0, 0x178], [0x32, 0x22, 0, 0x179], [0x33, 0xffa3, 0, 0x17a],
  [0x34, 0x24, 0, 0x17b], [0x35, 0x25, 0, 0x17c], [0x36, 0x5e, 0, 0x17d], [0x37, 0x26, 0, 0x17e],
  [0x38, 0x2a, 0, 0x17f], [0x39, 0x28, 0, 0x180], [0x30, 0x29, 0, 0x181], [0x2d, 0x5f, 0, 0x182],
  [0x3d, 0x2b, 0, 0x183], [0x5c, 0x7c, 0, 0], [0, 0, 0, 0], [0xc2, 0, 0, 0],
  [0x71, 0x51, 0x11, 0x90], [0x77, 0x57, 0x17, 0x91], [0x65, 0x45, 0x05, 0x92], [0x72, 0x52, 0x12, 0x93],
  [0x74, 0x54, 0x14, 0x94], [0x79, 0x59, 0x19, 0x85], [0x75, 0x55, 0x15, 0x86], [0x69, 0x49, 0x0a, 0x97],
  [0x6f, 0x4f, 0x0f, 0x98], [0x70, 0x50, 0x0f, 0x99], [0x5b, 0x7b, 0, 0], [0x5d, 0x7d, 0, 0],
  [0, 0, 0, 0], [0xbf, 0, 0, 0x14f], [0xc0, 0, 0, 0x150], [0xc1, 0, 0, 0x151],
  [0x61, 0x41, 0x01, 0x9e], [0x73, 0x53, 0x13, 0x9f], [0x64, 0x44, 0x04, 0xa0], [0x66, 0x46, 0x06, 0x91],
  [0x67, 0x47, 0x07, 0x92], [0x68, 0x48, 0x08, 0xa3], [0x6a, 0x4a, 0x0a, 0xa4], [0x6b, 0x4b, 0x0b, 0xa5],
  [0x6c, 0x4c, 0x0c, 0x96], [0x3b, 0x3a, 0, 0], [0x23, 0x40, 0, 0], [0, 0, 0, 0],
  [0, 0, 0, 0], [0xbb, 0, 0, 0x14b], [0, 0, 0, 0x14c], [0xbd, 0, 0, 0],
  [0, 0, 0, 0], [0x7a, 0x5a, 0x1a, 0xac], [0x78, 0x58, 0x18, 0xad], [0x63, 0x43, 0x03, 0xae],
  [0x76, 0x56, 0x16, 0xaf], [0x62, 0x42, 0x02, 0xb0], [0x6e, 0x4e, 0x0e, 0xb1], [0x6d, 0x4d, 0x0d, 0xa2],
  [0x2c, 0x3c, 0, 0], [0x2e, 0x3e, 0, 0], [0x2f, 0x3f, 0, 0], [0, 0, 0, 0],
  [0xc3, 0, 0, 0], [0xb7, 0, 0, 0], [0xb8, 0, 0, 0], [0xb9, 0, 0, 0],
  [0x20, 0x20, 0x20, 0], [0x08, 0x08, 0, 0], [0x09, 0x09, 0, 0], [0x0d, 0x0d, 0x0d, 0],
  [0x0d, 0x0d, 0x0d, 0], [0x1b, 0x1b, 0x1b, 0x1b], [0x08, 0, 0, 0], [0, 0, 0, 0],
  [0, 0, 0, 0], [0, 0, 0, 0], [0x2d, 0, 0, 0], [0, 0, 0, 0],
  [0xb8, 0xb8, 0xb8, 0], [0xc0, 0xc0, 0xc0, 0], [0xbd, 0xbd, 0xbd, 0], [0xbb, 0xbb, 0xbb, 0],
  [0x13b, 0x13b, 0x13b, 0], [0x13c, 0x13c, 0x13c, 0], [0x13d, 0x13d, 0x13d, 0], [0x13e, 0x13e, 0x13e, 0],
  [0x13f, 0x13f, 0x13f, 0], [0x140, 0x140, 0x140, 0], [0x141, 0x141, 0x141, 0], [0x142, 0x142, 0x142, 0],
  [0x143, 0x143, 0x143, 0], [0x144, 0x144, 0x144, 0], [0x28, 0, 0, 0], [0x29, 0, 0, 0],
  [0x2f, 0, 0, 0], [0x2a, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
];
// SAS/C ctype g:6249 at run time: words the Caps Lock test turns upper case (it reads past the table for 0x100+).
const CAPS_TO_UPPER = new Set([...Array.from({ length: 26 }, (_, i) => 0x61 + i), 0xffa3, 0x14c, 0x14f, 0x178]);
const ALT_DIGITS = [4, 5, -1, -1, 1, 2, 3]; // h0:132e6, words 0x14b..0x151
const SHIFT_L = 0, SHIFT_R = 1, ALT_L = 2, ALT_R = 3, CTRL = 6, CAPS = 7;
const MODIFIER_INDEX = [SHIFT_L, SHIFT_R, CAPS, CTRL, ALT_L, ALT_R, 4, 5]; // raw 0x60..0x67
// h4:8 / h4:18: pad direction index (1 right, 2 down, 4 left, 8 up) -> g:ddb2.
const PAD_DIRECTIONS = [0x00, 0x04, 0x10, 0x08, 0x40, 0x00, 0x20, 0x00, 0x01, 0x02, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00];
const PAD_DIRECTIONS_ROTATED = [0x00, 0x08, 0x20, 0x10, 0x80, 0x00, 0x40, 0x00, 0x02, 0x04, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00];
// h0:14b80: PLAY, YELLOW, GREEN, FORWARD, REVERSE rising edges push these codes.
const PAD_KEYS: readonly (readonly [number, number])[] = [[17, 0x1b], [21, 0x53], [20, 0x0d], [19, 0x55], [18, 0x02]];
const GAME_CONTROLLER = 0x10000000;

// h0:14ad0 push(v): 0 is ignored, a full ring drops the code.
export function pushKey(input: InputState, value: number): void {
  const next = input.tail + 1 > 0x31 ? 0 : input.tail + 1;
  if ((value & 0xffff) === 0 || next === input.head) return;
  input.queue[input.tail] = value & 0xffff;
  input.tail = next;
}

// h0:14b0c pending().
export function pendingKey(input: InputState): boolean {
  return input.tail !== input.head;
}

// h0:14b1e pop(): the original spins until interrupts fill the queue; a synchronous port cannot, so callers
// check pendingKey first (h0:31c0's cheat reads are the exception and fail loudly).
export function consumeKey(input: InputState): number {
  if (!pendingKey(input)) throw new Error("AGA key read h0:14b1e on an empty queue would block until the next key");
  const value = input.queue[input.head]!;
  input.head = input.head + 1 > 0x31 ? 0 : input.head + 1;
  return value;
}

// h0:130a4 (DOS 0:c9c5) translateRawKey(code): bit 7 = release; direction keys only edit g:ddb2 outside text entry.
export function translateRawKey(input: InputState, raw: number): number {
  const down = raw < 0x80;
  const code = raw & 0x7f;
  const bit = DIRECTION_BITS.get(code);
  if (bit) {
    input.held = down ? input.held | bit : input.held & ~bit & 0xff;
    if (!input.textEntry) return 0;
  }
  if (code >= 0x60) {
    if (code >= 0x68) return 0;
    const index = MODIFIER_INDEX[code - 0x60]!;
    input.modifiers[index] = down ? 1 : 0;
    if ((index === ALT_L || index === ALT_R) && !down && input.altNumber) {
      const value = input.altNumber;
      input.altNumber = 0;
      return value;
    }
    return 0;
  }
  if (!down) return 0;
  const row = KEY_TABLE[code]!, m = input.modifiers;
  const alt = m[ALT_L] || m[ALT_R];
  let value = m[CTRL] ? row[2] : m[SHIFT_L] || m[SHIFT_R] ? row[1] : alt ? row[3] : row[0];
  if (m[CAPS] && CAPS_TO_UPPER.has(value)) value = (value - 0x20) & 0xffff;
  if (alt && value > 0x14a && value < 0x152) {
    input.altNumber = (input.altNumber * 10) & 0xffff;
    const digit = ALT_DIGITS[value - 0x14b]!;
    if (digit < 0) return value;
    input.altNumber = (input.altNumber + digit) & 0xffff;
    return 0;
  }
  return value;
}

// Host or timeline input: raw key transitions through h0:12f2c (one event each), and the joystick word.
export function deliverInput(input: InputState, frame: FrameInput): void {
  for (const event of frame.rawKeyEvents ?? []) pushKey(input, translateRawKey(input, event.key | (event.down ? 0 : 0x80)));
  if (frame.joy !== undefined) input.joy = frame.joy >>> 0;
}

// h0:14b80: the VBlank pad reader (after the timer interrupt in h10:212): button edges queue codes, a changed pad
// direction overwrites the held direction byte.
export function padVblank(input: InputState): void {
  const j = input.joy >>> 0;
  if (input.padBusy) return;
  let direction = 0;
  if ((j & 0xf0000000) >>> 0 === GAME_CONTROLLER) {
    direction = (j & 1 ? 1 : 0) | (j & 2 ? 4 : 0) | (j & 4 ? 2 : 0) | (j & 8 ? 8 : 0);
    for (const [bit, code] of PAD_KEYS) if ((j >>> bit) & 1 && !((input.padPrevious >>> bit) & 1)) pushKey(input, code);
  }
  if (direction !== input.padDirection) {
    input.padDirection = direction;
    input.held = (input.padRotated ? PAD_DIRECTIONS_ROTATED : PAD_DIRECTIONS)[direction]!;
  }
  input.padPrevious = j;
}

// h0:14c80 (via h0:b434) readButton(which): 0 = BLUE (bit 23), 1 = RED (bit 22) of port 1; 1 held, 2 first
// press, 3 release, 4 idle. Anything but a CD32 game controller reads idle.
export function readJoyButton(input: InputState, which: number): number {
  const j = input.joy >>> 0;
  if ((j & 0xf0000000) >>> 0 !== GAME_CONTROLLER) return 4;
  const now = (j >>> (which ? 22 : 23)) & 1;
  const previous = input.buttons[which ? 1 : 0]!;
  input.buttons[which ? 1 : 0] = now;
  return now ? (previous ? 1 : 2) : previous ? 3 : 4;
}

// h0:e48c: the lowest held direction bit is the direction (-1 when none).
export function heldDirection(input: InputState): number {
  return input.held ? 31 - Math.clz32(input.held & -input.held) : -1;
}
