import type { ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { occupiedActorCell, setCellOccupancy, teleportActor } from "../core/geometry.ts";
import { drawObjectPart } from "../render/objects.ts";
import { saveRecord, spawnRemains } from "./shared.ts";

export interface DoorActor extends Actor { doorSide: number;
switchGroup: number;
doorClosed: number;
doorClosing: number;
doorReverseSlide: number;
doorHasSave: number;
doorSaveSlot: number;
doorNeedsRedraw: number;
doorDestroyed: number;
doorSaved: number; }

const STEP_FRAMES = [0, 0, 1, 2, 3, 3]; // g:3f8e
const SIDE_SHADE = [0, 1, 3, 2]; // g:3f8a

// h0:405e/h0:e7b8 (DOS 0:4505): the room wall lanes hidden behind the sliding door, as [cell index, wall mask]
// pairs of the runtime grid (g:8ede); h0:4192 rejects cells outside the room.
export function doorWallLanes(ctx: ActorContext, actor: Actor): [number, number][] {
  const x = actor.x >>> 8, y = actor.y >>> 8;
  const column = x - ctx.state.roomLeft > 0 ? Math.trunc((x - ctx.state.roomLeft) / 14) : 0;
  const row = Math.trunc((y - ctx.state.roomTop - 6) / 14);
  const remainder = (x - 1) % 14;
  const lanes: [number, number, number][] = actor.facing === 1
    ? remainder ? [[column, row, 0x22]] : [[column + 1, row, 0x20], [column, row + 1, 2]]
    : remainder ? [[column, row, 0x88]] : [[column, row, 8], [column + 1, row + 1, 0x80]];
  return lanes.map(([c, r, mask]) => {
    if (c < 0 || c >= 10 || r < 0 || r >= 13) throw new Error("h0:4192 door wall outside room");
    return [r * 10 + c, mask];
  });
}

// h0:405e -> h0:4192: replace only the selected wall bit lanes.
function setDoorWalls(ctx: ActorContext, actor: Actor, value: number): void {
  for (const [index, mask] of doorWallLanes(ctx, actor)) {
    const cell = ctx.runtimeRoom.cells[index]!;
    cell.walls = (cell.walls & ~mask & 0xff) | (mask & value);
  }
}

// h0:70b0/h0:782e (DOS 0:6736/67c8): toggle or set the closed state.
function switchDoor(ctx: ActorContext, actor: DoorActor, action: number): number {
  if (actor.doorDestroyed) return 0;
  const before = actor.doorClosed || actor.doorClosing ? 255 : 0;
  const after = (action & 255) === 1 ? before ^ 255 : action & 255;
  if (before === after) return 0;
  actor.doorReverseSlide = actor.doorNeedsRedraw = 1;
  if (after) actor.doorClosing = 1;
  else {
    actor.doorClosed = actor.doorClosing = 0;
    setCellOccupancy(ctx, actor, 0);
    actor.frame = 3;
  }
  return 1;
}

// h0:7036 (DOS 0:66dd): artillery blows a closed door open, except in scene 120.
function shot(ctx: ActorContext, actor: DoorActor, message: ActorMessage): void {
  if (message.sender?.classId !== 11 || !actor.doorClosed || actor.doorDestroyed || ctx.state.sceneIndex === 120) return;
  spawnRemains(ctx, actor, 1, 0, 0);
  actor.removed = actor.frame = actor.doorClosed = 0;
  actor.doorDestroyed = actor.doorNeedsRedraw = 1;
  setCellOccupancy(ctx, actor, 0);
}

export const doorClass: ActorClass = {
  id: 2,
  name: "DOOR",
  // h0:7292 (DOS 0:6abb): unpack door state, configure its three-cell path and allocate a background slot.
  init(ctx, base, spec) {
    const actor = base as DoorActor;
    actor.doorSide = spec.params.side ?? 0;
    actor.switchGroup = spec.params.group ?? 0;
    actor.doorClosed = actor.doorClosing = actor.doorReverseSlide = actor.doorHasSave = actor.doorSaveSlot = 0;
    actor.doorNeedsRedraw = actor.doorDestroyed = actor.doorSaved = 0;
    actor.x &= 0xff00;
    actor.y &= 0xff00;
    if (actor.doorSide === 3) actor.doorSide = 2;
    if (actor.switchGroup === 7) actor.doorSide = 3;
    if (spec.params.blownOpen) actor.doorDestroyed = actor.collisionDisabled = 1;
    if (spec.params.initialOpenBits) {
      actor.doorClosed = 0;
      actor.collisionDisabled = 1;
    } else {
      setCellOccupancy(ctx, actor, 255);
      actor.frame = 4;
      actor.doorClosed = 255;
      setDoorWalls(ctx, actor, 255);
    }
    if (ctx.state.doorSaveSlots < 4) {
      actor.doorHasSave = 1;
      actor.doorSaveSlot = ctx.state.doorSaveSlots++;
    }
    actor.doorNeedsRedraw = 1;
  },
  // h0:6f88/6f8e (DOS 0:6627/662b): wait until mobile actors have left before reclaiming the cells.
  update(ctx, base) {
    const actor = base as DoorActor;
    if (!actor.doorClosing) return;
    setCellOccupancy(ctx, actor, 255);
    if (occupiedActorCell(ctx)) {
      setCellOccupancy(ctx, actor, 0);
      return;
    }
    actor.doorClosed = actor.doorNeedsRedraw = 1;
    actor.doorClosing = actor.frame = 0;
  },
  // h0:6fd8 (DOS 0:6675): touching blocks; position, previous-position, switch and shot messages.
  message(ctx, base, message) {
    const actor = base as DoorActor;
    switch (message.type) {
      case 0: return 0xffff; // h0:70a6 (DOS 0:6732).
      case 2: // h0:3dc0 (DOS 0:4242).
        return teleportActor(ctx, actor, message.x ?? actor.x, message.y ?? actor.y) ? 1 : 0;
      case 3: // h0:4040 (DOS 0:44e4).
        actor.previousX = message.previousX ?? actor.previousX;
        actor.previousY = message.previousY ?? actor.previousY;
        return 0;
      case 4: return switchDoor(ctx, actor, message.switchAction ?? 0);
      case 9: shot(ctx, actor, message); return 1;
      default: return 0;
    }
  },
  // h0:7146/h0:11a60/11b36 (DOS 0:6803/6a37): advance the slide, choose its sprite and overlap order.
  post(ctx, base) {
    const actor = base as DoorActor;
    setDoorWalls(ctx, actor, 0);
    let step = actor.frame;
    if (actor.doorClosed) {
      if (step < 5) { step++; actor.doorNeedsRedraw = 1; }
    } else if (step) { step--; actor.doorNeedsRedraw = 1; }
    actor.frame = step;
    let frame = STEP_FRAMES[step];
    actor.firstLayer = frame === 0 ? 1 : 0;
    if (actor.doorDestroyed) frame = 4;
    const side = (actor.doorSide ^ (actor.doorReverseSlide ? 3 : 0)) & 3;
    actor.doorReverseSlide = 0;
    actor.spriteScheme = SIDE_SHADE[side] << 2;
    actor.spriteSets[0] = side === 2 ? 42 : 2;
    actor.spritePaths[0] = [0, actor.facing >> 1, frame];
    actor.spriteOffsetX[0] = [1, 2][(actor.facing >> 1) & 1];
    actor.spriteOffsetY[0] = 0;
    if (actor.frame >= 3) setDoorWalls(ctx, actor, 255);
    // h0:717a/7184 (DOS 0:6929/6932): doors directly behind this one need repainting too.
    if (actor.doorNeedsRedraw) for (const target of ctx.objects.slots) {
      if (!target || target === actor || target.classId !== 2) continue;
      const dy = (actor.y >>> 8) - (target.y >>> 8);
      const dx = (actor.x >>> 8) - (target.x >>> 8);
      if (dy > 0 && dy < 30 && dx > -20 && dx < 20) (target as DoorActor).doorNeedsRedraw = 1;
    }
  },
  // h0:71e0 (DOS 0:6994): the door is blitted with its own wall lanes cleared (h0:405e(0) before h0:3b1a), so
  // only other cells' floor edges occlude it. A door with a save slot (+0x9b) goes into the room bitmap g:de58
  // in the h0:1b38 pass; renderGame draws those right after the room (drawObjects).
  draw(ctx, base, gfx) {
    drawObjectPart(ctx, base, gfx, 0, undefined, base.spriteMirror, doorWallLanes(ctx, base));
  },
  // h0:724e/h0:41dc (DOS 0:6a71/4642): byte 3 = side | group<<2 | open<<5 | destroyed<<7.
  save(_ctx, base): ObjectSpec {
    const actor = base as DoorActor;
    return saveRecord(actor, actor.doorSide | (actor.switchGroup << 2) | (actor.doorClosed ? 0 : 0x20) | (actor.doorDestroyed ? 0x80 : 0));
  },
};
