import { encodeRoomBlock } from "../../formats/level.ts";
import type { Frame } from "../../formats/shape.ts";
import { cellCoordinate } from "../core/geometry.ts";
import { s8, u16 } from "../core/int.ts";
import type { Actor, ActorContext } from "../core/model.ts";
import type { DoorActor } from "../actors/door.ts";
import type { ObjectSystem } from "../core/objects.ts";
import { frameSpan, type Clip, type Gfx } from "./gfx.ts";

// Object drawing of the main loop: h0:af12 (layers), h0:b030 (class draw dispatch), and the part blit
// h0:3b1a -> h0:b240 (floor-edge occlusion) -> h0:db6e -> h0:d336.

const EDGE_SET = 31; // WMSK in b1.aga: one mask frame per cell edge (g:dca8 off the resident bank g:87de)
const EDGE_OFFSETS = [[14, -5], [14, 2], [0, 2], [0, -5]]; // g:28dc: edge frame position in a cell, by edge
const COLS = 10;
const CELL = 14;
const ORIGIN_X = 10; // g:872c/g:872e
const ORIGIN_Y = 4;
const OCCUPANCY_COLUMNS = 56; // g:8a30: 7 bytes of bits per row
const MASK_BYTES = 0x190 - 4; // h2:0 holds 400 bytes: the w/h header word pair, then the mask rows

// h0:e6f6 addresses cell (col, row) as g:8ede + row * 80 + col * 8 without a bounds check, so edges of cells off
// the grid read their wall byte from the globals around it: the room block as loaded (header g:8e48, object
// records g:8e66, name g:8ebe), the block tail g:92ee, g:92fc (0xff after the room set-up h0:1ca4), the last
// record of the room spawn loop h0:215c at g:92fd (its final call walks the block records), and the room-save
// buffers from g:9301.
function wallByte(ctx: ActorContext, index: number): number {
  if (index >= 0 && index < 130) return ctx.runtimeRoom.cells[index]!.walls;
  const at = 0x8ede + index * 8;
  const block = () => encodeRoomBlock(ctx.room);
  if (at >= 0x8e48 && at < 0x8ede) return block()[at - 0x8e48]!;
  if (at >= 0x92ee && at < 0x92fa) return block()[0x424 + at - 0x92ee]!;
  if (at === 0x92fa || at === 0x92fb) return 0;
  if (at === 0x92fc) return 0xff;
  if (at >= 0x92fd && at < 0x9301) {
    const bytes = block();
    let record = 0;
    while (record < 21 && ((bytes[0x1e + record * 4]! & 0x0f) | (bytes[0x1e + record * 4]! & 0x80))) record++;
    return bytes[0x1e + record * 4 + at - 0x92fd]!;
  }
  if (at >= 0x9301) return ctx.objects.saveBufferByte(at - 0x9301);
  throw new Error(`AGA edge cell ${index} reads g:${at.toString(16)}, outside the modelled globals`);
}

// h0:17ec8 qsort (SAS/C runtime): the middle element is swapped to the front as the pivot, a Lomuto pass moves
// smaller elements behind it, then the left part recurses and the right part loops. Not stable.
function qsort<T>(list: T[], start: number, count: number, compare: (a: T, b: T) => number): void {
  const swap = (a: number, b: number) => { const t = list[a]!; list[a] = list[b]!; list[b] = t; };
  while (count > 1) {
    if (count === 2) {
      if (compare(list[start]!, list[start + 1]!) > 0) swap(start, start + 1);
      return;
    }
    swap(start, start + (count >>> 1));
    let last = start, less = 0;
    for (let i = start + 1; i < start + count; i++) {
      if (compare(list[i]!, list[start]!) >= 0) continue;
      less++;
      if (++last !== i) swap(i, last);
    }
    if (last !== start) swap(start, last);
    qsort(list, start, less, compare);
    count -= less + 1;
    start = last + 1;
  }
}

// h0:af12: h0:af32 lists the objects of a layer (first-layer objects, then the others; layer 2 is always empty)
// in the order of the redraw list g:84c0 and qsorts them on the integer y byte (h0:b010). Removed objects are
// skipped. The unstable qsort makes the order of equal y bytes depend on the whole list.
export function drawOrder(list: readonly Actor[]): Actor[] {
  const order: Actor[] = [];
  for (const layer of [1, 0]) {
    const part = list.filter(actor => !actor.removed && (actor.firstLayer ? 1 : 0) === layer);
    qsort(part, 0, part.length, (a, b) => (a.y >>> 8) - (b.y >>> 8));
    order.push(...part);
  }
  return order;
}

const savedDoor = (actor: Actor) => actor.classId === 2 && !!(actor as DoorActor).doorHasSave;

// h0:b030 through the class draw handler. A door with a save slot draws only in the h0:1b38 pass (+0x9d).
export function drawObject(objects: ObjectSystem, actor: Actor, gfx: Gfx, doorPass = false): void {
  if (actor.drawSuppressed || savedDoor(actor) !== doorPass) return;
  const handler = objects.classes[actor.classId]?.handlers?.draw;
  if (!handler) throw new Error(`class ${actor.classId} draw not ported`);
  handler(objects.context, actor, gfx);
}

// The redraw list g:84c0 of a frame where everything is redrawn (g:4ea, as on room entry): h0:1354e puts the
// doors with a save slot (+0x9b), all drawn by h0:1b38 in that pass, at the front, h0:11760 appends every other
// object in slot order. The original only redraws its dirty set (h0:1d00), whose list order can sort equal y
// bytes differently.
export function redrawList(objects: ObjectSystem): Actor[] {
  const live = objects.slots.filter((actor): actor is Actor => actor !== null && !actor.removed);
  return [...live.filter(savedDoor), ...live.filter(actor => !savedDoor(actor))];
}

// h0:1b38 then h0:af12 over redrawList. Doors with a save slot are drawn into the room bitmap g:de58 by h0:1b38
// in slot order, so they sit under every object; they stay in the sorted lists but draw nothing there (h0:71e0
// finds +0x9d cleared).
export function drawObjects(objects: ObjectSystem, gfx: Gfx): void {
  const list = redrawList(objects);
  for (const actor of list) drawObject(objects, actor, gfx, true);
  for (const actor of drawOrder(list)) drawObject(objects, actor, gfx);
}

// h0:a246: occupancy bit (x, y) of g:8a30.
function occupied(ctx: ActorContext, x: number, y: number): boolean {
  const index = y * OCCUPANCY_COLUMNS + x;
  if (index < 0 || index >= ctx.state.occupancy.length) throw new Error(`AGA occupancy read (${x}, ${y}) outside g:8a30`);
  return ctx.state.occupancy[index] !== 0;
}

// h0:a88c buildEdgeList() with h0:a9bc (odd half-cell points along the object's far x and y sides that are
// occupied), h0:a908/h0:a8ea (an even point marks all four edges 0xaa of its cell, an odd one the facing edge of
// its four neighbours) and h0:aabe/h0:a96e (rotate to grid cell, merge bits per cell in first-seen order).
function edgeList(ctx: ActorContext, actor: Actor): { col: number; row: number; bits: number }[] {
  const odd = (v: number) => v & 1 ? v : v + 1;
  const right = odd(cellCoordinate(actor.outerRight >>> 8) + 1), bottom = odd(cellCoordinate(actor.outerBottom >>> 8) + 1);
  const left = odd(cellCoordinate(actor.outerLeft >>> 8)), top = odd(cellCoordinate(actor.outerTop >>> 8));
  const points: [number, number][] = [];
  for (let y = top; y <= bottom; y += 2) if (occupied(ctx, right, y)) points.push([right, y]);
  for (let x = left; x <= right; x += 2) if (occupied(ctx, x, bottom)) points.push([x, bottom]);
  const edges: { col: number; row: number; bits: number }[] = [];
  const add = (x: number, y: number, bits: number) => {
    const col = s8(x - y + 0x14) >> 2, row = s8(x + y - 0x1a) >> 2;
    const edge = edges.find(e => e.col === col && e.row === row);
    if (edge) edge.bits |= bits;
    else edges.push({ col, row, bits });
  };
  for (const [x, y] of points) {
    if ((x + y) & 3) {
      add(x, y - 2, 0x20);
      add(x + 2, y, 0x80);
      add(x, y + 2, 0x02);
      add(x - 2, y, 0x08);
    } else add(x, y, 0xaa);
  }
  return edges;
}

// h0:b240: low objects (height byte <= 8; above that only class 23, or parts 1 and 2 of classes other than 11;
// never class 4) lose the pixels behind the floor edges of the wall cells in front of them. h0:f6c0 takes the
// edges (bits & cell walls, h0:ed7a order) of each listed cell and ANDs each WMSK frame's mask into a buffer of
// the part's frame size (h0:f500 fills it with ones, h0:d8ae BltBitMap minterm 0x80), which h0:d336 then ANDs
// with the frame mask. Null when no edge applies (+0x17 stays clear). `cleared` lists [cell index, wall mask]
// lanes that are zero while this part is drawn (the door's own lanes, h0:71e0).
function occlusion(ctx: ActorContext, actor: Actor, gfx: Gfx, part: number, target: Frame, x: number, y: number, cleared: readonly [number, number][]): Uint8Array | null {
  if (actor.classId === 4) return null;
  if ((actor.height & 255) > 8 && actor.classId !== 23 && (part === 0 || actor.classId === 11)) return null;
  const { width, height } = target, span = frameSpan(target);
  if ((span >> 3) * height > MASK_BYTES) throw new Error(`AGA occlusion mask of a ${width}x${height} frame overruns h2`);
  let mask: Uint8Array | null = null;
  for (const { col, row, bits } of edgeList(ctx, actor)) {
    const index = row * COLS + col;
    const walls = cleared.reduce((value, [lane, laneMask]) => lane === index ? value & ~laneMask : value, wallByte(ctx, index)) & bits;
    if (!walls) continue;
    mask ??= new Uint8Array(span * height).fill(1);
    const cellX = (col * CELL - 2 + ORIGIN_X) * 2, cellY = row * CELL - 2 + ORIGIN_Y;
    for (let edge = 0; edge < 4; edge++) {
      if (!(walls & (2 << edge * 2))) continue;
      const frame = gfx.frame(EDGE_SET, [edge]);
      if (!frame.mask) throw new Error("WMSK frame without a mask plane");
      const ex = cellX + EDGE_OFFSETS[edge]![0]!, ey = cellY + EDGE_OFFSETS[edge]![1]! + 1;
      // h0:d8ae: skip unless the rectangles touch (inclusive edges), then AND the overlap.
      if (ex + frame.width < x || ex > x + width || ey + frame.height < y || ey > y + height) continue;
      const [sx, dx, w] = ex > x ? [0, ex - x, Math.min(width - (ex - x), frame.width)] : [x - ex, 0, Math.min(frame.width - (x - ex), width)];
      const [sy, dy, h] = ey > y ? [0, ey - y, Math.min(height - (ey - y), frame.height)] : [y - ey, 0, Math.min(frame.height - (y - ey), height)];
      if (w <= 0 || h <= 0) continue;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) if (!frame.mask[(sy + r) * frame.width + sx + c]) mask[(dy + r) * span + dx + c] = 0;
      }
    }
  }
  return mask;
}

// h0:3b1a drawObjectPart() with the h0:e2b2 projection: the part frame's top-left is the box anchor (h0:e20e:
// x = 2 * (u - scroll) + x bit 7, y = v - scroll - frame height - height + 1) plus the part offsets, plus the
// frame x (or, mirrored, the part's mirror width minus frame x and width), minus the frame y. `clearedWalls`
// are wall lanes treated as zero by the occlusion of this part (see occlusion).
export function drawObjectPart(ctx: ActorContext, actor: Actor, gfx: Gfx, part = 0, clip?: Clip, mirror = actor.spriteMirror, clearedWalls: readonly [number, number][] = []): void {
  if (!actor.spriteEnabled[part]) return;
  const path = actor.spritePaths[part];
  // Frames are selected by post handlers; a freshly entered room has none until its first h0:1ae6 pass.
  if (!path) return;
  const frame = gfx.frame(actor.spriteSets[part] ?? actor.classId, path);
  const u = u16(actor.boundsLeft - actor.boundsBottom + 0x8000) >>> 8;
  const v = u16(actor.boundsBottom + actor.boundsRight - 0x8000) >>> 8;
  let x = 2 * (u - ctx.state.scrollX) + ((actor.x & 0x80) ? 1 : 0) + (actor.spriteOffsetX[part] ?? 0);
  x += mirror ? s8(actor.spriteMirrorWidth[part] ?? 0) - (frame.x + frame.width) : frame.x;
  const y = v - ctx.state.scrollY - frame.height - s8(actor.height) + 1 + (actor.spriteOffsetY[part] ?? 0) - frame.y;
  const hidden = occlusion(ctx, actor, gfx, part, frame, x, y, clearedWalls);
  gfx.blit(frame, x, y, { mirror: !!mirror, clip, occlusion: hidden ?? undefined });
}
