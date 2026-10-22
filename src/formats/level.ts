import JSON5 from "json5";

export interface UnknownBytes { at: number; bytes: string }

// Selectors preserve all eight bit lanes, even when no wall/line/tile uses a lane.
export interface Cell {
  walls: number[];
  floorLines: number[];
  wallLineSelectors: string;
  tiles: number[];
  tileVariants: string;
  unknownWallBits?: number;
}

export type ObjectClass = "sur-marker" | "door" | "tel" | "switch" | "squ" | "orb" | "cub" | "entry" | "sur" | "trk" | "art" | "dec" | "ven" | "pan" | "tub" | "elc" | "exp" | "lift" | "laser" | "bar" | "cgen" | "sli" | "hed" | "anm" | "dgen" | `unknown-${number}`;

export interface ObjectSpec {
  class: ObjectClass;
  encodedClass?: 19;
  x: number;
  y: number;
  params: Record<string, number>;
}

export interface Piece { index: number; x: number; y: number; foreground: boolean; offscreen: boolean }
export interface Drop { x0: number; y0: number; x1: number; color: number; spacing: number; upward: boolean; step: number; rising: boolean }
export interface Line { x0: number; y0: number; x1: number; y1: number; inner: number; outer: number }
export interface Topic { textOffset: number; replies: number[] }
export interface Reply { textOffset: number; responses: number[]; nextTopics: number[] }
export interface Dialogue {
  unknownPrefix: string;
  palette1: number;
  palette2: number;
  appearance: number;
  patience: number;
  speed: number;
  initialMode: number;
  behavior: number;
  interaction: number;
  grabMode: number;
  answerAllowance: number;
  topics: Topic[];
  wakeTextOffset: number;
  interactionTextOffset: number;
  replies: Reply[];
  textPool: string;
}
export type RoomChunk =
  | { kind: "pieces"; pieces: Piece[]; unknown?: string }
  | { kind: "drops"; drops: Drop[]; unknown?: string }
  | { kind: "lines"; lines: Line[]; unknown?: string }
  | { kind: "dialogue"; dialogue: Dialogue }
  | { kind: "unknown"; type: number; bytes: string };

export interface Room {
  scene: number;
  message: string;
  objects: ObjectSpec[];
  cellLegend: Record<string, Cell>;
  cells: string[];
  chunks: RoomChunk[];
  terminator: number;
  unknown: UnknownBytes[];
  afterTerminator: string;
}
export interface FloorMap {
  bank: number;
  rows: (number | null)[][];
  unknown: UnknownBytes[];
}
export interface Floor {
  format: "d-generation-aga-floor";
  floor: number;
  buildingFloor: number;
  start: number;
  starts: number[];
  lookupScenes: number[];
  connections: ({ kind: "grid"; from: number; direction: number; to: number } | { kind: "lift"; from: number; object: number; selector: number; to: number } | { kind: "special-exit"; from: number; to: number })[];
  map: FloorMap;
  rooms: Room[];
}

const BLOCK_SIZE = 0x430;
const CELLS_AT = 0x96;
const hex = (b: Uint8Array) => Array.from(b, n => n.toString(16).padStart(2, "0")).join("");
const latin1 = (b: Uint8Array) => Array.from(b, n => String.fromCharCode(n)).join("");
function bytesOf(text: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(text)) throw new Error("Invalid unknown-byte hex string");
  return Uint8Array.from(text.match(/../g) ?? [], n => parseInt(n, 16));
}
function textBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 255) throw new Error("Room text must fit the original 8-bit character set");
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}
function integer(n: number, max: number, label: string, min = 0): number {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: expected integer ${min}..${max}, got ${n}`);
  return n;
}
function mask(indices: number[], max: number): number {
  let bits = 0;
  for (const n of indices) {
    const bit = 1 << integer(n, max, "bit index");
    if (bits & bit) throw new Error("Duplicate bit index");
    bits |= bit;
  }
  return bits;
}
function lanes(low: number, high: number): string {
  return Array.from({ length: 8 }, (_, i) => String(((low >> i) & 1) | (((high >> i) & 1) << 1))).join("");
}
function unlanes(text: string): [number, number] {
  if (!/^[0-3]{8}$/.test(text)) throw new Error("Selectors must contain eight digits 0..3, bit 0 first");
  let low = 0, high = 0;
  for (let i = 0; i < 8; i++) { const n = Number(text[i]); low |= (n & 1) << i; high |= (n >> 1) << i; }
  return [low, high];
}
const indices = (bits: number, count: number) => Array.from({ length: count }, (_, i) => i).filter(i => bits & (1 << i));
function decodeCell(b: Uint8Array): Cell {
  const cell: Cell = {
    walls: indices(((b[0] >> 1) & 1) | ((b[0] >> 2) & 2) | ((b[0] >> 3) & 4) | ((b[0] >> 4) & 8), 4),
    floorLines: indices(b[1], 8), wallLineSelectors: lanes(b[2], b[3]),
    tiles: indices(b[4], 8), tileVariants: lanes(b[5], b[6]),
  };
  if (b[0] & 0x55) cell.unknownWallBits = b[0] & 0x55;
  return cell;
}
function encodeCell(cell: Cell): Uint8Array {
  let wall = 0;
  for (const n of cell.walls) wall |= 2 << (2 * integer(n, 3, "wall direction"));
  const unknown = integer(cell.unknownWallBits ?? 0, 255, "unknown wall bits");
  if (unknown & 0xaa) throw new Error("Unknown wall bits overlap wall directions");
  const [sl, sh] = unlanes(cell.wallLineSelectors), [tl, th] = unlanes(cell.tileVariants);
  return Uint8Array.of(wall | unknown, mask(cell.floorLines, 7), sl, sh, mask(cell.tiles, 7), tl, th);
}

// Parameters are bit slices of byte 0 (flags) and byte 3 (argument).
type Field = [name: string, byte: 0 | 3, shift: number, bits: number];
const CLASSES: Record<number, { name: ObjectClass; fields: Field[] }> = {
  1: { name: "sur-marker", fields: [["unknownOrientation", 0, 4, 3], ["kind", 3, 0, 8]] }, // DOS 0:81ed
  2: { name: "door", fields: [["orientation", 0, 4, 3], ["side", 3, 0, 2], ["group", 3, 2, 3], ["initialOpenBits", 3, 5, 2], ["blownOpen", 3, 7, 1]] }, // 0:6abb; h0:7292
  3: { name: "tel", fields: [["orientation", 0, 4, 3], ["linkId", 3, 0, 2], ["unknownArgument", 3, 2, 6]] }, // 0:4a69
  4: { name: "switch", fields: [["orientation", 0, 4, 3], ["group", 3, 0, 3], ["secondGroupOrFloor", 3, 3, 3], ["action", 3, 6, 2]] }, // 0:7a0d; h0:12ccc
  5: { name: "squ", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  6: { name: "orb", fields: [["facing", 3, 0, 3]] }, // 0:471d: fractional coordinates
  7: { name: "cub", fields: [["orientation", 0, 4, 3], ["kind", 3, 0, 3], ["unknownArgument", 3, 3, 2], ["state", 3, 5, 3]] }, // 0:8c57
  8: { name: "entry", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] }, // 0:179c
  9: { name: "sur", fields: [["orientation", 0, 4, 3], ["protected", 3, 0, 1], ["conversationFlags", 3, 1, 7]] }, // 0:9c17; h0:6de2
  10: { name: "trk", fields: [["orientation", 0, 4, 3], ["group", 3, 0, 3], ["facing", 3, 3, 3], ["stateBit6", 3, 6, 1], ["fixedFacing", 3, 7, 1]] }, // 0:7249
  11: { name: "art", fields: [["orientation", 0, 4, 3], ["kind", 3, 0, 3], ["parameter", 3, 3, 3], ["unknownArgument", 3, 6, 2]] }, // 0:7fce
  12: { name: "dec", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  13: { name: "ven", fields: [["orientation", 0, 4, 3], ["creatureKind", 3, 0, 2], ["hostileLimit", 3, 2, 2], ["frameAndPeriodIndex", 3, 4, 2], ["off", 3, 6, 1], ["unknownArgument", 3, 7, 1]] }, // 0:4f58
  14: { name: "pan", fields: [["orientation", 0, 4, 3], ["onStep", 3, 0, 3], ["offStep", 3, 3, 3], ["speedIndex", 3, 6, 2]] }, // 0:83d7
  15: { name: "tub", fields: [["facing", 3, 0, 3]] },
  16: { name: "elc", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  17: { name: "exp", fields: [["orientation", 0, 4, 3], ["variant", 3, 0, 8]] },
  18: { name: "lift", fields: [["unknownOrientation", 0, 4, 3], ["arrival", 3, 0, 1], ["destination", 3, 1, 5], ["unknownArgument", 3, 6, 2]] }, // 0:63ee; h0:12c00
  20: { name: "laser", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  21: { name: "bar", fields: [["facing", 3, 0, 3]] },
  22: { name: "cgen", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 6], ["dormant", 3, 6, 1], ["playerTriggered", 3, 7, 1]] }, // 0:a0e8
  23: { name: "sli", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  24: { name: "hed", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  25: { name: "anm", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 8]] },
  26: { name: "dgen", fields: [["orientation", 0, 4, 3], ["unknownArgument", 3, 0, 6], ["dormant", 3, 6, 1], ["playerTriggered", 3, 7, 1]] },
};
// One four-byte object record (class/orientation, x, y, argument) as rooms and the room-save buffers hold it.
export function decodeObject(b: Uint8Array): ObjectSpec {
  const encodedType = (b[0] & 15) | ((b[0] & 128) >> 3), type = encodedType === 19 ? 21 : encodedType;
  const spec = CLASSES[type];
  const params: Record<string, number> = {};
  for (const [name, byte, shift, bits] of spec?.fields ?? [["unknownFlags", 0, 4, 3], ["unknownArgument", 3, 0, 8]] as Field[]) params[name] = (b[byte] >> shift) & ((1 << bits) - 1);
  const fine = type === 6 || type === 15 || type === 21;
  return {
    class: spec?.name ?? `unknown-${type}`, ...(encodedType === 19 ? { encodedClass: 19 as const } : {}),
    x: b[1] + (fine ? ((b[0] & 0x70) | ((b[3] & 8) << 4)) / 256 : 0),
    y: b[2] + (fine ? (b[3] & 0xf0) / 256 : 0), params,
  };
}
export function encodeObject(obj: ObjectSpec): Uint8Array {
  const entry = Object.entries(CLASSES).find(([, value]) => value.name === obj.class);
  const type = obj.encodedClass ?? (entry ? Number(entry[0]) : Number(obj.class.replace(/^unknown-/, "")));
  integer(type, 31, "object class", 1);
  if (obj.encodedClass && obj.class !== "bar") throw new Error("Encoded class 19 is only valid for bar");
  const fine = type === 6 || type === 15 || type === 19 || type === 21;
  if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) throw new Error("Object coordinates must be finite");
  const x = Math.floor(obj.x), y = Math.floor(obj.y);
  const xf = integer((obj.x - x) * 16, fine ? 15 : 0, "object x fraction") * 16;
  const yf = integer((obj.y - y) * 16, fine ? 15 : 0, "object y fraction") * 16;
  const b = Uint8Array.of((type & 15) | ((type & 16) << 3) | (xf & 0x70), integer(x, 255, "object x"), integer(y, 255, "object y"), (xf >> 4) & 8 | yf);
  const fields: Field[] = entry?.[1].fields ?? [["unknownFlags", 0, 4, 3], ["unknownArgument", 3, 0, 8]];
  for (const [name, byte, shift, bits] of fields) b[byte] |= integer(obj.params[name], (1 << bits) - 1, `${obj.class}.${name}`) << shift;
  return b;
}

function decodeDialogue(b: Uint8Array): Dialogue {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), word = (at: number) => v.getUint16(at, true);
  const count = word(0x100), end = 0x102 + count * 26;
  if (end > b.length) throw new Error("Truncated dialogue records");
  return {
    unknownPrefix: hex(b.subarray(0, 2)), palette1: b[2], palette2: b[3], appearance: b[4], patience: b[5],
    speed: b[6], initialMode: b[7], behavior: b[8], interaction: b[9], grabMode: b[10], answerAllowance: b[11],
    topics: Array.from({ length: 20 }, (_, i) => ({ textOffset: word(12 + i * 12), replies: Array.from({ length: 5 }, (_, j) => word(14 + i * 12 + j * 2)) })),
    wakeTextOffset: word(0xfc), interactionTextOffset: word(0xfe),
    replies: Array.from({ length: count }, (_, i) => ({ textOffset: word(0x102 + i * 26), responses: Array.from({ length: 6 }, (_, j) => word(0x104 + i * 26 + j * 2)), nextTopics: Array.from({ length: 6 }, (_, j) => word(0x110 + i * 26 + j * 2)) })),
    textPool: latin1(b.subarray(end)),
  };
}
function encodeDialogue(d: Dialogue): Uint8Array {
  if (bytesOf(d.unknownPrefix).length !== 2 || d.topics.length !== 20) throw new Error("Dialogue needs two unknown prefix bytes and 20 topic slots");
  const pool = textBytes(d.textPool), b = new Uint8Array(0x102 + d.replies.length * 26 + pool.length), v = new DataView(b.buffer);
  const word = (at: number, n: number) => v.setUint16(at, integer(n, 65535, "dialogue word"), true);
  b.set(bytesOf(d.unknownPrefix));
  b.set([d.palette1, d.palette2, d.appearance, d.patience, d.speed, d.initialMode, d.behavior, d.interaction, d.grabMode, d.answerAllowance].map(n => integer(n, 255, "dialogue metadata")), 2);
  for (const [i, t] of d.topics.entries()) {
    if (t.replies.length !== 5) throw new Error("Topic needs five reply slots");
    word(12 + i * 12, t.textOffset); t.replies.forEach((n, j) => word(14 + i * 12 + j * 2, n));
  }
  word(0xfc, d.wakeTextOffset); word(0xfe, d.interactionTextOffset); word(0x100, d.replies.length);
  for (const [i, r] of d.replies.entries()) {
    if (r.responses.length !== 6 || r.nextTopics.length !== 6) throw new Error("Reply needs six response and next-topic slots");
    word(0x102 + i * 26, r.textOffset); r.responses.forEach((n, j) => word(0x104 + i * 26 + j * 2, n)); r.nextTopics.forEach((n, j) => word(0x110 + i * 26 + j * 2, n));
  }
  b.set(pool, 0x102 + d.replies.length * 26); return b;
}

export function decodeRoomBlock(bytes: Uint8Array): Room {
  if (bytes.length < BLOCK_SIZE + 4) throw new Error("Truncated room block");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const room: Room = { scene: 0, message: "", objects: [], cellLegend: {}, cells: [], chunks: [], terminator: 0, unknown: [], afterTerminator: "" };
  const keep = (at: number, end: number) => { if (end > at) room.unknown.push({ at, bytes: hex(bytes.subarray(at, end)) }); };
  keep(0, 30);
  let objectAt = 30;
  while (objectAt < 0x76 && (bytes[objectAt] & 0x8f)) { room.objects.push(decodeObject(bytes.subarray(objectAt, objectAt + 4))); objectAt += 4; }
  keep(objectAt, 0x76);
  let messageEnd = bytes.indexOf(0, 0x76); if (messageEnd < 0 || messageEnd > CELLS_AT) messageEnd = CELLS_AT;
  room.message = latin1(bytes.subarray(0x76, messageEnd)); keep(messageEnd, CELLS_AT);
  const legend = new Map<string, string>();
  for (let row = 0; row < 13; row++) {
    const tokens: string[] = [];
    for (let col = 0; col < 10; col++) {
      const at = CELLS_AT + (row * 10 + col) * 7, raw = bytes.subarray(at, at + 7), key = hex(raw);
      let token = legend.get(key);
      if (!token) { token = `c${legend.size}`; legend.set(key, token); room.cellLegend[token] = decodeCell(raw); }
      tokens.push(token);
    }
    room.cells.push(tokens.join(" "));
  }
  keep(0x424, BLOCK_SIZE);
  let at = BLOCK_SIZE;
  while (at + 4 <= bytes.length) {
    const type = v.getUint16(at, true), size = v.getUint16(at + 2, true); at += 4;
    if (!size) { room.terminator = type; room.afterTerminator = hex(bytes.subarray(at)); return room; }
    if (at + size > bytes.length) throw new Error("Truncated room chunk");
    const data = bytes.subarray(at, at + size), word = (i: number) => v.getUint16(at + i, true), signed = (i: number) => v.getInt16(at + i, true);
    if (type === 10) {
      const pieces: Piece[] = [];
      for (let i = 0; i + 5 <= size; i += 5) { const y = word(i + 3); pieces.push({ index: data[i], x: signed(i + 1), y: y & 0x3fff, foreground: !!(y & 0x8000), offscreen: !!(y & 0x4000) }); }
      room.chunks.push({ kind: "pieces", pieces, ...(size % 5 ? { unknown: hex(data.subarray(size - size % 5)) } : {}) });
    } else if (type === 11) {
      const drops: Drop[] = [];
      for (let i = 0; i + 8 <= size; i += 8) { const mode = data[i + 7]; drops.push({ x0: word(i), y0: word(i + 2), x1: word(i + 4), color: data[i + 6], spacing: (mode & 7) + 1, upward: !!(mode & 8), step: ((mode >> 4) & 7) + 1, rising: !!(mode & 128) }); }
      room.chunks.push({ kind: "drops", drops, ...(size % 8 ? { unknown: hex(data.subarray(size - size % 8)) } : {}) });
    } else if (type === 17) {
      const lines: Line[] = [];
      for (let i = 0; i + 10 <= size; i += 10) lines.push({ x0: word(i), y0: word(i + 2), x1: word(i + 4), y1: word(i + 6), outer: data[i + 8], inner: data[i + 9] });
      room.chunks.push({ kind: "lines", lines, ...(size % 10 ? { unknown: hex(data.subarray(size - size % 10)) } : {}) });
    } else if (type === 14) room.chunks.push({ kind: "dialogue", dialogue: decodeDialogue(data) });
    else room.chunks.push({ kind: "unknown", type, bytes: hex(data) });
    at += size;
  }
  throw new Error("Missing room terminator");
}

function encodeChunk(chunk: RoomChunk): Uint8Array {
  let type: number, data: Uint8Array;
  if (chunk.kind === "dialogue") { type = 14; data = encodeDialogue(chunk.dialogue); }
  else if (chunk.kind === "unknown") { type = integer(chunk.type, 65535, "chunk type"); data = bytesOf(chunk.bytes); }
  else {
    const records = chunk.kind === "pieces" ? chunk.pieces : chunk.kind === "drops" ? chunk.drops : chunk.lines;
    const stride = chunk.kind === "pieces" ? 5 : chunk.kind === "drops" ? 8 : 10;
    type = chunk.kind === "pieces" ? 10 : chunk.kind === "drops" ? 11 : 17;
    const rest = bytesOf(chunk.unknown ?? ""); data = new Uint8Array(records.length * stride + rest.length);
    const v = new DataView(data.buffer), word = (at: number, n: number) => v.setUint16(at, integer(n, 65535, "chunk coordinate"), true);
    if (chunk.kind === "pieces") chunk.pieces.forEach((p, i) => {
      const at = i * 5; data[at] = integer(p.index, 255, "piece index"); v.setInt16(at + 1, integer(p.x, 32767, "piece x", -32768), true);
      word(at + 3, integer(p.y, 0x3fff, "piece y") | (p.foreground ? 0x8000 : 0) | (p.offscreen ? 0x4000 : 0));
    });
    else if (chunk.kind === "drops") chunk.drops.forEach((d, i) => {
      const at = i * 8; word(at, d.x0); word(at + 2, d.y0); word(at + 4, d.x1); data[at + 6] = integer(d.color, 255, "drop color");
      data[at + 7] = (integer(d.spacing, 8, "drop spacing", 1) - 1) | (d.upward ? 8 : 0) | ((integer(d.step, 8, "drop step", 1) - 1) << 4) | (d.rising ? 128 : 0);
    });
    else chunk.lines.forEach((l, i) => { const at = i * 10; word(at, l.x0); word(at + 2, l.y0); word(at + 4, l.x1); word(at + 6, l.y1); data[at + 8] = integer(l.outer, 255, "line outer"); data[at + 9] = integer(l.inner, 255, "line inner"); });
    data.set(rest, records.length * stride);
  }
  if (!data.length) throw new Error("Zero-size chunk is a terminator, not a data chunk");
  const b = new Uint8Array(data.length + 4), v = new DataView(b.buffer);
  v.setUint16(0, type, true); v.setUint16(2, integer(data.length, 65535, "chunk size"), true); b.set(data, 4); return b;
}

export function encodeRoomBlock(room: Room): Uint8Array {
  if (room.objects.length > 22 || room.cells.length !== 13) throw new Error("Room needs at most 22 objects and exactly 13 cell rows");
  const chunks = room.chunks.map(encodeChunk), end = BLOCK_SIZE + chunks.reduce((n, b) => n + b.length, 0) + 4;
  const trailing = bytesOf(room.afterTerminator);
  const size = Math.max(end + trailing.length, ...room.unknown.map(u => u.at + bytesOf(u.bytes).length));
  const b = new Uint8Array(size);
  for (const u of room.unknown) b.set(bytesOf(u.bytes), integer(u.at, size, "unknown offset"));
  // Unknown object/message padding can contain stale records; the active fields always win.
  room.objects.forEach((obj, i) => b.set(encodeObject(obj), 30 + i * 4));
  if (room.objects.length < 22) b[30 + room.objects.length * 4] &= 0x70;
  const message = textBytes(room.message);
  if (message.length > 32) throw new Error("Room message exceeds 32 bytes");
  b.set(message, 0x76); if (message.length < 32) b[0x76 + message.length] = 0;
  for (const [row, text] of room.cells.entries()) {
    const tokens = text.trim().split(/\s+/); if (tokens.length !== 10) throw new Error(`Cell row ${row} needs ten tokens`);
    tokens.forEach((token, col) => { const cell = room.cellLegend[token]; if (!cell) throw new Error(`Unknown cell token ${token}`); b.set(encodeCell(cell), CELLS_AT + (row * 10 + col) * 7); });
  }
  let at = BLOCK_SIZE; for (const chunk of chunks) { b.set(chunk, at); at += chunk.length; }
  const v = new DataView(b.buffer); v.setUint16(at, integer(room.terminator, 65535, "terminator"), true); v.setUint16(at + 2, 0, true);
  b.set(trailing, at + 4);
  return b;
}

export function parseFloor(text: string): Floor {
  const floor = JSON5.parse<Floor>(text);
  if (floor.format !== "d-generation-aga-floor" || !Array.isArray(floor.rooms)) throw new Error("Not an AGA floor file");
  integer(floor.floor, 10, "floor", 1);
  for (const room of floor.rooms) encodeRoomBlock(room);
  return floor;
}

export function decodeMap(bytes: Uint8Array, bank: number): FloorMap {
  if (bytes.length < 143) throw new Error("Truncated MAPMTX grid");
  integer(bank, 2, "map bank");
  return { bank, rows: Array.from({ length: 13 }, (_, row) => Array.from(bytes.subarray(row * 11, row * 11 + 11), n => n === 255 ? null : n + bank * 50 + 1)), unknown: bytes.length > 143 ? [{ at: 143, bytes: hex(bytes.subarray(143)) }] : [] };
}
export function encodeMap(map: FloorMap): Uint8Array {
  if (map.rows.length !== 13 || map.rows.some(row => row.length !== 11)) throw new Error("Map needs 13 rows of 11 columns");
  const size = Math.max(143, ...map.unknown.map(u => u.at + bytesOf(u.bytes).length)), b = new Uint8Array(size);
  for (const u of map.unknown) b.set(bytesOf(u.bytes), u.at);
  integer(map.bank, 2, "map bank");
  map.rows.flat().forEach((n, i) => { b[i] = n === null ? 255 : integer(n - map.bank * 50 - 1, 254, "map scene"); });
  return b;
}

const LEGEND = `// AGA floor; see ./levels/README.md for field semantics and evidence.\n// Scene numbers are 1-based; buildingFloor starts at 80; starts includes alternate arrivals.\n// grid connections are map candidates: room collision/doors still gate boundary crossings.\n// Grid directions 0..3 = north,east,south,west; map is this floor's full MAPMTX bank.\n// Object x/y are world coordinates; orb/tub/bar retain 1/16-unit position fractions.\n// encodedClass:19 preserves the disk alias rewritten to bar (class21) by the loader.\n// cells: 13 rows x 10 tokens referencing this room's cellLegend.\n// walls: directions 0..3 -> bits 1,3,5,7. floorLines/tiles: bit indexes 0..7.\n// wallLineSelectors/tileVariants: eight 2-bit digits, bit 0 first (low + 2*high).\n// Tall wall d uses selector lane 2*d bit 0; wall scheme/frame uses lane 2*d+1.\n// Lines also read preceding selector lane's low bit as color bit 2.\n// Piece y stores bits 0..13; foreground/offscreen preserve bits 15/14.\n// Dialogue text offsets are 1-based byte offsets in textPool; zero means absent.\n// unknown: exact hex bytes at room-block offsets; afterTerminator follows the final header.\n`;
export function stringifyFloor(floor: Floor): string {
  const quote = (value: unknown): string => {
    const text = JSON.stringify(value);
    return text.replace(/[\u007f-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  };
  const emit = (value: unknown, depth: number): string => {
    const indent = "  ".repeat(depth), next = "  ".repeat(depth + 1);
    if (value === null || typeof value !== "object") return quote(value);
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      if (value.every(v => v === null || typeof v !== "object") && JSON.stringify(value).length < 140) return `[${value.map(v => emit(v, depth)).join(", ")}]`;
      return `[\n${value.map(v => `${next}${emit(v, depth + 1)},`).join("\n")}\n${indent}]`;
    }
    const entries = Object.entries(value), inline = JSON.stringify(value);
    if (inline.length < 165 && !entries.some(([, v]) => v && typeof v === "object" && !Array.isArray(v))) return `{ ${entries.map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${emit(v, depth)}`).join(", ")} }`;
    return `{\n${entries.map(([k, v]) => `${next}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${emit(v, depth + 1)},`).join("\n")}\n${indent}}`;
  };
  return LEGEND + emit(floor, 0) + "\n";
}
