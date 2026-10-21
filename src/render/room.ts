import { drawDelta, type DeltaSet } from "../formats/delta.ts";
import { cellAt, COLS, ROWS, type Scene } from "../formats/scene.ts";
import { frameAt, type ShapeNode } from "../formats/shape.ts";
import type { Screen } from "./screen.ts";

// Static room drawing, following GAME.EXE 0:238a. Objects (doors, lifts, enemies) are not drawn yet.

export interface RoomAssets {
  tile: ShapeNode[]; // TILE.VGA  [variant][slot]
  wall: ShapeNode[]; // WALL.VGA  [direction][frame]
  tallWall: ShapeNode[]; // TWALL.VGA [direction][0]
  deltas: DeltaSet;
  backdrop: Uint8Array; // BACK1.DAT, 320x200
}

// Color schemes picked by wall data: 0 = BLUE.PAL, 1 = GREEN.PAL, 3 = RED.PAL (GAME.EXE 0:149a).
export type Scheme = 0 | 1 | 3;

// Room origin on screen (GAME.EXE 0:0e18 sets 10, 4) and cell pitch: 14 world units, x doubled.
const ORIGIN_X = 10;
const ORIGIN_Y = 4;
const CELL = 14;

const TILE_OFFSETS = [[18, 2], [18, 2], [18, 9], [18, 9], [4, 9], [4, 9], [4, 2], [4, 2]]; // DS:265c
const WALL_OFFSETS = [[14, 0], [14, 7], [0, 7], [0, 0]]; // DS:263c, by direction
const WALL_BITS = [0x80, 0x02, 0x20, 0x08]; // DS:2638, drawing order
const LINE_STEPS = [[-1, 0], [-1, 2], [0, 2], [1, 2], [1, 0], [1, -2], [0, -2], [-1, -2]]; // DS:007e, [dy, dx]
const LINE_COLORS = [0xb3, 0xb5, 0xb7, 0xb1, 0xb3, 0xb5, 0xb7, 0xb1]; // DS:2680
const TALL_WALL_RISE = 0x24;
const NO_WALLS_SCENE = 138; // index 0x89: walls skipped, scheme forced to red
const VIEW_BOTTOM = 181; // play view clip row (GAME.EXE 0:271c)

export function renderRoom(screen: Screen, scene: Scene, sceneNumber: number, assets: RoomAssets): Scheme {
  let scheme: Scheme = 0;
  screen.bottom = VIEW_BOTTOM;
  screen.clear();
  drawTiles(screen, scene, assets);
  drawFloorLines(screen, scene);
  drawPieces(screen, scene, assets, false);
  if (sceneNumber === NO_WALLS_SCENE) {
    scheme = 3;
  } else {
    scheme = drawWalls(screen, scene, assets, false, scheme);
    scheme = drawWalls(screen, scene, assets, true, scheme);
  }
  drawDrops(screen, scene);
  drawLines(screen, scene);
  drawPieces(screen, scene, assets, true);
  return scheme;
}

// Draws a three-pixel dash per step: outer, inner, outer (GAME.EXE 0:0776).
function dashLine(screen: Screen, x: number, y: number, inner: number, outer: number, direction: number, steps: number): void {
  const [dy, dx] = LINE_STEPS[direction];
  y--;
  for (let i = 0; i < steps; i++) {
    screen.plot(x, y, outer);
    screen.plot(x + 1, y, inner);
    screen.plot(x + 2, y, outer);
    x += dx;
    y += dy;
  }
}

// Floor quarter tiles from cell byte 4 (GAME.EXE fff:1350).
function drawTiles(screen: Screen, scene: Scene, assets: RoomAssets): void {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cellAt(scene, row, col);
      const x = (col * CELL - 2 + ORIGIN_X) * 2;
      const y = row * CELL - 2 + ORIGIN_Y + 9;
      for (let slot = 0; slot < 8; slot++) {
        const bit = 1 << slot;
        if (!(cell[4] & bit)) continue;
        // VGA only has the plain and the variant-3 tile.
        const variant = (cell[5] & bit ? 1 : 0) + (cell[6] & bit ? 2 : 0) === 3 ? 3 : 0;
        const frame = frameAt(assets.tile, variant, slot);
        const [ox, oy] = TILE_OFFSETS[slot];
        screen.blit(frame, x + ox + frame.x, y + oy - frame.height - frame.y + 3, { shift: row - 1, schemeOnly: true });
      }
    }
  }
}

// Floor grid lines from cell byte 1, colors from bytes 2 and 3 (GAME.EXE 0:e171).
function drawFloorLines(screen: Screen, scene: Scene): void {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cellAt(scene, row, col);
      const x = (col * CELL - 2 + ORIGIN_X + 8) * 2;
      const y = row * CELL - 2 + ORIGIN_Y + 17;
      for (let direction = 0; direction < 8; direction++) {
        const bit = 1 << direction;
        if (!(cell[1] & bit)) continue;
        const shade = (cell[2] & bit ? 1 : 0) + (cell[3] & bit ? 2 : 0) + ((cell[2] << 1) & bit ? 4 : 0);
        const color = LINE_COLORS[shade];
        dashLine(screen, x, y - 2, color, color + 1, direction, 8);
      }
    }
  }
}

// DLTSET pieces listed by the scene (GAME.EXE 0:c174). Foreground pieces with y bit 14 keep bit 15 and land
// at a negative y; every other piece drops bit 15, so a set bit 14 puts it far below the screen.
function drawPieces(screen: Screen, scene: Scene, assets: RoomAssets, foreground: boolean): void {
  for (const piece of scene.pieces) {
    const entry = assets.deltas.entries[piece.index];
    if (piece.foreground !== foreground || !entry) continue;
    const y = foreground && piece.y & 0x4000 ? (piece.y | 0x8000) - 0x10000 : piece.y & 0x7fff;
    drawDelta(screen, entry, piece.x, y, assets.backdrop);
  }
}

// Neighbor wall bits used to trim wall joins (GAME.EXE fff:1252): the left cell's 0x0a bits
// (tall pass: only tall ones) and the right cell's 0xa0 bits that are tall.
function neighborWalls(scene: Scene, row: number, col: number, tall: boolean): [number, number] {
  let left = 0;
  let right = 0;
  if (col > 0) {
    const cell = cellAt(scene, row, col - 1);
    left = cell[0] & 0x0a & (tall ? (cell[2] & 0x55) << 1 : 0xff);
  }
  if (col < COLS - 1) {
    const cell = cellAt(scene, row, col + 1);
    right = cell[0] & 0xa0 & ((cell[2] & 0x55) << 1);
  }
  return [left, right];
}

// Walls from cell byte 0; the tall pass adds TWALL tops where byte 2 has bit >> 1 set (GAME.EXE fff:190f).
// Colors in the scheme range are shifted by row - 1 for depth.
function drawWalls(screen: Screen, scene: Scene, assets: RoomAssets, tall: boolean, scheme: Scheme): Scheme {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cellAt(scene, row, col);
      const mask = cell[0] & 0xaa & (tall ? (cell[2] << 1) & 0xff : 0xff);
      if (!mask) continue;
      const x = (col * CELL - 2 + ORIGIN_X) * 2;
      const y = row * CELL - 2 + ORIGIN_Y;
      const [left, right] = neighborWalls(scene, row, col, tall);
      for (const bit of WALL_BITS) {
        if (!(mask & bit)) continue;
        // Bits 0x02/0x08/0x20/0x80 map to directions 0..3.
        const direction = Math.log2(bit) >> 1;
        // Trim columns where this wall meets another one in the same or a neighboring cell (fff:1741, fff:17e0).
        let skipLeft = 0;
        let skipRight = 0;
        if ((direction === 2 && mask & 0x08) || (direction === 3 && mask & 0x02)) skipRight = 3;
        else if ((direction === 0 && mask & 0x80) || (direction === 1 && mask & 0x20)) skipLeft = 4;
        if ((direction === 2 && left & 0x08) || (direction === 3 && left & 0x02)) skipLeft = 4;
        else if ((direction === 0 && right & 0x80) || (direction === 1 && right & 0x20)) skipRight = 3;
        const state = (cell[2] & bit ? 1 : 0) + (cell[3] & bit ? 2 : 0);
        if (state !== 2) scheme = state as Scheme;
        const [ox, oy] = WALL_OFFSETS[direction];
        const options = { shift: row - 1, schemeOnly: true, skipLeft, skipRight };
        if (tall) {
          const frame = frameAt(assets.tallWall, direction, 0);
          screen.blit(frame, x + ox + frame.x, y + oy - TALL_WALL_RISE - frame.y - 3, options);
        } else {
          const frame = frameAt(assets.wall, direction, state === 2 ? 1 : 0);
          screen.blit(frame, x + ox + frame.x, y + oy - frame.y - 2, options);
        }
      }
    }
  }
  return scheme;
}

// Dotted column from (x, y) down (or up with mode bit 3) over empty (0) and see-through (0xfd) pixels,
// one dot every mode & 7 + 1 rows; stops at any other pixel (GAME.EXE VGA 23ac:012f).
// Going down it may write one row past the view clip, like the original.
function dropColumn(screen: Screen, x: number, y: number, color: number, mode: number): void {
  if (x < 0 || x >= screen.width || y < 0 || y >= screen.height) return;
  const up = (mode & 8) !== 0;
  const gap = Math.min((mode & 7) + 1, 7);
  const step = up ? -1 : 1;
  const pixel = (row: number) => (row >= 0 && row < screen.height ? screen.get(x, row) : 1);
  let rows = up ? y : screen.bottom + 1 - y;
  for (;;) {
    if (rows < 0) return;
    const under = pixel(y);
    if (under !== 0 && under !== 0xfd) return;
    screen.pixels[y * screen.width + x] = color;
    // Skip ahead up to gap rows while empty, passing over 0xfd without resetting the gap.
    for (let left = gap; ; ) {
      y += step;
      rows--;
      left--;
      if (left !== 0 && pixel(y) === 0) continue;
      if (left !== 0 && pixel(y) === 0xfd) continue;
      break;
    }
  }
}

function drawDrops(screen: Screen, scene: Scene): void {
  for (const drop of scene.drops) {
    const step = ((drop.mode >> 4) & 7) + 1;
    const slope = drop.mode & 0x80 ? -step : step;
    for (let x = drop.x0, y2 = drop.y0 * 2; x <= drop.x1; x += step, y2 += slope) {
      dropColumn(screen, x, y2 >> 1, drop.color, drop.mode & 0xf);
    }
  }
}

function drawLines(screen: Screen, scene: Scene): void {
  for (const line of scene.lines) {
    const dx = line.x1 - line.x0;
    const dy = line.y1 - line.y0;
    const direction = dx < 0 ? (dy >= 0 ? 5 : 7) : dy >= 0 ? 3 : 1;
    dashLine(screen, line.x0, line.y0 + 1, line.inner, line.outer, direction, (Math.abs(dx) >> 1) + 1);
  }
}
