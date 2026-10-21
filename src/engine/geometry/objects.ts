import type { Memory } from "../memory.ts";
import { blit, FRAME, FRAME_Y, SHAPE_SEG } from "./room.ts";

const OBJECT_LIST = 0x33ac;
const CLASS_DESCRIPTORS = 0x191d;
const SCROLL_X = 0x30b4;
const SCROLL_Y = 0x30b6;
export const FRAME_X = 0x6226;
const CLIP_RIGHT = 0x30a0;
const CLIP_BOTTOM = 0x309e;
const DIRTY_COUNT = 0x18f4;
const DIRTY_RECTS = 0x3106; // 6-byte entries: x, y words, width, height bytes
const FORCE_REDRAW = 0x1996;
const BLIT_SHADOW = 0x3924;
const HIT_OBJECT = 0x6e78;
const PATH_CLASSES = 0x128e; // 0xff-terminated classes that own a path record
const PATH_NEXT = 0x398c;
const SCREEN_COORD = 0x16b5; // byte table: world high byte -> grid coordinate
const PATH_STEPS_A = 0x1291; // (dcol, drow) pairs
const PATH_STEPS_B = 0x1299;

const s8 = (v: number) => (v << 24) >> 24;

function frameByte(m: Memory, i: number): number {
  return m.bytes[m.u16(FRAME + 2) * 16 + ((m.u16(FRAME) + i) & 0xffff)];
}

// fff:0322 updateBox(obj): bounding boxes +0xba..+0xc0 and +0xc2..+0xc8 from the class box tables, rotated into
// screen axes (u = (x + y) << 7, v = (y - x + 256) << 7 from the integer parts of the 8.8 position).
export function updateBox(m: Memory, obj: number): void {
  const variant = m.s8(obj + 0x16);
  const tables = m.u16(m.u16(CLASS_DESCRIPTORS + m.s8(obj + 2) * 2) + 1);
  const xh = m.u8(obj + 8);
  const yh = m.u8(obj + 0xa);
  const u = ((xh + yh) << 7) & 0xffff;
  const v = ((yh - xh + 0x100) << 7) & 0xffff;
  for (const [table, field] of [[m.u16(tables + 2), 0xba], [m.u16(tables), 0xc2]]) {
    const r = m.u16((table + variant * 2) & 0xffff);
    m.set16(obj + field, m.u16(r) + u);
    m.set16(obj + field + 2, m.u16(r + 2) + v);
    m.set16(obj + field + 4, m.u16(r + 4) + u);
    m.set16(obj + field + 6, m.u16(r + 6) + v);
  }
}

// fff:1b1b assignPath(obj): objects of the classes in DS:128e get the next 12-byte path record (+0x3c).
export function assignPath(m: Memory, obj: number): void {
  const cls = m.u8(obj + 2);
  let at = PATH_CLASSES;
  while (m.u8(at) !== cls && m.u8(at) !== 0xff) at++;
  if (m.u8(at) === 0xff) return;
  m.set16(obj + 0x3c, m.u16(PATH_NEXT));
  m.set16(PATH_NEXT, m.u16(PATH_NEXT) + 0xc);
}

// fff:27b4 boxesOverlap(a, b): 1 if the boxes +0xc2..+0xc8 overlap (compared on their high bytes).
export function boxesOverlap(m: Memory, a: number, b: number): number {
  if (m.u8(a + 0xc3) > m.u8(b + 0xc7) || m.u8(b + 0xc3) > m.u8(a + 0xc7)) return 0;
  if (m.u8(a + 0xc5) > m.u8(b + 0xc9) || m.u8(b + 0xc5) > m.u8(a + 0xc9)) return 0;
  return 1;
}

// fff:26c9 findCollision(obj, out): first other live object overlapping obj (skipping its owner/children, classes
// 2 and 4, same team); DS:6e78 = it, *out = its class + 0x60. Returns 1 if found.
export function findCollision(m: Memory, obj: number, out: number): number {
  if (m.u8(obj + 0xd5)) return 0;
  const cls = m.u8(obj + 2);
  const team = m.u8(obj + 0x17);
  const id = m.u16(obj);
  const owner = m.u16(obj + 0x3f);
  for (let i = 0; i < 30; i++) {
    const o = m.u16(OBJECT_LIST + i * 2);
    if (!o) continue;
    const c = m.u8(o + 2);
    if (c === 4 || c === 2) continue;
    const oid = m.u16(o);
    if (oid === owner || (cls === 0x15 && c === 0x15) || oid === id || m.u16(o + 0x3f) === id) continue;
    if (c === team || m.u8(o + 0x17) === cls) continue;
    if (m.u8(o + 3) || m.u8(o + 0xd5) || m.u8(o + 0x18)) continue;
    if (!boxesOverlap(m, obj, o)) continue;
    m.set16(HIT_OBJECT, o);
    m.set8(out, m.u8(o + 2) + 0x60);
    return 1;
  }
  return 0;
}

// fff:0834 project(obj): DS:6226/6126 = screen position of the current frame (DS:6120) for the object's box.
export function project(m: Memory, obj: number): void {
  const height = frameByte(m, 3);
  const u = (m.u16(obj + 0xc2) - m.u16(obj + 0xc8) + 0x8000) & 0xffff;
  const v = (m.u16(obj + 0xc8) + m.u16(obj + 0xc6) + 0x8000) & 0xffff;
  m.set16(FRAME_X, (m.u8(obj + 7) & 0x80 ? 1 : 0) + (((u >> 8) - m.u16(SCROLL_X)) << 1));
  m.set16(FRAME_Y, (v >> 8) - m.u16(SCROLL_Y) + 1 - height - m.s8(obj + 0xc));
}

// fff:08c4 placeParts(obj): screen position (+0x71/+0x77) and clipped rect (+0x59 + 8p) of each active part, and a
// dirty rect (DS:3106 list, +0xd7) when anything that affects the image changed.
export function placeParts(m: Memory, obj: number): void {
  for (let p = 0; p < 3; p++) {
    if (!m.u8(obj + 0xcb + p)) continue;
    m.set16(FRAME, m.u16(obj + 0x1d + p * 2));
    m.set16(FRAME + 2, m.u16(SHAPE_SEG));
    project(m, obj);
    m.set16(FRAME_X, m.u16(FRAME_X) + m.u16(obj + 0x29 + p * 2));
    m.set16(FRAME_Y, m.u16(FRAME_Y) + m.u16(obj + 0x2f + p * 2));
    if (m.u8(obj + 0xca)) m.set16(FRAME_X, m.u16(FRAME_X) + m.s8(obj + 0xd2 + p) - (frameByte(m, 0) + frameByte(m, 2)));
    else m.set16(FRAME_X, m.u16(FRAME_X) + frameByte(m, 0));
    m.set16(FRAME_Y, m.u16(FRAME_Y) - frameByte(m, 1));
    const top = m.s16(FRAME_Y) < 0 ? 0 : m.u16(FRAME_Y);
    const left = m.s16(FRAME_X) < 0 ? 0 : m.u16(FRAME_X);
    const r = (obj + p * 8 + 0x59) & 0xffff;
    m.set16(r + 2, top);
    m.set16(r, left);
    m.set16(r + 4, frameByte(m, 2) + m.u16(FRAME_X) + 1);
    m.set16(r + 6, frameByte(m, 3) + m.u16(FRAME_Y));
    m.set16(r + 4, Math.min((m.u16(CLIP_RIGHT) + 1) & 0xffff, m.u16(r + 4)));
    m.set16(r + 6, Math.min(m.u16(r + 6), m.u16(CLIP_BOTTOM)));
    m.set16(obj + 0x77 + p * 2, m.u16(FRAME_Y));
    m.set16(obj + 0x71 + p * 2, m.u16(FRAME_X));
    const unchanged =
      m.u16(obj + 0x1d) === m.u16(obj + 0x23) &&
      m.u16(obj + 0x1f) === m.u16(obj + 0x25) &&
      m.u16(obj + 0x21) === m.u16(obj + 0x27) &&
      !m.u8(obj + 0xce) &&
      !m.u8(obj + 0xcf) &&
      !m.u8(obj + 0xd0) &&
      m.u8(obj + 0xc) === (m.s8(obj + 0x81) & 0xffff) &&
      m.u16(obj + 0x7d) === m.u16(obj + 0x7f) &&
      !m.u8(FORCE_REDRAW);
    if (unchanged) {
      m.set8(obj + 0xd6, 0);
      continue;
    }
    const n = m.u16(DIRTY_COUNT);
    m.set16(DIRTY_COUNT, n + 1);
    const rect = (n * 6 + DIRTY_RECTS) & 0xffff;
    m.set16(rect, left);
    m.set16(rect + 2, top);
    m.set8(rect + 4, m.u16(r + 4) - m.u16(FRAME_X));
    m.set8(rect + 5, m.u16(r + 6) - m.u16(FRAME_Y));
    m.set8(obj + 0xd6, 1);
    m.set16(obj + 0xd7 + p * 2, rect);
  }
}

// fff:00a5 drawPart(obj, part): blit one part frame at its screen position with the object's color shift and flip.
export function drawPart(m: Memory, obj: number, part: number): void {
  const p = s8(part) * 2;
  m.set16(FRAME, m.u16(obj + p + 0x1d));
  m.set16(FRAME + 2, m.u16(SHAPE_SEG));
  m.set16(BLIT_SHADOW, m.s8(obj + 0x14));
  blit(m, m.u16(obj + p + 0x71), m.u16(obj + p + 0x77), m.u16(FRAME) + 2, m.u16(FRAME + 2), m.u8(obj + 0xd1), m.u8(obj + 0xca), 0);
}

// fff:1b54 / fff:1c3b: write the object's grid cell and the two next cells along its facing into its path record.
function writePath(m: Memory, obj: number, steps: number): void {
  const xh = m.u8(obj + 8);
  const yh = m.u8(obj + 0xa);
  const a = m.s8(SCREEN_COORD + (((xh + yh) << 7) >> 8 & 0xff));
  const c = m.s8(SCREEN_COORD + (((yh - xh + 0x100) << 7) >> 8 & 0xff));
  let si = m.u16(obj + 0x3c);
  m.set8(si + 1, a | 0x80);
  m.set8(si, c | 0x80);
  let e = (m.s8(obj + 0x16) - 1) & 3;
  for (let k = 0; k < 2; k++, e++) {
    si += 2;
    m.set8(si + 1, (m.s8(steps + 1 + e * 2) + a) | 0x80);
    m.set8(si, (m.s8(steps + e * 2) + c) | 0x80);
  }
}

// fff:1b54 writePathA(obj)
export function writePathA(m: Memory, obj: number): void {
  writePath(m, obj, PATH_STEPS_A);
}

// fff:1c3b writePathB(obj)
export function writePathB(m: Memory, obj: number): void {
  writePath(m, obj, PATH_STEPS_B);
}

// fff:235a turnAround(obj, pair, outDir): pick a new facing (obj+0x13 +-2, or reversed) from the box corners against
// the target (row, col) pair. *outDir = facing & 7; returns 1 when it reversed.
export function turnAround(m: Memory, obj: number, pair: number, outDir: number): number {
  let d = m.u8(obj + 0x13);
  let reversed = 0;
  const g = (field: number) => m.s8(SCREEN_COORD + m.u8(obj + field));
  const p0 = m.s8(pair);
  const p1 = m.s8(pair + 1);
  if (d & 1) {
    d += 4;
  } else {
    // [corner a, corner b, b test, a test, delta when b passes, delta when a passes]
    const cases: [number, number, (b: number) => boolean, (a: number) => boolean, number, number][] = [
      [0xc3, 0xc5, (b) => b <= p0, (a) => a <= p1, 2, -2],
      [0xc7, 0xc5, (b) => b <= p0, (a) => a >= p1, -2, 2],
      [0xc7, 0xc9, (b) => b >= p0, (a) => a >= p1, 2, -2],
      [0xc3, 0xc9, (b) => b >= p0, (a) => a <= p1, -2, 2],
    ];
    const c = cases[s8(d) >> 1];
    if (c) {
      const a = g(c[0]);
      const b = g(c[1]);
      if (c[2](b)) d += c[4];
      else if (c[3](a)) d += c[5];
      else {
        d += 4;
        reversed = 1;
      }
    }
  }
  m.set8(outDir, d & 7);
  return reversed;
}
