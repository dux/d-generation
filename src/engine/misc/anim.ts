// Segment 12cc: per-class frame selection for the current object (DS:546a). Each routine steps the class's
// animation sequences (fff:2652), picks part frames (+0x1d/+0x1f/+0x21) and part offsets (+0x29.., +0x2f..)
// from the class frame tables at +4, then places the parts (fff:08c4).
import { register } from "../dispatch.ts";
import { drawToFront, drawToPanel, restoreDrawTarget } from "../geometry/draw.ts";
import { animate, nextObjectOfClass } from "../geometry/math.ts";
import { placeParts } from "../geometry/objects.ts";
import type { Memory } from "../memory.ts";

// Current object pointer.
export const CURRENT_OBJECT = 0x546a;
const FRAME_TIME = 0x3408;

function obj(m: Memory): number {
  return m.u16(CURRENT_OBJECT);
}

// Word i of the table at base (16-bit address wrap).
function at(m: Memory, base: number, i: number): number {
  return m.u16(base + 2 * i);
}

// animate() with its out word in the stack local `out`; returns [wrapped, frame].
function step(m: Memory, out: number, seq: number, timer: number, period: number, index: number): [number, number] {
  const wrapped = animate(m, seq, timer, period, out, index);
  return [wrapped, m.s16(out)];
}

// Runs fn with one stack word allocated for animate's out value.
function withLocal<T>(m: Memory, fn: (local: number) => T): T {
  const local = m.push(2);
  try {
    return fn(local);
  } finally {
    m.pop(2);
  }
}

// 12cc:07b7 nextSequenceByte(seq): advance +6 through the signed byte sequence (negative = wrap to 0), return it.
export function nextSequenceByte(m: Memory, seq: number): number {
  const o = obj(m);
  m.set8(o + 6, m.u8(o + 6) + 1);
  let v = m.s8(seq + m.s8(o + 6));
  if (v < 0) {
    m.set8(o + 6, 0);
    v = m.s8(seq);
  }
  return v & 0xffff;
}

// 12cc:000b anim000b(): panel-layer frames: facing (+0x16) mirrored above 4, sequence 12b4 while +0x92 or 12c3.
export function anim000b(m: Memory): void {
  drawToPanel(m);
  const o = obj(m);
  const di = m.u16(o + 4);
  let v = m.s8(o + 0x16);
  if (v > 4) {
    m.set8(o + 0xca, 1);
    v = 8 - v;
    m.set8(o + 0xd2, m.s8(o + 6) !== 0 ? m.u8(0x12c7 + v) : 0x11);
  } else {
    m.set8(o + 0xca, 0);
  }
  withLocal(m, (local) => {
    if (m.u8(o + 0x92)) {
      const si = m.u16(di + 2);
      const [wrapped, f] = step(m, local, 0x12b4, o + 0x95, 0x1c2, o + 6);
      if (wrapped) {
        m.set8(o + 0x92, 0);
        m.set8(o + 0x94, 1);
      }
      m.set8(o + 0xd2, 0x11);
      m.set16(o + 0x1d, at(m, at(m, si, v >> 1), f));
      m.set16(o + 0x2f, 3);
      return;
    }
    let f: number;
    if (m.u8(0x3375) && m.s8(o + 6) === 0) {
      animate(m, 0x12c3, o + 0x95, 0x1c2, local, o + 0x97);
      f = m.s8(local);
      m.set16(o + 0x2f, 1);
    } else {
      m.set16(o + 0x2f, 3);
      f = 0;
    }
    const si = at(m, di, f);
    m.set16(o + 0x1d, at(m, at(m, si, v), m.s8(o + 6)));
  });
  placeParts(m, o);
  restoreDrawTarget(m);
}

// 12cc:031b set031b(): +0x0c and +0x3b from the DS:1328 / DS:1306 tables by +6 (negative entry = +0x88).
export function set031b(m: Memory): void {
  const o = obj(m);
  const si = m.s8(o + 6);
  m.set8(o + 0xc, m.u8(0x1328 + si));
  const di = m.s8(0x1306 + si);
  m.set8(o + 0x3b, di < 0 ? m.u8(o + 0x88) : di);
}

// 12cc:017c anim017c(): sequence 12cb (faster while +0x85), optional second part (+0x0c < 0x80) and +0x89 overlay.
export function anim017c(m: Memory): void {
  const o = obj(m);
  const b9 = m.u8(o + 0x85);
  withLocal(m, (local) => {
    const [wrapped, f] = step(m, local, 0x12cb, o + 0x83, b9 ? 0x140 : 0x1c2, o + 6);
    if (wrapped) {
      m.set8(o + 0x3a, 0xff);
      m.set8(o + 0x37, 0);
      m.set16(o + 0x85, 0);
      m.set8(o + 6, 0);
      if (m.u8(o + 0x8a)) m.set8(o + 0x89, 1);
    }
    set031b(m);
    const d = m.u16(o + 4);
    let si: number;
    if (m.u8(o + 0xc) > 0x7f) {
      si = m.u16(d + 6);
      m.set16(o + 0x29, 1);
    } else {
      si = b9 ? m.u16(d + 2) : m.u16(d);
      m.set16(o + 0x2f, 1);
    }
    m.set16(o + 0x1d, at(m, si, f));
    if (m.u8(o + 0xc) < 0x80) {
      m.set8(o + 0xcc, 1);
      m.set16(o + 0x1f, at(m, m.u16(d + 4), f));
      m.set16(o + 0x31, m.u8(o + 0xc) + 4);
      m.set16(o + 0x2b, 0);
    } else {
      m.set8(o + 0xcc, 0);
    }
    if (m.u8(o + 0x89)) {
      m.set8(o + 0xcd, 1);
      const g = withLocal(m, (l2) => step(m, l2, 0x12ef, o + 0x8d, 0x190, o + 0x8f)[1]);
      m.set16(o + 0x21, at(m, m.u16(d + 8), g));
      m.set16(o + 0x33, 3 - m.s8(0x1301 + f));
      m.set16(o + 0x2d, 4);
    } else {
      m.set8(o + 0xcd, 0);
    }
  });
  placeParts(m, o);
}

// 12cc:0355 anim0355(): three-part frames: body (+0x84, sequence 134c), base (+0x83 unset) and +0x8e sequence 1355.
export function anim0355(m: Memory): void {
  const o = obj(m);
  m.set8(o + 0xca, 0);
  const si = m.u16(o + 4);
  withLocal(m, (local) => {
    let l2 = 0;
    if (m.u8(o + 0x84)) {
      l2 = step(m, local, 0x134c, o + 0x87, 0x12c, o + 6)[1];
      const di = m.u16(si + 4);
      m.set16(o + 0x2b, 2);
      m.set16(o + 0x31, -m.s8(o + 0x8b));
      m.set8(o + 0xcf, 1);
      m.set8(o + 0xcc, 1);
      if (l2 > 4) {
        m.set8(o + 0xca, 1);
        l2 = 8 - l2;
        m.set8(o + 0xd2, 0x13);
        m.set8(o + 0xd3, 0x13);
        m.set8(o + 0xd4, 0x13);
      } else {
        m.set8(o + 0xca, 0);
      }
      m.set16(o + 0x1f, at(m, di, l2));
      if (m.u8(o + 0x83)) m.set8(o + 0x8c, m.u8(o + 0xa) - m.u16(0x30b6) + 2);
    } else {
      m.set8(o + 0xcf, 0);
      m.set8(o + 0xcc, 0);
    }
    if (!m.u8(o + 0x83)) {
      let t = ((m.u8(o + 0xa) - m.u16(0x30b6) - 30) << 16) >> 16;
      if (t < 0) t = 0;
      m.set8(o + 0x8d, t);
      m.set8(o + 0xcd, 1);
      m.set16(o + 0x33, -30);
      m.set16(o + 0x2d, 2);
      m.set16(o + 0x21, m.u16(m.u16(si)));
    }
    const di = m.u16(si + 2);
    m.set16(o + 0x29, 2);
    m.set16(o + 0x2f, 0);
    if (m.u8(o + 0x8e)) {
      const [wrapped, f] = step(m, local, 0x1355, o + 0x87, 0x140, o + 6);
      l2 = f;
      if (wrapped) {
        m.set8(o + 6, 4);
        l2 = 0;
      }
    } else {
      l2 = m.u8(o + 0x83) ? 2 : 0;
    }
    m.set16(o + 0x1d, at(m, di, l2));
  });
  placeParts(m, o);
}

// 12cc:0522 anim0522(): sequence 135c (cycling +0xd1 by 4 while +0x85); on wrap the object state = DS:18f3.
export function anim0522(m: Memory): void {
  const o = obj(m);
  if (m.u8(o + 0x85)) {
    m.set8(o + 0xd1, m.u8(o + 0xd1) + 4);
    if (m.s8(o + 0xd1) > 0xc) m.set8(o + 0xd1, 0);
  }
  const [wrapped, f] = withLocal(m, (local) => step(m, local, 0x135c, o + 0x83, 0x2bc, o + 6));
  if (wrapped) {
    m.set8(o + 3, m.u8(0x18f3));
    return;
  }
  const di = m.u16(o + 4);
  let b = m.s8(o + 0x16);
  if (b > 3) {
    m.set8(o + 0xca, 1);
    b = b === 4 ? 0 : (((8 - b) << 24) >> 24);
    m.set8(o + 0xd2, 0x23);
  } else {
    m.set8(o + 0xca, 0);
  }
  const si = at(m, di, b);
  m.set16(o + 0x29, -6);
  m.set16(o + 0x2f, 0);
  m.set16(o + 0x1d, at(m, si, f));
  placeParts(m, o);
}

// 12cc:0600 anim0600(): step sequence 1362 (+6), +0xd1 from DS:136b.
export function anim0600(m: Memory): void {
  const f = nextSequenceByte(m, 0x1362);
  const o = obj(m);
  const si = m.u16(o + 4);
  m.set8(o + 0xd1, m.u8(0x136b + m.s8(o + 6)));
  m.set16(o + 0x1d, at(m, si, f));
  m.set16(o + 0x29, 1);
  m.set16(o + 0x2f, 0);
  placeParts(m, o);
}

// 12cc:0768 stepLevel(down): every 0x190 ticks of +0x8c move +6 one step toward 10 (down = 0) or 0; DS:1373[+6].
export function stepLevel(m: Memory, down: number): number {
  const o = obj(m);
  let si = m.s8(o + 6);
  m.set16(o + 0x8c, m.u16(o + 0x8c) - m.u16(FRAME_TIME));
  if (m.s16(o + 0x8c) < 0) {
    m.set16(o + 0x8c, m.u16(o + 0x8c) + 0x190);
    if ((down & 0xff) === 0) {
      if (si < 10) si++;
    } else if (si !== 0) {
      si--;
    }
  }
  m.set8(o + 6, si);
  return m.s8(0x1373 + si) & 0xffff;
}

// 12cc:065e anim065e(): level animation (+6 0..10 via stepLevel); +0x82 = 1 when fully up, +0x89 at 0 going down.
export function anim065e(m: Memory): void {
  const o = obj(m);
  m.set8(o + 0x82, 0);
  if (!m.u8(o + 0x89)) {
    if (m.u8(o + 0x8b)) {
      const di = m.u16(m.u16(o + 4) + 4);
      m.set16(o + 0x31, 0);
      m.set16(o + 0x2f, 0);
      m.set16(o + 0x1d, at(m, di, m.s8(o + 6)));
    } else {
      const r = stepLevel(m, m.s8(o + 0x87) & 0xffff);
      const l4 = m.s8(o + 6);
      if (l4 === 0 && m.u8(o + 0x87)) {
        m.set8(o + 0x89, 1);
      } else {
        const di = m.u16(m.u16(o + 4) + 2);
        m.set16(o + 0x1d, at(m, di, r));
        m.set16(o + 0x31, 0xffff);
        m.set16(o + 0x2f, 0xffff);
        if (l4 === 10 && !m.u8(o + 0x87)) m.set8(o + 0x82, 1);
      }
    }
  }
  if (m.u8(o + 0x89)) {
    const di = m.u16(m.u16(o + 4));
    m.set16(o + 0x1d, at(m, di, m.s8(o + 0x16)));
    m.set16(o + 0x31, 3);
    m.set16(o + 0x2f, 3);
  }
  placeParts(m, o);
}

// 12cc:0976 bumpClass5(_obj): first object of class 5 gets +0x83 incremented; above 1 its +6 = 4.
export function bumpClass5(m: Memory, _obj: number): void {
  const index = m.push(2);
  m.set8(index, 0);
  const found = nextObjectOfClass(m, 5, index);
  m.pop(2);
  if (found) {
    m.set8(found + 0x83, m.u8(found + 0x83) + 1);
    if (m.s8(found + 0x83) > 1) m.set8(found + 6, 4);
  }
}

// 12cc:09b0 set09b0(): +0x0c and +0x3b from the DS:13da / DS:13ac tables by +6 (negative entry = +0x87).
export function set09b0(m: Memory): void {
  const o = obj(m);
  const si = m.s8(o + 6);
  m.set8(o + 0xc, m.u8(0x13da + si));
  const di = m.s8(0x13ac + si);
  m.set8(o + 0x3b, di < 0 ? m.u8(o + 0x87) : di);
}

// 12cc:07f5 anim07f5(): sequence 137e unless +0x89; on wrap resets state flags (and bumps class 5 when +0x88).
export function anim07f5(m: Memory): void {
  const o = obj(m);
  if (m.u8(o + 0x89)) return;
  let b3 = 0;
  const [wrapped, f] = withLocal(m, (local) => step(m, local, 0x137e, o + 0x83, 0x168, o + 6));
  let l2 = f;
  if (wrapped) {
    m.set8(o + 0x8e, 0);
    if (m.u8(o + 0x8a)) {
      m.set8(o + 0x8a, 0);
      m.set8(o + 0x18, 1);
      m.set8(o + 0x89, 1);
      m.set8(o + 0xce, 2);
      m.set16(o + 0x8b, 0x2800);
    }
    m.set8(o + 0x3a, 0xff);
    m.set8(o + 0x37, 0);
    m.set8(o + 0x85, 0);
    m.set8(o + 6, 0);
    if (m.u8(o + 0x8d)) {
      m.set8(o + 0x8d, 0);
      m.set8(o + 6, 2);
      l2 = 2;
    }
    if (m.u8(o + 0x88)) {
      m.set16(0x5f6c, 0x800);
      bumpClass5(m, o);
    }
  }
  set09b0(m);
  if (m.u8(o + 0xc) > 0x7f) b3 = m.u8(o + 6) + 0xec;
  const di = m.u16(o + 4);
  m.set16(o + 0x1d, at(m, m.u16(di), ((b3 << 24) >> 24) + l2));
  m.set16(o + 0x2b, 0xffff);
  m.set16(o + 0x29, 0xffff);
  if (!m.u8(o + 0x88) && !m.u8(o + 0x8a) && !m.u8(o + 0x89) && !m.u8(o + 0x8d)) {
    m.set8(o + 0xcc, 1);
    m.set16(o + 0x1f, at(m, m.u16(di + 2), l2));
    m.set16(o + 0x31, m.u8(o + 0xc) + 3);
  } else {
    m.set8(o + 0xcc, 0);
  }
  placeParts(m, o);
}

// 12cc:09f0 anim09f0(): no-op while +0x8e > 0; +0x83 shows two fixed parts, else sequence 1408 while +0x93
// (on wrap: state DS:18f3 and DS:1993 = 1).
export function anim09f0(m: Memory): void {
  const o = obj(m);
  const si = m.u16(o + 4);
  if (m.s16(o + 0x8e) > 0) return;
  if (m.u8(o + 0x83)) {
    m.set16(o + 0x29, 0);
    m.set16(o + 0x2f, 0);
    m.set8(o + 0xce, 1);
    m.set16(o + 0x1d, m.u16(si + 2));
    m.set16(o + 0x1f, m.u16(si + 4));
    return;
  }
  m.set16(o + 0x2f, 7);
  let l = 0;
  if (m.u8(o + 0x93)) {
    const [wrapped, f] = withLocal(m, (local) => step(m, local, 0x1408, o + 0x90, 0x1fe, o + 6));
    l = f;
    if (wrapped) {
      m.set8(o + 3, m.u8(0x18f3));
      m.set8(0x1993, 1);
    }
  }
  m.set16(o + 0x1d, at(m, si, l));
}

// 12cc:0aa0 anim0aa0(): frames by mode +0x85 (1, 2, 3, 4, 5, 6, 7 or default); returns 1 when mode 7 wrapped.
export function anim0aa0(m: Memory): number {
  const o = obj(m);
  let period = 0x258;
  let seq = 0x141c;
  let bb = 0;
  let bc = 0;
  m.set16(o + 0x29, 0);
  m.set16(o + 0x2f, 4);
  const d = m.u16(o + 4);
  m.set8(o + 0xcc, 0);
  const k = m.u8(o + 0x85);
  if (k === 3) {
    seq = 0x143f;
    period = 0x190;
    bb = 1;
  }
  if (k === 2) bb = 2;
  if (k === 5) bb = 3;
  if (k === 4) bb = 0;
  withLocal(m, (local) => {
    if (k === 7) {
      if (m.u16(o + 0x89) < 0x3200) m.set8(o + 6, 0);
      const [wrapped, f] = step(m, local, 0x142a, o + 0x83, 0x12c, o + 6);
      if (wrapped) bc = 1;
      m.set16(o + 0x1d, at(m, m.u16(d + 0xc), f));
    } else if (k === 6) {
      if (m.u8(o + 0x86)) {
        m.set8(o + 0xca, 1);
        m.set8(o + 0xd2, 0xe);
      } else {
        m.set8(o + 0xca, 0);
      }
      const f = m.u8(o + 0x88) ? 0 : step(m, local, 0x146b, o + 0x83, 0x190, o + 6)[1];
      m.set16(o + 0x1d, at(m, m.u16(d + 0xa), f));
      m.set16(o + 0x29, 1);
      m.set16(o + 0x2f, 4);
    } else if (k === 1) {
      const f = step(m, local, 0x145d, o + 0x83, 0x15e, o + 6)[1];
      const si = m.u16(d + 8);
      m.set16(o + 0x1d, at(m, si, f));
      m.set16(o + 0x2f, 7 - m.s8(o + 6));
      m.set16(o + 0x29, 0xffff);
      m.set16(o + 0x1f, m.u16(si));
      m.set8(o + 0xcc, 1);
      m.set16(o + 0x2b, 0);
      m.set16(o + 0x31, 4);
    } else {
      const f = step(m, local, seq, o + 0x83, period, o + 6)[1];
      m.set16(o + 0x1d, at(m, at(m, d, bb), f));
    }
  });
  placeParts(m, o);
  return bc;
}

// 12cc:0cd2 anim0cd2(): frames by mode +0x83 (0: still by +0x84/+0x88, 1: sequence 1481 or fixed, 6: sequence 1488).
export function anim0cd2(m: Memory): void {
  const o = obj(m);
  m.set16(o + 0x29, 0xffff);
  const d = m.u16(o + 4);
  const k = m.s8(o + 0x83);
  const si = at(m, d, k);
  withLocal(m, (local) => {
    if (k === 0) {
      m.set16(o + 0x1d, at(m, si, m.s8(o + 0x84)));
      if (m.u8(o + 0x88)) m.set16(o + 0x1d, at(m, si + 4, m.s8(o + 0x88)));
      m.set16(o + 0x29, 0xfffe);
    } else if (k === 1) {
      m.set16(o + 0x29, 0xfffe);
      const j = m.u8(o + 0x84);
      let f = 0;
      if (j === 1) {
        f = step(m, local, 0x1481, o + 0x85, 0xc8, o + 6)[1];
      } else if (j === 2) {
        m.set16(o + 0x2f, 1);
        f = 7;
      }
      m.set16(o + 0x1d, at(m, si, f));
    } else if (k === 6) {
      const f = step(m, local, 0x1488, o + 0x85, 0x190, o + 6)[1];
      m.set16(o + 0x1d, at(m, si, f));
    } else {
      m.set16(o + 0x1d, m.u16(si));
    }
  });
  placeParts(m, o);
}

// 12cc:0e05 anim0e05(): offsets from DS:1496 by facing/2 (+4 in mode 7); sequence 148d while +0x87.
export function anim0e05(m: Memory): void {
  const o = obj(m);
  let l2 = m.s8(o + 0x16) >> 1;
  if (m.u8(o + 0x89) === 7) l2 += 4;
  m.set16(o + 0x29, m.s8(0x1497 + 2 * l2));
  m.set16(o + 0x2f, m.s8(0x1496 + 2 * l2));
  const di = m.u16(o + 4);
  let l6: number;
  if (m.u8(o + 0x87)) {
    const [wrapped, f] = withLocal(m, (local) => step(m, local, 0x148d, o + 0x83, 0x190, o + 6));
    if (wrapped) {
      m.set8(o + 0x87, 0);
      m.set8(o + 6, 0);
    }
    l6 = f;
  } else {
    l6 = m.u8(o + 0x8f) ? 2 : 0;
  }
  m.set16(o + 0x1d, at(m, at(m, di, l6), l2));
  placeParts(m, o);
}

// 12cc:0ed7 anim0ed7(): front-layer two-part frames: a chain of one-shot actions (+0x96, +0x9b, +0x97, +0xa8,
// +0xa3, +0x9a, +0x8b) each overriding the body frame; the head (+0x1f) from DS:2eba by +0x85. Returns 1 when
// the +0x96 action ended with +0xb1 set.
export function anim0ed7(m: Memory): number {
  const o = obj(m);
  const lc = m.push(2);
  m.set16(lc, 0);
  m.set8(o + 0xca, 0);
  let b15 = 0;
  drawToFront(m);
  const si = m.u16(0x2eba);
  let t = m.s8(o + 0x85);
  let b14 = 0;
  if (t >= 100) {
    t -= 100;
    b14 = 1;
  }
  const l8 = at(m, at(m, si, b14), t);
  const l4 = m.u16(o + 4);
  let bd = m.s8(o + 0x16);
  m.set8(o + 0xcc, 1);
  const frame = (): number => m.u16(lc);
  const anim = (seq: number, period: number): number => animate(m, seq, o + 0x94, period, lc, o + 6);
  if (m.u8(o + 0x96)) {
    const wrapped = anim(0x14b4, 0x208);
    if (wrapped || (m.s8(o + 6) > 1 && m.u8(o + 0xa1) !== 3)) {
      m.set8(o + 0xc, 0);
      m.set8(o + 6, 0);
      m.set8(o + 0x8b, 1);
      m.set8(o + 0x96, 0);
      m.set16(o + 0x8f, 0x400);
      m.set8(o + 0x16, 3);
      m.set8(o + 0x13, 3);
      if (m.u8(o + 0xb1)) b15 = 1;
    } else {
      const l6 = m.u16(m.u16(l4 + 6));
      m.set16(o + 0x1d, at(m, l6, frame()));
      m.set16(o + 0x2f, 0);
      m.set16(o + 0x29, 0);
      m.set8(o + 0xc, m.u8(0x14c1 + m.s8(o + 6)));
      m.set16(o + 0x2b, m.s8(0x1545 + frame()));
      m.set16(o + 0x31, m.s8(0x154a + frame()) - 19);
      bd = 3;
    }
  }
  if (m.u8(o + 0x9b)) {
    const l6 = m.u16(m.u16(l4 + 4));
    if (m.u8(o + 0x9c) && anim(0x14e6, 0x258)) m.set8(o + 0x9c, 0);
    m.set16(o + 0x1d, at(m, l6, frame()));
    m.set16(o + 0x2f, 0);
    m.set16(o + 0x29, 0);
    bd = (((frame() + 3) << 24) >> 24);
    m.set16(o + 0x2b, 2);
    m.set16(o + 0x31, 0xfff0);
  }
  if (m.u8(o + 0x97)) {
    const l6 = m.u16(m.u16(l4 + 8));
    if (anim(0x14ce, 0x1c2)) {
      m.set8(o + 0x97, 0);
      m.set8(o + 0x8b, 1);
    }
    m.set16(o + 0x1d, at(m, l6, frame()));
    m.set16(o + 0x29, 0);
    m.set16(o + 0x2f, 3);
    m.set16(o + 0x2b, 4);
    m.set16(o + 0x31, 0xfff1);
    bd = 3;
  }
  if (m.u8(o + 0xa8)) {
    const l2 = m.u16(l4 + 0xc);
    const wrapped = anim(0x12b4, 0x1c2);
    if (wrapped || (m.u8(o + 0xab) !== 1 && m.s8(o + 6) > 1)) {
      m.set8(o + 0xa8, 0);
      m.set8(o + 0x8b, 1);
      m.set8(o + 6, 0);
    }
    bd = m.s8(o + 0x16);
    if (bd > 4) {
      m.set8(o + 0xca, 1);
      bd = 8 - bd;
      m.set8(o + 0xd2, 0x12);
      m.set8(o + 0xd3, 0xe);
    } else {
      m.set8(o + 0xca, 0);
    }
    const l6 = at(m, l2, bd >> 1);
    m.set16(o + 0x1d, at(m, l6, frame()));
    m.set16(o + 0x29, 0);
    m.set16(o + 0x2f, 3);
    m.set16(o + 0x2b, m.s8(0x1557 + (m.s8(o + 0x16) >> 1)));
    m.set16(o + 0x31, (bd >> 1) - 16);
  }
  if (m.u8(o + 0xa3)) {
    const l6 = m.u16(m.u16(l4 + 0xa));
    if (anim(0x14d8, 0x28a)) {
      m.set8(o + 0xa3, 0);
      m.set8(o + 0x8b, 1);
    }
    m.set16(o + 0x1d, at(m, l6, frame()));
    m.set16(o + 0x29, 0);
    m.set16(o + 0x2f, 3);
    m.set16(o + 0x2b, m.s8(0x154f + frame()));
    m.set16(o + 0x31, m.s8(0x1553 + frame()) - 16);
    bd = 3;
  }
  if (m.u8(o + 0x9a)) {
    const l6 = m.u16(m.u16(l4 + 2));
    if (m.u8(o + 0x8e)) {
      m.set16(lc, nextSequenceByte(m, 0x14a2));
      if (m.s8(o + 6) === 0) m.set8(o + 0x8e, 0);
    }
    m.set16(o + 0x1d, at(m, l6, frame()));
    m.set16(o + 0x29, 0);
    m.set16(o + 0x2f, 3);
    m.set16(o + 0x2b, 1);
    m.set16(o + 0x31, frame() - 9);
    bd = 3;
  }
  if (m.u8(o + 0x8b)) {
    const l2 = m.u16(l4);
    if (bd > 4) {
      m.set8(o + 0xca, 1);
      bd = (((8 - bd) << 24) >> 24);
      m.set8(o + 0xd3, 0xe);
    } else {
      m.set8(o + 0xca, 0);
    }
    if (m.s8(o + 6) !== 0) {
      m.set8(o + 0xd2, m.u8(0x155b + bd));
      m.set16(o + 0x2b, m.s8(0x1535 + m.s8(o + 0x16)));
    } else {
      m.set16(o + 0x2b, m.s8(0x153d + m.s8(o + 0x16)));
      m.set8(o + 0xd2, 0x11);
    }
    const l6 = at(m, l2, bd);
    m.set16(o + 0x1d, at(m, l6, m.s8(o + 6)));
    m.set16(o + 0x29, 0);
    m.set16(o + 0x2f, 3);
    const la = at(m, 0x152b, bd);
    m.set16(o + 0x31, m.s8(la + m.s8(o + 6)) - 16);
  }
  m.set16(o + 0x1f, at(m, l8, bd));
  m.pop(2);
  placeParts(m, o);
  restoreDrawTarget(m);
  return b15;
}

// 12cc:14d9 anim14d9(): front-layer frames: +0x98 sequence 1570 (wrap: state DS:18f3), +0x94 sequence 155f played
// one frame behind (end: +0x8d), +0x8d by facing; frame tables from DS:2ea2 when +0x91.
export function anim14d9(m: Memory): void {
  const o = obj(m);
  const l4 = m.push(2);
  m.set16(l4, 0);
  m.set16(o + 0x29, 0);
  m.set16(o + 0x2f, 3);
  m.set8(o + 0xca, 0);
  drawToFront(m);
  const di = m.u8(o + 0x91) ? m.u16(0x2ea2) : m.u16(o + 4);
  if (m.u8(o + 0x98)) {
    const l2 = m.u16(m.u16(di + 4));
    if (animate(m, 0x1570, o + 0x95, 0x262, l4, o + 6)) {
      m.set8(o + 3, m.u8(0x18f3));
    } else {
      m.set16(o + 0x1d, at(m, l2, m.u16(l4)));
      m.set16(o + 0x29, 0xfffd);
      m.set16(o + 0x2f, 0xfffd);
    }
  }
  if (m.u8(o + 0x94)) {
    const l2 = m.u16(m.u16(di + 2));
    if (animate(m, 0x155f, o + 0x95, 0x190, l4, o + 6)) {
      m.set8(o + 6, 0);
      m.set8(o + 0x94, 0);
      m.set8(o + 0x8d, 1);
    } else if (m.u16(l4) !== 0) {
      m.set16(o + 0x1d, m.u16(l2 + 2 * m.u16(l4) - 2));
      m.set16(o + 0x29, 0xfffd);
    } else {
      m.set16(o + 0x1d, 0);
      m.set8(o + 0x97, 1);
    }
  }
  m.pop(2);
  if (m.u8(o + 0x8d)) {
    const si = m.u16(di);
    let b5 = m.s8(o + 0x16);
    if (b5 > 4) {
      m.set8(o + 0xca, 1);
      b5 = (((8 - b5) << 24) >> 24);
      m.set8(o + 0xd2, m.s8(o + 6) !== 0 ? m.u8(0x1585 + b5) : 0x11);
    } else {
      m.set8(o + 0xca, 0);
    }
    m.set16(o + 0x1d, at(m, at(m, si, b5), m.s8(o + 6)));
  }
  placeParts(m, o);
  restoreDrawTarget(m);
}

// 12cc:16a4 anim16a4(): sequence 1589, slower by 50 per step below +0x3b = 13; first frame when +0x3b <= 2.
export function anim16a4(m: Memory): void {
  const o = obj(m);
  const b1 = m.s8(o + 0x3b);
  const slow = b1 < 13 ? (13 - b1) * 50 : 0;
  const f = b1 > 2 ? withLocal(m, (local) => step(m, local, 0x1589, o + 0x83, (slow + 0x1c2) & 0xffff, o + 6)[1]) : m.s8(0x1589);
  m.set16(o + 0x1d, at(m, m.u16(o + 4), f));
  m.set16(o + 0x29, 0);
  m.set16(o + 0x2f, 0);
  placeParts(m, o);
}

// 12cc:174e anim174e(): sequence 158e.
export function anim174e(m: Memory): void {
  const o = obj(m);
  const f = withLocal(m, (local) => step(m, local, 0x158e, o + 0x83, 0xe6, o + 6)[1]);
  m.set16(o + 0x1d, at(m, m.u16(o + 4), f));
  m.set16(o + 0x29, 0xfffa);
  m.set16(o + 0x2f, 0);
  placeParts(m, o);
}

// 12cc:17b4 toLower(str): lowercase A-Z in place.
export function toLower(m: Memory, str: number): void {
  for (let i = 0; ; i++) {
    const c = m.s8(str + i);
    if (c === 0) return;
    if (c >= 0x41 && c <= 0x5a) m.set8(str + i, c + 0x20);
  }
}

// 12cc:17e4 anim17e4(): step sequence 15a0; when DS:15ab[+6] is set an extra part goes first (+0x8a = 4n - 4).
export function anim17e4(m: Memory): void {
  const f = nextSequenceByte(m, 0x15a0);
  const o = obj(m);
  const l2 = m.u16(o + 4);
  const b5 = m.s8(0x15ab + m.s8(o + 6));
  let p = 0;
  if (b5) {
    m.set8(o + 0xcc, 1);
    p = 1;
    m.set16(o + 0x1d, at(m, m.u16(l2 + 2), f));
    m.set8(o + 0x8a, b5 * 4 - 4);
  } else {
    m.set8(o + 0xcc, 0);
  }
  m.set16(o + 0x1d + 2 * p, at(m, m.u16(l2), f));
  m.set16(o + 0x2b, 0xfffa);
  m.set16(o + 0x29 + 2 * p, 0xfffa);
  m.set16(o + 0x31, 0);
  m.set16(o + 0x2f + 2 * p, 0);
  placeParts(m, o);
}

// 12cc:18cd anim18cd(): frame by facing from table +0x83 & 1, then +0x83 = 0.
export function anim18cd(m: Memory): void {
  const o = obj(m);
  const b1 = m.u8(o + 0x83) & 1;
  m.set8(o + 0x83, 0);
  const di = at(m, m.u16(o + 4), b1);
  m.set16(o + 0x1d, at(m, di, m.s8(o + 0x16)));
  placeParts(m, o);
}

// 12cc:191d anim191d(): front layer, fixed second part; sequence 15b5 while +0x87 (frame 10 hides the first part).
export function anim191d(m: Memory): void {
  drawToFront(m);
  const o = obj(m);
  m.set8(o + 0xcc, 1);
  const l2 = m.u16(m.u16(o + 4));
  m.set16(o + 0x1f, m.u16(m.u16(l2)));
  m.set16(o + 0x2b, 0xfffc);
  if (m.u8(o + 0x87)) {
    const f = withLocal(m, (local) => step(m, local, 0x15b5, o + 0x83, 0x47e, o + 6)[1]);
    if ((f & 0xffff) !== 10) {
      m.set8(o + 0xcb, 1);
      m.set16(o + 0x1d, at(m, m.u16(l2 + 2), f));
      m.set16(o + 0x29, 0xfffc);
    }
  } else {
    m.set8(o + 0xcb, 0);
  }
  placeParts(m, o);
  restoreDrawTarget(m);
}

// 12cc:19cf anim19cf(): sequence 15c7 while +0x88 (double speed when DS:3370), cycling +0xd1 0..3 per loop.
export function anim19cf(m: Memory): void {
  const saved = m.u16(FRAME_TIME);
  if (m.u8(0x3370)) m.set16(FRAME_TIME, saved << 1);
  const o = obj(m);
  if (!m.u8(o + 0x88)) {
    m.set8(o + 0xcb, 0);
    m.set8(o + 0xce, 2);
  } else {
    m.set8(o + 0xcb, 1);
    const [wrapped, f] = withLocal(m, (local) => step(m, local, 0x15c7, o + 0x8b, 0x96, o + 6));
    if (wrapped) {
      m.set8(o + 0xd1, m.u8(o + 0xd1) + 1);
      if (m.s8(o + 0xd1) > 3) m.set8(o + 0xd1, 0);
    }
    m.set16(o + 0x1d, at(m, m.u16(o + 4), f));
    m.set16(o + 0x29, 2);
    m.set16(o + 0x2f, 1);
    placeParts(m, o);
  }
  m.set16(FRAME_TIME, saved);
}

// 12cc:1a8a anim1a8a(): sequence 15ce at period +0x84 while +0x88 (+0x82 = idle); the second part points at the
// object +0x8c (offset from the x/y bytes +8/+0xa).
export function anim1a8a(m: Memory): void {
  const o = obj(m);
  let f = 0;
  if (m.u8(o + 0x88)) {
    f = withLocal(m, (local) => step(m, local, 0x15ce, o + 0x86, m.u16(o + 0x84), o + 6)[1]);
    m.set8(o + 0x82, 0);
  } else {
    m.set8(o + 0x82, 1);
    m.set8(o + 6, 0);
  }
  const l2 = m.u16(o + 0x8c);
  const di = m.u16(o + 4);
  m.set16(o + 0x1d, at(m, m.u16(di), f));
  m.set16(o + 0x29, 0xffff);
  if (m.u8(o + 0x88)) {
    m.set8(o + 0xcc, 1);
    m.set16(o + 0x1f, at(m, m.u16(di + 2), m.s8(0x15d9 + m.s8(o + 6))));
    m.set16(o + 0x2b, (m.u8(l2 + 8) - m.u8(o + 8)) * 2 - 3);
    m.set16(o + 0x31, m.u8(l2 + 0xa) - m.u8(o + 0xa));
  } else {
    m.set8(o + 0xcc, 0);
    m.set8(o + 0xcf, 2);
  }
  placeParts(m, o);
}

register("12cc:07b7", nextSequenceByte);
register("12cc:000b", anim000b);
register("12cc:031b", set031b);
register("12cc:017c", anim017c);
register("12cc:0355", anim0355);
register("12cc:0522", anim0522);
register("12cc:0600", anim0600);
register("12cc:0768", stepLevel);
register("12cc:065e", anim065e);
register("12cc:0976", bumpClass5);
register("12cc:09b0", set09b0);
register("12cc:07f5", anim07f5);
register("12cc:09f0", anim09f0);
register("12cc:0aa0", anim0aa0);
register("12cc:0cd2", anim0cd2);
register("12cc:0e05", anim0e05);
register("12cc:0ed7", anim0ed7);
register("12cc:14d9", anim14d9);
register("12cc:16a4", anim16a4);
register("12cc:174e", anim174e);
register("12cc:17b4", toLower);
register("12cc:17e4", anim17e4);
register("12cc:18cd", anim18cd);
register("12cc:191d", anim191d);
register("12cc:19cf", anim19cf);
register("12cc:1a8a", anim1a8a);
