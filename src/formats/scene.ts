// DATA/SCENE<n>.DLT rooms (loader GAME.EXE 0:354e).
//
// A fixed 1072-byte block followed by tagged chunks (type word, size word, data).
// Block layout so far:
//   0x076  room message, NUL-terminated
//   0x096  13 rows x 10 columns of 7-byte cells (row stride 70)
// The rest of the block (object records from 0x01e) is not decoded yet.
//
// Cell bytes, one bit per direction/slot:
//   0     wall bits (mask 0xaa), see WALL_BITS in render/room.ts
//   1     floor line bits, 8 directions
//   2, 3  per-bit selectors: line color, wall frame/scheme, tall-wall flag (byte 2 bit << 1)
//   4     floor tile bits, 8 quarter-tile slots
//   5, 6  per-bit tile variant

export const ROWS = 13;
export const COLS = 10;
const CELL_SIZE = 7;
const BLOCK_SIZE = 0x430;
const MESSAGE_AT = 0x76;
const CELLS_AT = 0x96;

// Scene files present in DATA/: 1-46, 51-92, 101-142 (one range per level).
export const SCENE_NUMBERS = [
  ...Array.from({ length: 46 }, (_, i) => 1 + i),
  ...Array.from({ length: 42 }, (_, i) => 51 + i),
  ...Array.from({ length: 42 }, (_, i) => 101 + i),
];

// DLTSET piece placed on the room; hidden pieces are revealed by game events.
export interface Piece {
  index: number;
  x: number;
  y: number;
  foreground: boolean;
  hidden: boolean;
}

// Dotted vertical drops along a 2:1 slanted run (drawer GAME.EXE 0:c015).
export interface Drop {
  x0: number;
  y0: number;
  x1: number;
  color: number;
  mode: number;
}

// Three-pixel-wide isometric line (drawer GAME.EXE 0:c0d2).
export interface Line {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  inner: number;
  outer: number;
}

export interface Scene {
  message: string;
  cells: Uint8Array;
  pieces: Piece[];
  drops: Drop[];
  lines: Line[];
}

export function cellAt(scene: Scene, row: number, col: number): Uint8Array {
  const at = (row * COLS + col) * CELL_SIZE;
  return scene.cells.subarray(at, at + CELL_SIZE);
}

export function parseScene(bytes: Uint8Array): Scene {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.indexOf(0, MESSAGE_AT);
  const scene: Scene = {
    message: new TextDecoder("latin1").decode(bytes.subarray(MESSAGE_AT, end < 0 || end > CELLS_AT ? CELLS_AT : end)),
    cells: bytes.slice(CELLS_AT, CELLS_AT + ROWS * COLS * CELL_SIZE),
    pieces: [],
    drops: [],
    lines: [],
  };

  for (let at = BLOCK_SIZE; at + 4 <= bytes.length; ) {
    const type = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    at += 4;
    const word = (offset: number) => view.getUint16(at + offset, true);
    switch (type) {
      case 0x0a:
        for (let i = 0; i + 5 <= size; i += 5) {
          const y = word(i + 3);
          scene.pieces.push({
            index: bytes[at + i],
            x: word(i + 1),
            y: y & 0x3fff,
            foreground: (y & 0x8000) !== 0,
            hidden: (y & 0x4000) !== 0,
          });
        }
        break;
      case 0x0b:
        for (let i = 0; i + 8 <= size; i += 8) {
          scene.drops.push({ x0: word(i), y0: word(i + 2), x1: word(i + 4), color: bytes[at + i + 6], mode: bytes[at + i + 7] });
        }
        break;
      case 0x11:
        for (let i = 0; i + 10 <= size; i += 10) {
          const colors = word(i + 8);
          scene.lines.push({ x0: word(i), y0: word(i + 2), x1: word(i + 4), y1: word(i + 6), inner: colors >> 8, outer: colors & 0xff });
        }
        break;
    }
    at += size;
  }
  return scene;
}

// Rooms use DLTSET1 (scenes 1-51) or DLTSET2; a few have their own set (GAME.EXE tables 0x470/0x484).
const SPECIAL_DELTA_SETS: Record<number, number> = { 1: 20, 40: 22, 21: 23, 51: 24, 101: 25, 142: 27, 138: 60, 107: 33, 134: 51 };

export function deltaSetFor(sceneNumber: number): number {
  return SPECIAL_DELTA_SETS[sceneNumber] ?? (sceneNumber <= 51 ? 1 : 2);
}
