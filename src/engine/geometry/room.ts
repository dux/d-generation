import type { Memory } from "../memory.ts";
import { drawSprite, maskWithFrame } from "../vga.ts";

export const CELLS = 0x357a; // 13 rows x 10 cols x 7 bytes (row stride 70) in the scene block at DS:34e4
export const CURRENT_CELL = 0x612a;
const STEP_TABLE = 0x127e; // per direction: signed (drow, dcol)
const ORIGIN_X = 0x30b8; // room origin on screen (x in 2-pixel units)
const ORIGIN_Y = 0x30ba;
const GRID_LEFT = 0x30b0; // screen position of the grid for worldToCell
const GRID_TOP = 0x30b2;
export const SHAPE_SEG = 0x2efa; // segment of the shape bank
export const FRAME = 0x6120; // far pointer to the current frame (off, seg at 6122)
export const FRAME_Y = 0x6126;
const WALL_DIR = 0x272e; // last wall frame selector
const WALL_DRAWING = 0x11bd;
const WALL_SIDE_A = 0x6236; // shading/mask bytes set per wall side (EGA/CGA values unused in VGA)
const WALL_SIDE_B = 0x6238;
const WALL_FRAMES = 0x2eaa;
const TALL_WALL_FRAMES = 0x2eb2;
const WALL_OFFSETS = 0x263c; // per side: dx, dy words
const WALL_SIDES = 0x2638; // 4 side bits
const FLOOR_FRAMES = 0x2eae;
const FLOOR_OFFSETS = 0x265c;
const FLOOR_BITS = 0x2688;
const EDGE_FRAMES = 0x2eac;
const EDGE_OFFSETS = 0x264c;
const FLOOR_MASK = 0x2ece; // far pointer to the floor mask frame buffer (off, seg at 2ed0)
const FLOOR_MASK_MAX = 0x2ed2;
const MASK_OBJECT = 0x6df4; // object whose part is being masked by floor edges
const MASK_PART = 0x6128;
const MASK_FRAME = 0x6df6; // far pointer (off, seg at 6df8)
const MASK_Y = 0x6dfa;
const MASK_X = 0x6dfc;
const EDGE_LIST = 0x6dfe; // 3-byte entries (col, row, edge bits)
const EDGE_COUNT = 0x6e76;

const s8 = (v: number) => (v << 24) >> 24;

// fff:1061 cellAt(cursor): DS:612a and cursor+0x16 = cell of (row cursor+0x11, col cursor+0x10).
export function cellAt(m: Memory, cursor: number): number {
  const cell = selectCell(m, m.s8(cursor + 0x11), m.s8(cursor + 0x10));
  m.set16(cursor + 0x16, cell);
  return cell;
}

export function selectCell(m: Memory, row: number, col: number): number {
  const cell = (s8(row) * 0x46 + s8(col) * 7 + CELLS) & 0xffff;
  m.set16(CURRENT_CELL, cell);
  return cell;
}

// fff:1091 cellOrigin(cursor): cursor x (+1) / y (+5) words = col/row * 14 - 2, fractions (+0, +4) cleared.
export function cellOrigin(m: Memory, cursor: number): void {
  m.set16(cursor + 1, m.s8(cursor + 0x10) * 14 - 2);
  m.set16(cursor + 5, m.s8(cursor + 0x11) * 14 - 2);
  m.set8(cursor + 4, 0);
  m.set8(cursor, 0);
}

// Screen position of a cell's top-left corner (x in pixels).
function cellScreen(m: Memory, row: number, col: number): { x: number; y: number } {
  return {
    x: ((s8(col) * 14 - 2 + m.u16(ORIGIN_X)) * 2) & 0xffff,
    y: (s8(row) * 14 - 2 + m.u16(ORIGIN_Y)) & 0xffff,
  };
}

// fff:10d2 step(pair, dir): move (row, col) bytes by direction dir if the result stays on the 13x10 grid; 1 if moved.
export function step(m: Memory, pair: number, dir: number): number {
  const d = STEP_TABLE + s8(dir) * 2;
  const col = s8(m.u8(pair + 1) + m.u8(d + 1));
  const row = s8(m.u8(pair) + m.u8(d));
  if (col < 0 || col >= 10 || row < 0 || row >= 13) return 0;
  m.set8(pair + 1, col);
  m.set8(pair, row);
  return 1;
}

// fff:1135 worldToCell(x, y, pair): pair = ((y - top - 6) / 14, max(0, x - left) / 14).
export function worldToCell(m: Memory, x: number, y: number, pair: number): void {
  const dx = ((x - m.u16(GRID_LEFT)) << 16) >> 16;
  m.set8(pair + 1, dx > 0 ? Math.trunc(dx / 14) : 0);
  const dy = ((y - m.u16(GRID_TOP) - 6) << 16) >> 16;
  m.set8(pair, Math.trunc(dy / 14));
}

// Neighbour wall bits of the cell (row, col): [0] from the cell in direction 6, [1] from direction 2.
function neighbourWalls(m: Memory, row: number, col: number, masked: boolean): [number, number] {
  const out: [number, number] = [0, 0];
  const dirs: [number, number, number][] = [[6, 0x0a, 0], [2, 0xa0, 1]];
  for (const [dir, bits, k] of dirs) {
    const d = STEP_TABLE + dir * 2;
    const c = s8(col + m.u8(d + 1));
    const r = s8(row + m.u8(d));
    if (c < 0 || c >= 10 || r < 0 || r >= 13) continue;
    const cell = selectCell(m, r, c);
    let v = m.u8(cell) & bits;
    if (masked || k === 1) v &= ((m.u16(cell + 2) & 0x55) << 1) & 0xff;
    out[k] = v;
  }
  return out;
}

// fff:1252 neighbours(cursor, masked): cursor+0x18/+0x19 = wall bits of the neighbours in directions 6 and 2.
export function neighbours(m: Memory, cursor: number, masked: number): void {
  const [a, b] = neighbourWalls(m, m.s8(cursor + 0x11), m.s8(cursor + 0x10), (masked & 0xff) !== 0);
  m.set8(cursor + 0x18, a);
  m.set8(cursor + 0x19, b);
}

// fff:171d log4(v): number of 2-bit shifts until the byte is zero, minus one (bit pair index).
export function log4(_m: Memory, v: number): number {
  let n = 0;
  for (v &= 0xff; (v >>= 2); ) n++;
  return n;
}

// fff:1741 wallShadeOwn(side, cellBits): VGA shading selectors for a wall side from the cell's own bits.
export function wallShadeOwn(m: Memory, side: number, bits: number): void {
  side &= 0xff;
  if ((side === 2 && bits & 8) || (side === 3 && bits & 2)) m.set8(WALL_SIDE_A, 3);
  else if ((side === 0 && bits & 0x80) || (side === 1 && bits & 0x20)) m.set8(WALL_SIDE_B, 4);
}

// fff:17e0 wallShadeNeighbour(side, bits6, bits2): VGA shading selectors from the neighbours' wall bits.
export function wallShadeNeighbour(m: Memory, side: number, bits6: number, bits2: number): void {
  side &= 0xff;
  if ((side === 2 && bits6 & 8) || (side === 3 && bits6 & 2)) m.set8(WALL_SIDE_B, 4);
  else if ((side === 0 && bits2 & 0x80) || (side === 1 && bits2 & 0x20)) m.set8(WALL_SIDE_A, 3);
}

// fff:187f wallKind(word, bit): (low byte has bit) + 2 * (high byte has bit).
export function wallKind(_m: Memory, word: number, bit: number): number {
  bit &= 0xff;
  return (word & bit ? 1 : 0) + ((word >> 8) & bit ? 2 : 0);
}

// fff:0112 / fff:0214 VGA path: blit frame (off, seg) at (x, y) with color shift, flip and low shift.
export function blit(m: Memory, x: number, y: number, off: number, seg: number, shift: number, flip: number, low: number): void {
  drawSprite(m, x & 0xffff, y & 0xffff, off & 0xffff, seg & 0xffff, s8(shift) & 0xffff, s8(flip) & 0xffff, s8(low) & 0xffff);
}

function setFrame(m: Memory, handle: number): void {
  m.set16(FRAME, handle);
  m.set16(FRAME + 2, m.u16(SHAPE_SEG));
}

function frameByte(m: Memory, i: number): number {
  return m.bytes[m.u16(FRAME + 2) * 16 + ((m.u16(FRAME) + i) & 0xffff)];
}

// fff:14de / fff:1601 draw one wall side of a cell (tall: the raised variant 0x24 pixels higher).
function drawWall(m: Memory, kind: number, side: number, x: number, y: number, row: number, tall: boolean): void {
  kind &= 0xff;
  if (kind !== 2) {
    m.set16(WALL_DIR, s8(kind));
    kind = 0;
  }
  const a = s8(side);
  const wx = (m.u16(WALL_OFFSETS + a * 4) + x) & 0xffff;
  let wy = (m.u16(WALL_OFFSETS + a * 4 + 2) + y) & 0xffff;
  if (tall) wy = (wy - 0x24) & 0xffff;
  m.set16(FRAME_Y, wy);
  const frames = m.u16(m.u16(tall ? TALL_WALL_FRAMES : WALL_FRAMES) + a * 2);
  if (!tall) kind = kind === 2 ? 1 : 0;
  setFrame(m, m.u16(frames + kind * 2));
  m.set8(WALL_DRAWING, 1);
  const dy = tall ? 3 : 2;
  blit(m, frameByte(m, 0) + wx, wy - frameByte(m, 1) - dy, m.u16(FRAME) + 2, m.u16(FRAME + 2), s8(row) - 1, 0, 1);
  m.set8(WALL_DRAWING, 0);
}

// fff:14de drawWall(kind, side, x, y, pair)
export function drawLowWall(m: Memory, kind: number, side: number, x: number, y: number, pair: number): void {
  drawWall(m, kind, side, x, y, m.u8(pair), false);
}

// fff:1601 drawTallWall(kind, side, x, y, pair)
export function drawTallWall(m: Memory, kind: number, side: number, x: number, y: number, pair: number): void {
  drawWall(m, kind, side, x, y, m.u8(pair), true);
}

// fff:1350 drawFloor(pair, mask): draw the 8 floor pieces of cell (row, col) selected by mask & cell+4.
export function drawFloor(m: Memory, pair: number, mask: number): void {
  drawFloorAt(m, m.u8(pair), m.u8(pair + 1), mask);
}

export function drawFloorAt(m: Memory, row: number, col: number, mask: number): void {
  const pos = cellScreen(m, row, col);
  const y = (pos.y + 9) & 0xffff;
  const cell = selectCell(m, row, col);
  mask &= m.u8(cell + 4);
  if (!mask) return;
  for (let k = 0; k < 8; k++) {
    const bit = m.u8(FLOOR_BITS + k);
    if (!(bit & mask)) continue;
    const w = m.u16(cell + 5);
    let c = (w & bit ? 1 : 0) + ((w >> 8) & bit ? 2 : 0);
    if (c !== 3) c = 0;
    setFrame(m, m.u16(m.u16(m.u16(FLOOR_FRAMES) + c * 2) + k * 2));
    m.set16(FRAME_Y, m.u16(FLOOR_OFFSETS + k * 4 + 2) + y);
    const x = (m.u16(FLOOR_OFFSETS + k * 4) + pos.x) & 0xffff;
    const fy = m.u16(FRAME_Y) - (frameByte(m, 3) + frameByte(m, 1)) + 3;
    blit(m, frameByte(m, 0) + x, fy, m.u16(FRAME) + 2, m.u16(FRAME + 2), s8(row) - 1, 0, 1);
  }
}

// fff:190f drawWalls(pair, mask, tall): draw the wall sides of cell (row, col) in mask & 0xaa & cell bits.
export function drawWalls(m: Memory, pair: number, mask: number, tall: number): void {
  drawWallsAt(m, m.u8(pair), m.u8(pair + 1), mask, tall);
}

export function drawWallsAt(m: Memory, row: number, col: number, mask: number, tall: number): void {
  mask &= 0xaa;
  const pos = cellScreen(m, row, col);
  const cell = selectCell(m, row, col);
  const own = m.u8(cell) & mask;
  if (!own) return;
  const kinds = m.u16(cell + 2);
  const [n6, n2] = neighbourWalls(m, s8(row), s8(col), (tall & 0xff) !== 0);
  for (let k = 0; k < 4; k++) {
    const bit = m.u8(WALL_SIDES + k) & own;
    if (!bit) continue;
    const side = log4(m, bit);
    m.set8(WALL_SIDE_A, 0);
    m.set8(WALL_SIDE_B, 0);
    m.set8(WALL_SIDE_A + 1, 0xff);
    m.set8(WALL_SIDE_B + 1, 0xff);
    wallShadeOwn(m, side, own);
    wallShadeNeighbour(m, side, n6, n2);
    const kind = wallKind(m, kinds, bit);
    drawWall(m, kind, side, pos.x, pos.y, row, (tall & 0xff) !== 0);
  }
}

// fff:1a63 drawAllLowWalls(): every non-empty cell, all wall sides, low variant.
export function drawAllLowWalls(m: Memory): void {
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 10; col++) {
      if (m.u8(selectCell(m, row, col))) drawWallsAt(m, row, col, 0xff, 0);
    }
  }
}

// fff:1abe drawAllTallWalls(): every non-empty cell, the sides flagged raised in cell+2, tall variant.
export function drawAllTallWalls(m: Memory): void {
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 10; col++) {
      const cell = selectCell(m, row, col);
      if (m.u8(cell)) drawWallsAt(m, row, col, m.u16(cell + 2) << 1, 1);
    }
  }
}

// fff:18b5 edgeList(bits, out): indices k (0..3) of set odd bits (2 << 2k), 0xff-terminated if fewer than 4.
export function edgeList(m: Memory, bits: number, out: number): void {
  let n = 0;
  bits &= 0xff;
  for (let k = 0; k < 4; k++, bits >>= 2) if (bits & 2) m.set8(out + n++, k);
  if (n < 4) m.set8(out + n, 0xff);
}

// fff:2257 prepareFloorMask(part, frameOff, frameSeg): fill the mask frame buffer with 0xff (part * 32 bytes, capped
// by DS:2ed2) and copy the frame's header bytes 2-3 into it.
export function prepareFloorMask(m: Memory, part: number, off: number, seg: number): void {
  let len = (s8(part) << 5) & 0xffff;
  if (((len << 16) >> 16) > m.s16(FLOOR_MASK_MAX)) len = m.u16(FLOOR_MASK_MAX);
  const dst = m.u16(FLOOR_MASK + 2) * 16;
  const at = m.u16(FLOOR_MASK);
  for (let i = 0; i < len; i++) m.bytes[dst + ((at + i) & 0xffff)] = 0xff;
  const src = seg * 16;
  m.bytes[dst + ((at + 2) & 0xffff)] = m.bytes[src + ((off + 2) & 0xffff)];
  m.bytes[dst + ((at + 3) & 0xffff)] = m.bytes[src + ((off + 3) & 0xffff)];
}

// fff:22e2 maskPart(): AND the current floor edge frame into the masked object's current part.
export function maskPart(m: Memory): void {
  const obj = m.u16(MASK_OBJECT);
  const p = m.u16(MASK_PART) * 2;
  maskWithFrame(
    m,
    m.u16(MASK_X),
    (m.u16(MASK_Y) + 0x19) & 0xffff,
    m.u16(MASK_FRAME),
    m.u16(MASK_FRAME + 2),
    m.u16((obj + p + 0x71) & 0xffff),
    (m.u16((obj + p + 0x77) & 0xffff) + 0x19) & 0xffff,
  );
}

// fff:2533 maskCellEdges(col, row, bits): mask the floor edges (bits & cell walls) of a cell out of the object part.
export function maskCellEdges(m: Memory, col: number, row: number, bits: number): void {
  const cell = selectCell(m, row, col);
  bits = m.u8(cell) & bits & 0xff;
  if (!bits) return;
  const list: number[] = [];
  for (let k = 0, b = bits; k < 4; k++, b >>= 2) if (b & 2) list.push(k);
  const obj = m.u16(MASK_OBJECT);
  if (!m.u8(obj + 0x14)) {
    m.set8(obj + 0x14, 1);
    prepareFloorMask(m, m.s8(obj + 0x15), m.u16(FRAME), m.u16(FRAME + 2));
  }
  const pos = cellScreen(m, row, col);
  for (const e of list) {
    m.set16(MASK_X, m.u16(EDGE_OFFSETS + e * 4) + pos.x);
    m.set16(MASK_Y, m.u16(EDGE_OFFSETS + e * 4 + 2) + pos.y + 1);
    const handle = m.u16(m.u16(EDGE_FRAMES) + e * 2);
    m.set16(MASK_FRAME, handle + 2);
    m.set16(MASK_FRAME + 2, m.u16(SHAPE_SEG));
    maskPart(m);
  }
}

// fff:24ee maskEdges(): maskCellEdges for every entry of the DS:6dfe edge list.
export function maskEdges(m: Memory): void {
  for (let i = 0; i < m.s16(EDGE_COUNT); i++) {
    const e = EDGE_LIST + i * 3;
    maskCellEdges(m, m.s8(e), m.s8(e + 1), m.u8(e + 2));
  }
}
