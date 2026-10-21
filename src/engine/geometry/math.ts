import type { Memory } from "../memory.ts";
import { random } from "../random.ts";

const OBJECT_LIST = 0x33ac;
const OBJECT_SLOTS = 30;
const LONG_DIV_FAR = 0x11bc; // set around calls to the runtime long division (far return)
const ANGLE_TANGENTS = 0x1256; // 16 tangent thresholds (8.8) for one octant
const ANGLE_SECTORS = 0x1276; // 8 angle thresholds -> direction 0..7
const JOY_DIRS = 0x1246; // 8 (dx, dy) signed byte pairs, one per direction bit
const JOY_X_RAW = 0x33fa; // dword
const JOY_Y_RAW = 0x33f6; // dword
const JOY_STATE = 0x33fe; // -1: no joystick
const JOY_X_RANGE = 0x622a; // dword
const JOY_Y_RANGE = 0x622e; // dword
const JOY_MAGNITUDE = 0x612e;
const JOY_ANGLE = 0x6130;
const JOY_DIRECTION = 0x623a;
const DEMO_RECORD = 0x1986;
const DEMO_PLAYBACK = 0x1987;
const DEMO_POS = 0x198a;
const DEMO_TIME = 0x1982; // dword: frame clock compared with event times
const DEMO_ENDED = 0x198c;
const DEMO_EVENTS = 0x623c; // 6-byte events: dword time, direction, magnitude
const DEMO_LAST_DIR = 0x3918;
const DEMO_LAST_MAG = 0x3919;
const KEY_DIRS = 0x273a; // direction key bits
const KEY_DX = 0x3952;
const KEY_DY = 0x3950;
const KEY_SPEED = 0x6132;
const KEY_ANGLE = 0x6228;
const NAME_TABLE = 0x19b4;
const NAME_PICKS = 0x6e82;
const NAME_SOURCE = 0x12a1;

const s16 = (v: number) => (v << 16) >> 16;
const s8 = (v: number) => (v << 24) >> 24;

// Borland signed long division (0:e64e): truncates toward zero, 32-bit result.
function ldiv(a: number, b: number): number {
  return Math.trunc((a | 0) / (b | 0)) | 0;
}

// fff:000c isqrt(n): Newton iteration on 16-bit unsigned, at most 20 steps.
export function isqrt(_m: Memory, n: number): number {
  n &= 0xffff;
  let g = (n >> 4) | 1;
  let steps = 0;
  let d: number;
  do {
    const q = Math.floor(n / g);
    if (q < g) {
      d = (g - q) >> 1;
      g -= d;
    } else {
      d = (q - g) >> 1;
      g += d;
    }
    steps++;
  } while (d > 1 && steps < 20);
  return g & 0xffff;
}

// fff:0067 distance(dx, dy): sqrt(dx*dx + dy*dy) with 16-bit squares; 0xff when the sum is 0xffff.
export function distance(m: Memory, dx: number, dy: number): number {
  const sum = ((dx * dx) + (dy * dy)) & 0xffff;
  return sum === 0xffff ? 0xff : isqrt(m, sum);
}

// fff:0ca3 nextObjectOfClass(class, index*): scan the object list from *index (advanced), first object of class.
export function nextObjectOfClass(m: Memory, cls: number, indexPtr: number): number {
  while (m.s8(indexPtr) < OBJECT_SLOTS) {
    const i = m.s8(indexPtr);
    m.set8(indexPtr, i + 1);
    const obj = m.u16(OBJECT_LIST + i * 2);
    if (obj && m.u8(obj + 2) === (cls & 0xff)) return obj;
  }
  return 0;
}

// fff:0cdc angle(dx, dy): direction of (dx, dy) as 0..63 (16 steps per quadrant) from a tangent table.
export function angle(m: Memory, dx: number, dy: number): number {
  dx = s16(dx);
  dy = s16(dy);
  const right = dx > 0;
  const up = !(dy > 0);
  if (dy === 0) return right ? 0x10 : 0x30;
  if (!(dx > 0)) dx = s16(-dx);
  if (!(dy > 0)) dy = s16(-dy);
  m.set8(LONG_DIV_FAR, 1);
  const ratio = ldiv(dx * 256, dy);
  m.set8(LONG_DIV_FAR, 0);
  let n = 0x10;
  if (!(ratio >>> 16)) {
    n = 0;
    while (n < 0x10 && m.s16(ANGLE_TANGENTS + n * 2) < ratio) n++;
  }
  if (up !== right) n = 0x20 - n;
  if (!right) n += 0x20;
  return n & 0x3f;
}

// fff:0dc6 sector(angle): index of the first threshold >= angle in DS:1276, as a direction 0..7.
export function sector(m: Memory, value: number): number {
  let i = 0;
  while (m.s8(ANGLE_SECTORS + i) < s8(value) && i < 8) i++;
  return i & 7;
}

// fff:0c4b keyDirection(bits, dy*, dx*): first set direction bit -> its (dx, dy) words; -1 if none.
export function keyDirection(m: Memory, bits: number, dyPtr: number, dxPtr: number): number {
  bits &= 0xff;
  for (let i = 0; i < 8; i++) {
    if (bits & 1) {
      m.set16(dxPtr, m.s8(JOY_DIRS + i * 2));
      m.set16(dyPtr, m.s8(JOY_DIRS + i * 2 + 1));
      return i;
    }
    bits >>= 1;
  }
  return 0xffff;
}

// fff:0b90 readKeys(): direction keys -> step vector (DS:3952/3950, x40), speed and angle; returns direction or -1.
export function readKeys(m: Memory): number {
  const bits = m.u8(KEY_DIRS);
  if (!bits) {
    m.set8(KEY_ANGLE, 0);
    m.set16(KEY_DY, 0);
    m.set16(KEY_DX, 0);
    m.set8(KEY_SPEED, 0);
    return 0xffff;
  }
  let dir = 0xffff;
  let a = 0;
  let b = 0;
  bits: for (let i = 0, v = bits; i < 8; i++, v >>= 1) {
    if (v & 1) {
      dir = i;
      // The callee writes two overlapping words; the bytes that survive are dy (first) and dx (second).
      b = m.s8(JOY_DIRS + i * 2);
      a = m.s8(JOY_DIRS + i * 2 + 1);
      break bits;
    }
  }
  m.set16(KEY_DX, a * 40);
  m.set16(KEY_DY, b * 40);
  const x = m.s16(KEY_DX);
  const y = m.s16(KEY_DY);
  const ax = x > 0 ? x : s16(-x);
  const cx = y > 0 ? y : s16(-y);
  let speed = (ax > cx ? x : y) & 0xff;
  if (!(s8(speed) > 0)) speed = -s8(speed) & 0xff;
  m.set8(KEY_SPEED, speed);
  m.set8(KEY_ANGLE, dir * 40);
  return dir;
}

// fff:1dc0 readJoystick(): analog stick -> magnitude/angle/direction (DS:612e/6130/623a), recorded into or replayed
// from the demo event list. Returns the direction.
export function readJoystick(m: Memory): number {
  let jx = 0;
  let jy = 0;
  if (m.s16(JOY_STATE) === -1) {
    m.set16(JOY_MAGNITUDE, 0);
  } else {
    m.set8(LONG_DIV_FAR, 1);
    jx = ldiv(Math.imul(m.u16(JOY_X_RAW) | (m.u16(JOY_X_RAW + 2) << 16), 100), m.u16(JOY_X_RANGE) | (m.u16(JOY_X_RANGE + 2) << 16));
    jy = ldiv(Math.imul(m.u16(JOY_Y_RAW) | (m.u16(JOY_Y_RAW + 2) << 16), 100), m.u16(JOY_Y_RANGE) | (m.u16(JOY_Y_RANGE + 2) << 16));
    m.set8(LONG_DIV_FAR, 0);
    if (!(jx < 0 || (jx >= 0 && jx >>> 0 <= 100))) jx = 100;
    jx = (jx - 50) | 0;
    if (!(jy < 0 || jy <= 100)) jy = 100;
    jy = (jy - 50) | 0;
    const big = Math.abs(jx) > Math.abs(jy) ? jx : jy;
    m.set16(JOY_MAGNITUDE, Math.abs(big));
  }
  if (m.s16(JOY_MAGNITUDE) > 0x12) {
    const a = angle(m, jx, jy);
    m.set16(JOY_ANGLE, a);
    m.set8(JOY_DIRECTION, sector(m, a));
  } else {
    m.set16(JOY_ANGLE, 0xffff);
    m.set8(JOY_DIRECTION, 0);
    m.set16(JOY_MAGNITUDE, 0);
  }
  if (m.u8(DEMO_RECORD) && (m.s8(DEMO_LAST_MAG) !== m.s16(JOY_MAGNITUDE) || m.u8(JOY_DIRECTION) !== m.u8(DEMO_LAST_DIR))) {
    const mag = m.u8(JOY_MAGNITUDE);
    m.set8(DEMO_LAST_MAG, mag);
    const ev = DEMO_EVENTS + ((m.u16(DEMO_POS) * 6) & 0xffff);
    m.set8(ev + 5, mag);
    m.set8(DEMO_LAST_DIR, m.u8(JOY_DIRECTION));
    m.set8(ev + 4, m.u8(JOY_DIRECTION));
    m.set16(ev + 2, m.u16(DEMO_TIME + 2));
    m.set16(ev, m.u16(DEMO_TIME));
    m.set16(DEMO_POS, m.u16(DEMO_POS) + 1);
  }
  if (m.u8(DEMO_PLAYBACK)) {
    for (;;) {
      const ev = DEMO_EVENTS + ((m.u16(DEMO_POS) * 6) & 0xffff);
      const t = (m.u16(ev) | (m.u16(ev + 2) << 16)) >>> 0;
      const now = (m.u16(DEMO_TIME) | (m.u16(DEMO_TIME + 2) << 16)) >>> 0;
      if (t > now) break;
      if (m.u8(ev + 4) === 0x64) {
        m.set8(DEMO_PLAYBACK, 0);
        m.set16(DEMO_POS, m.u16(DEMO_POS) + 1);
        m.set8(DEMO_ENDED, 1);
      } else {
        m.set8(DEMO_LAST_DIR, m.u8(ev + 4));
        m.set8(DEMO_LAST_MAG, m.u8(ev + 5));
        m.set16(DEMO_POS, m.u16(DEMO_POS) + 1);
      }
    }
    m.set16(JOY_MAGNITUDE, m.s8(DEMO_LAST_MAG));
    const dir = m.u8(DEMO_LAST_DIR);
    m.set8(JOY_DIRECTION, dir);
    m.set16(JOY_ANGLE, s8(dir) * 8);
  }
  return m.s8(JOY_DIRECTION) & 0xffff;
}

// fff:1d22 offsetRow(n): add 50*n to every non-0xff byte of rows 13n..13n+12 (11 bytes each) at DS:5f72.
export function offsetRows(m: Memory, n: number): void {
  if (!(n & 0xffff)) return;
  const add = (n * 50) & 0xffff;
  const end = s16(n * 13 + 13);
  for (let r = (n * 13) & 0xff; s8(r) < end; r = (r + 1) & 0xff) {
    for (let c = 0; c < 11; c++) {
      const at = (s8(r) * 11 + c) & 0xffff;
      const b = m.u8(0x5f72 + at);
      if (b !== 0xff) m.set8(0x5f72 + at, b + add);
    }
  }
}

// fff:11f7 nameMatches(a, b): string compare where '_' in a matches an 's' or the end of b.
export function nameMatches(m: Memory, a: number, b: number): number {
  for (let i = 0; ; i++) {
    const ca = m.u8(a + i);
    if (!ca && !m.u8(b + i)) return 1;
    const cb = m.u8(b + i);
    if (ca === 0x5f && (cb === 0x73 || !cb)) return 1;
    if (ca !== cb) return 0;
  }
}

// fff:2b76 clearObjectFlag35(): byte +0x35 = 0 on every listed object.
export function clearObjectFlag35(m: Memory): void {
  for (let i = 0; i < OBJECT_SLOTS; i++) {
    const obj = m.u16(OBJECT_LIST + i * 2);
    if (obj) m.set8(obj + 0x35, 0);
  }
}

// fff:2bfa shuffleNames(): pick a random byte from DS:12a1 (13 entries) for every entry of the DS:19b4 list.
export function shuffleNames(m: Memory): void {
  for (let i = 0; m.u8(NAME_TABLE + i); i++) m.set8(NAME_PICKS + i, m.u8(NAME_SOURCE + random(m, 13)));
}

// fff:2c36 namePick(id): the random pick for id in the DS:19b4 list, or -1.
export function namePick(m: Memory, id: number): number {
  for (let i = 0; ; i++) {
    const b = m.u8(NAME_TABLE + i);
    if (!b) return 0xffff;
    if (b === (id & 0xffff)) return m.u8(NAME_PICKS + i);
  }
}

// fff:2ba5 saveVideoMode(): copy BIOS video mode (0040:0049) and equipment byte (0040:0010) to DS:6e80/6e81.
export function saveVideoMode(m: Memory): void {
  m.set8(0x6e80, m.bytes[0x449]);
  m.set8(0x6e81, m.bytes[0x410]);
}

// fff:2b4b egaColor(i): low nibble of DS:2f9c[i].
export function egaColor(m: Memory, i: number): number {
  return m.u8(0x2f9c + i) & 0xf;
}

// fff:2b5e cgaColor(i): bits 4-5 of DS:2f9c[i].
export function cgaColor(m: Memory, i: number): number {
  return (m.u8(0x2f9c + i) >> 4) & 3;
}

// fff:2652 animate(sequence, timer*, period, out*, index*): count the timer down by DS:3408; on underflow step through
// the 0xff-terminated byte sequence (wrapping) and reload. *out = current frame; returns 1 when it wrapped.
export function animate(m: Memory, seq: number, timerPtr: number, period: number, outPtr: number, indexPtr: number): number {
  let wrapped = 0;
  let v: number;
  m.set16(timerPtr, m.u16(timerPtr) - m.u16(0x3408));
  if (m.s16(timerPtr) < 0) {
    do {
      m.set8(indexPtr, m.u8(indexPtr) + 1);
      v = m.u8(seq + m.s8(indexPtr));
      if (v === 0xff) {
        wrapped = 1;
        m.set8(indexPtr, 0);
        v = m.u8(seq);
      }
      m.set16(timerPtr, m.u16(timerPtr) + period);
    } while (m.s16(timerPtr) < 0);
  } else {
    v = m.u8(seq + m.s8(indexPtr));
  }
  m.set16(outPtr, s8(v));
  return wrapped;
}
