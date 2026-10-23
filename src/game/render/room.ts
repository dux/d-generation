import { drawDelta, type DeltaSet } from "../../formats/delta.ts";
import type { Drop, Line, Room } from "../../formats/level.ts";
import type { Palette } from "../../formats/palette.ts";
import { frameAt, type Frame, type ShapeNode } from "../../formats/shape.ts";
import type { Screen } from "../../render/screen.ts";
import type { AgaAssets } from "./assets.ts";
import { createRuntimeRoom, type RuntimeRoom } from "../core/model.ts";

// Static room drawing of the AGA release (h0:1250, DOS 0:238a). Objects are drawn by the object system.
// The screen is the game's draw buffer: an 8-bitplane interleaved bitmap, here one palette index per pixel.

// g:19dc after drawing: 0/1/3 put BLUE/GREEN/RED.PAL over colours 32..79, 4 the room's SCENE<n>.PAL
// (h0:b0a0 picks g:db06/db02/dafe/db0a).
export type Scheme = 0 | 1 | 3 | 4;

const ROWS = 13;
const COLS = 10;
const CELL = 14; // world units per cell, x doubled on screen
const ORIGIN_X = 10; // g:872c/g:872e, set by h0:ada2
const ORIGIN_Y = 4;
const VIEW_BOTTOM = 181; // g:8c68: blits stop above it, plots reach it

const TILE = 32; // shape set ids: TILE [variant][slot], WALL [direction][frame], TWALL [direction][0]
const WALL = 30;
const TALL_WALL = 34;

const TILE_OFFSETS = [[18, 2], [18, 2], [18, 9], [18, 9], [4, 9], [4, 9], [4, 2], [4, 2]]; // g:28ec
const WALL_BITS = [0x80, 0x02, 0x20, 0x08]; // g:28c8, drawing order
const WALL_OFFSETS = [[14, 0], [14, 7], [0, 7], [0, 0]]; // g:28cc, by direction
const LINE_STEPS = [[-1, 0], [-1, 2], [0, 2], [1, 2], [1, 0], [1, -2], [0, -2], [-1, -2]]; // g:52c, [dy, dx]
const LINE_COLORS = [0xb3, 0xb5, 0xb7, 0xb1, 0xb3, 0xb5, 0xb7, 0xb1]; // g:2910
const TALL_WALL_RISE = 0x24;

// g:2dc/g:2fc: rooms with their own delta set, or (-1) a full-screen scene image instead.
const SPECIAL_ROOMS = new Map<number, number>([
  [1, 20], [40, 22], [21, 23], [51, 24], [101, 25], [142, 27], [138, 60], [107, 33], [6, 53], [121, 54],
  [139, -1], [114, -1], [58, -1], [103, -1], [145, -1],
]);
// h0:134c..13b2: special rooms drawn without walls and the scheme they force. Scene 146 is listed too but is
// not in g:2dc, so it takes the ordinary path and keeps its walls.
const NO_WALLS = new Map<number, Scheme>([[114, 4], [138, 3], [139, 4], [146, 4], [58, 0], [145, 4]]);
const GENOQ_SCENE = 103; // genoq.vim, drawn by h0:12a6
// h0:1448..1472: these rooms set colours 224..231 through h0:fa9c(14, 16, 32) from g:206c and g:1fb8.
const LIGHT_SCENES = [107, 118, 120, 128];
const LIGHT_COLORS = [28, 21, 17, 33, 24, 21, 37, 28, 24, 42, 32, 26, 46, 35, 30, 51, 40, 33, 56, 44, 37, 62, 48, 40];

const s16 = (v: number) => (v << 16) >> 16;

// Native cell (h0:bf34..c052): bit masks per cell, selector words split back into their two disk bytes.
interface CellBits {
  walls: number; // bits 0x02/0x08/0x20/0x80 = directions 0..3
  lines: number;
  select: number; // low bit of each wallLineSelectors lane (disk byte 2)
  selectHigh: number; // high bit (disk byte 3)
  tiles: number;
  variant: number; // tileVariants low bits (disk byte 5)
  variantHigh: number; // disk byte 6
}

function roomCells(grid: RuntimeRoom): CellBits[][] {
  if (grid.cells.length !== ROWS * COLS) throw new Error(`runtime room has ${grid.cells.length} cells`);
  return Array.from({ length: ROWS }, (_, row) => grid.cells.slice(row * COLS, row * COLS + COLS).map(cell => ({
    walls: cell.walls, lines: cell.floorLines,
    select: cell.wallVariants & 0xff, selectHigh: cell.wallVariants >> 8,
    tiles: cell.tiles, variant: cell.tileVariants & 0xff, variantHigh: cell.tileVariants >> 8,
  })));
}

// Name of the full-screen image a scene draws on (h0:12a6..12dc), if any.
export function roomImage(scene: number): string | undefined {
  if (SPECIAL_ROOMS.get(scene) !== -1) return undefined;
  return scene === GENOQ_SCENE ? "genoq" : `scene${scene}`;
}

// DLTSET number a scene loads (h0:1250 via h0:ca2a): its own (g:2fc), else by scene index; none for scenes
// with an image.
export function roomDeltaSet(scene: number): number | undefined {
  const special = SPECIAL_ROOMS.get(scene);
  if (special === -1) return undefined;
  return special ?? (scene - 1 > 100 ? 3 : scene - 1 > 50 ? 2 : 1);
}

// h0:1250 (DOS 0:238a) drawRoom(): clears the screen like h0:43a6 does before it, then draws floor tiles,
// floor lines, background pieces, walls, tall walls, drops, lines and foreground pieces. Special rooms use
// their own delta set or a scene image (load it first with assets.vim(roomImage(scene))).
// The scheme is left at `previous` when no wall sets it (g:19dc is not reset), as in scene 103.
// Cells are the grid as the room is entered: h0:1030 draws the room (h0:109a) before the spawn passes, so walls
// that objects set later (closed doors, h0:405e) are not in the room bitmap.
export function drawRoom(screen: Screen, room: Room, assets: AgaAssets, scene: number, previous: Scheme = 0): Scheme {
  const cells = roomCells(createRuntimeRoom(room));
  const set = roomDeltaSet(scene);
  screen.bottom = VIEW_BOTTOM;
  let deltas: DeltaSet | undefined;
  if (set === undefined) {
    // The scene image replaces the whole buffer; the delta set stays the previous room's (h0:ca2a is skipped).
    const name = roomImage(scene)!;
    const image = assets.vims.get(name);
    if (!image) throw new Error(`${name}.vim is not loaded`);
    screen.pixels.set(image);
  } else {
    deltas = assets.deltaSets.get(set);
    if (!deltas) throw new Error(`DLTSET${set} is not loaded`);
    screen.clear();
  }
  let scheme = previous;
  drawTiles(screen, cells, assets.shapes.get(TILE)!);
  drawFloorLines(screen, cells);
  drawPieces(screen, room, deltas, assets.backdrop, false);
  if (SPECIAL_ROOMS.has(scene) && NO_WALLS.has(scene)) {
    scheme = NO_WALLS.get(scene)!;
  } else {
    scheme = drawWalls(screen, cells, assets.shapes.get(WALL)!, false, scheme);
    scheme = drawWalls(screen, cells, assets.shapes.get(TALL_WALL)!, true, scheme);
  }
  for (const chunk of room.chunks) if (chunk.kind === "drops") chunk.drops.forEach((d) => drawDrop(screen, d));
  for (const chunk of room.chunks) if (chunk.kind === "lines") chunk.lines.forEach((l) => drawLine(screen, l));
  drawPieces(screen, room, deltas, assets.backdrop, true);
  return scheme;
}

// h0:1428..149a: the colour registers after entering a room with the given scheme, starting from DGEN.PAL.
// The original reloads DGEN.PAL only on entering scenes 1 and 69 or leaving 103 (h0:1428), so colours
// outside 32..79 set by an earlier room (scene 58, 103, the light rooms) carry over until then.
export function roomPalette(assets: AgaAssets, scene: number, scheme: Scheme): Palette {
  const { palettes } = assets;
  const pal = palettes.dgen.slice(0, 256 * 3);
  if (LIGHT_SCENES.includes(scene)) pal.set(LIGHT_COLORS.map((v) => v << 2), 224 * 3);
  if (scene === 58) {
    pal.set(palettes.scenes.get(58)!);
  } else if (scene === GENOQ_SCENE) {
    // h0:12b0 loads g:ecba, the copy of genoq.pal h0:28ea makes when the intro shows genoq.vim.
    pal.set(palettes.genoq);
  } else {
    const overlay = { 0: palettes.blue, 1: palettes.green, 3: palettes.red, 4: palettes.scenes.get(scene) }[scheme];
    if (!overlay) throw new Error(`scene ${scene} has no palette for scheme ${scheme}`);
    pal.set(overlay.subarray(0, 48 * 3), 32 * 3);
  }
  return pal;
}

// h10:16 blitShape through h0:d336: where the frame mask is set every bitplane is written, so colour 0 is
// opaque. Rows stop above screen.bottom. skipLeft/skipRight (g:8c55/g:8c54, wall joins only) clear mask bits
// in the first and the last 16-pixel word of each row.
function blitShape(screen: Screen, frame: Frame, x: number, y: number, skipLeft = 0, skipRight = 0): void {
  const { width, height, pixels, mask } = frame;
  const rowBits = ((width - 1) & 0xf0) + 16;
  const left = Math.min(skipLeft, 16);
  const right = Math.max(width - skipRight, rowBits - 16);
  for (let row = 0; row < height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= screen.bottom) continue;
    for (let col = 0; col < width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= screen.width || !mask![row * width + col]) continue;
      if (col < left || (skipRight && col >= right)) continue;
      screen.pixels[sy * screen.width + sx] = pixels[row * width + col];
    }
  }
}

// Screen position of a cell (h0:e72a, plus the room origin).
const cellX = (col: number) => (col * CELL - 2 + ORIGIN_X) * 2;
const cellY = (row: number) => row * CELL - 2 + ORIGIN_Y;

// h0:ac84 / h0:e9b6: quarter tiles from cell byte 4; variant 3 picks the second frame set, others the first.
// The depth shade argument (row - 1) is ignored by h0:d336, unlike on DOS.
function drawTiles(screen: Screen, cells: CellBits[][], tile: ShapeNode[]): void {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cells[row][col];
      const x = cellX(col);
      const y = cellY(row) + 9;
      for (let slot = 0; slot < 8; slot++) {
        const bit = 1 << slot; // g:2918
        if (!(cell.tiles & bit)) continue;
        const variant = (cell.variant & bit ? 1 : 0) + (cell.variantHigh & bit ? 2 : 0) === 3 ? 1 : 0;
        const frame = frameAt(tile, variant, slot);
        const [ox, oy] = TILE_OFFSETS[slot];
        blitShape(screen, frame, x + ox + frame.x, y + oy - (frame.height + frame.y) + 3);
      }
    }
  }
}

// h0:2560 dashLine(): outer, inner, outer pixel per step, starting one row up; plots clip like h0:d1d2.
function dashLine(screen: Screen, x: number, y: number, outer: number, inner: number, direction: number, steps: number): void {
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

// h0:ac3e / h0:ab10: floor grid lines from cell byte 1, colours from bytes 2 and 3.
function drawFloorLines(screen: Screen, cells: CellBits[][]): void {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cells[row][col];
      const x = cellX(col) + 16;
      const y = cellY(row) + 17;
      for (let direction = 0; direction < 8; direction++) {
        const bit = 1 << direction;
        if (!(cell.lines & bit)) continue;
        const shade = (cell.select & bit ? 1 : 0) + (cell.selectHigh & bit ? 2 : 0) + ((cell.select << 1) & bit ? 4 : 0);
        const color = LINE_COLORS[shade];
        dashLine(screen, x, y - 2, color + 1, color, direction, 8);
      }
    }
  }
}

// h0:11e7a: pieces of one layer in record order. A foreground piece with y bit 14 keeps bit 15 (negative y);
// every other piece drops bit 15, so a set bit 14 puts it far below the screen.
function drawPieces(screen: Screen, room: Room, deltas: DeltaSet | undefined, backdrop: Uint8Array, foreground: boolean): void {
  for (const chunk of room.chunks) {
    if (chunk.kind !== "pieces") continue;
    for (const piece of chunk.pieces) {
      if (piece.foreground !== foreground) continue;
      if (!deltas) throw new Error(`scene ${room.scene} draws pieces with the previous room's delta set`);
      // The original skips index > count but reads one entry past its offset table for index == count.
      if (piece.index < 0 || piece.index >= deltas.entries.length) throw new Error(`scene ${room.scene}: piece ${piece.index} outside its delta set`);
      const y = piece.y | (piece.offscreen ? 0x4000 : 0) | (piece.foreground ? 0x8000 : 0);
      drawDelta(screen, deltas.entries[piece.index], s16(piece.x), piece.foreground && piece.offscreen ? s16(y) : y & 0x7fff, backdrop);
    }
  }
}

// h0:e8de: wall bits of the neighbours that trim joins: the left cell's 0x0a walls (tall pass: tall ones only)
// and the right cell's tall 0xa0 walls.
function neighborWalls(cells: CellBits[][], row: number, col: number, tall: boolean): [number, number] {
  let left = 0;
  let right = 0;
  if (col > 0) {
    const cell = cells[row][col - 1];
    left = cell.walls & 0x0a & (tall ? (cell.select & 0x55) << 1 : 0xff);
  }
  if (col < COLS - 1) {
    const cell = cells[row][col + 1];
    right = cell.walls & 0xa0 & ((cell.select & 0x55) << 1);
  }
  return [left, right];
}

// h0:ef56 / h0:efbc -> h0:edc0: walls from cell byte 0; the tall pass (h0:ebec) puts TWALL tops over walls
// whose selector lane 2d has bit 0 set. Wall state 2 picks WALL frame 1 (TWALL index 2, absent in the data);
// any other state sets the scheme (h0:eb36 / h0:ebec).
function drawWalls(screen: Screen, cells: CellBits[][], shapes: ShapeNode[], tall: boolean, scheme: Scheme): Scheme {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cells[row][col];
      const walls = cell.walls & 0xaa & (tall ? (cell.select << 1) & 0xff : 0xff);
      if (!walls) continue;
      const x = cellX(col);
      const y = cellY(row);
      const [left, right] = neighborWalls(cells, row, col, tall);
      for (const bit of WALL_BITS) {
        if (!(walls & bit)) continue;
        const direction = Math.log2(bit) >> 1;
        // h0:ecbc and h0:ed06: joins with a wall of the same cell, then of the neighbours.
        let skipLeft = 0;
        let skipRight = 0;
        if ((direction === 2 && walls & 0x08) || (direction === 3 && walls & 0x02)) skipRight = 3;
        else if ((direction === 0 && walls & 0x80) || (direction === 1 && walls & 0x20)) skipLeft = 4;
        if ((direction === 2 && left & 0x08) || (direction === 3 && left & 0x02)) skipLeft = 4;
        else if ((direction === 0 && right & 0x80) || (direction === 1 && right & 0x20)) skipRight = 3;
        const state = (cell.select & bit ? 1 : 0) + (cell.selectHigh & bit ? 2 : 0);
        if (state !== 2) scheme = state as Scheme;
        const [ox, oy] = WALL_OFFSETS[direction];
        if (tall) {
          const frame = frameAt(shapes, direction, state === 2 ? 2 : 0);
          blitShape(screen, frame, x + ox + frame.x, y + oy - TALL_WALL_RISE - frame.y - 3, skipLeft, skipRight);
        } else {
          const frame = frameAt(shapes, direction, state === 2 ? 1 : 0);
          blitShape(screen, frame, x + ox + frame.x, y + oy - frame.y - 2, skipLeft, skipRight);
        }
      }
    }
  }
  return scheme;
}

// h0:d266 dropColumn(): from (x, y) down to the clip row, or up to row 0 with mode bit 3, while ReadPixel
// sees 0 or 0xfd (off the bitmap it returns -1 and stops the column); a dot every (mode & 7) + 1 rows.
function dropColumn(screen: Screen, x: number, y: number, color: number, mode: number): void {
  const step = mode & 8 ? -1 : 1;
  const gap = mode & 7;
  const readable = x >= 0 && x < screen.width;
  let wait = 0;
  for (; step < 0 ? y >= 0 : y <= screen.bottom; y += step) {
    const under = readable && y < screen.height ? screen.get(x, y) : 0xff;
    if (under !== 0 && under !== 0xfd) return;
    if (wait === 0) {
      wait = gap;
      screen.pixels[y * screen.width + x] = color;
    } else {
      wait--;
    }
  }
}

// h0:b2c8: dotted columns along a 2:1 slope, in the drop colour + 2.
function drawDrop(screen: Screen, drop: Drop): void {
  const step = drop.step;
  const slope = drop.rising ? -step : step;
  const mode = (drop.spacing - 1) | (drop.upward ? 8 : 0);
  if (drop.color + 2 > 0xff) throw new Error(`drop colour ${drop.color} + 2 is outside the h10:1024 plot table`);
  for (let x = s16(drop.x0), y2 = s16(drop.y0 * 2); x <= s16(drop.x1); x = s16(x + step), y2 = s16(y2 + slope)) {
    dropColumn(screen, x, y2 >> 1, drop.color + 2, mode);
  }
}

// h0:b35e: three-pixel isometric line of (|dx| >> 1) + 1 steps.
function drawLine(screen: Screen, line: Line): void {
  const dx = s16(line.x1 - line.x0);
  const dy = s16(line.y1 - line.y0);
  const direction = dx < 0 ? (dy >= 0 ? 5 : 7) : dy >= 0 ? 3 : 1;
  dashLine(screen, s16(line.x0), s16(line.y0 + 1), line.outer, line.inner, direction, (Math.abs(dx) >> 1) + 1);
}
