import type { ObjectSpec } from "../../formats/level.ts";
import { moveActor, sightActor } from "../core/geometry.ts";
import { u8 } from "../core/int.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { flash } from "./cgen.ts";
import { animate, drawPart, saveRecord, spawnRemains } from "./shared.ts";
import { showMessage } from "../core/messages.ts";

export interface CubActor extends Actor { cubKind: number;
cubState: number;
cubActive: number;
cubVariant: number;
cubItem: number;
cubSpecial: number;
animationTime: number; }

const pickupRooms = [39, 107, 127, 59, 79, 13, 57, 136, 54, 140, 63, 83];
const pickupKinds = [1, 2, 3, 4, 1];
const pickupText = ["`Empty!", "`1 Grenade!", "`1 Bomb!", "`1 Shield!", "`1 Freezer!", "`1 Barrier!", "`1 Life!"];
const lid = [1, 2, 3, 4, 5, 6, 255];
const terminal = [0, 1, 2, 3, 255];

// h0:f9fa: choose room contents once, before entering the first room.
export function initCubeItems(ctx: ActorContext): void {
  ctx.state.cubeItems = pickupRooms.map(room => room === 133 ? 2 : pickupKinds[ctx.random.next(5)]);
}

// h0:8d84: at most one class-22 generator is produced by an activated cubicle.
export function cubSpawn(ctx: ActorContext, actor: Actor, heading: number): Actor | null {
  if (ctx.objects.count(22)) return null;
  const spawned = ctx.objects.spawn(22, {
    class: "cgen", x: actor.x >>> 8, y: actor.y >>> 8,
    params: { orientation: ((heading + 4) >> 3) & 7, unknownArgument: 0, dormant: 0, playerTriggered: 0 },
  });
  if (spawned) {
    ctx.emit({ type: "sound", id: 20 });
    flash(ctx, 0, 2);
  }
  return spawned;
}

// h0:8f50 (DOS 0:87e1): use terminals or consume the cubicle's room pickup.
function use(ctx: ActorContext, actor: CubActor, message: ActorMessage): number {
  const sender = message.sender;
  if (sender?.classId !== 0) return 1;
  if (actor.cubKind === 6) {
    ctx.terminal(); // h0:8f70 -> h0:908a
    return 1;
  }
  if (ctx.state.sceneIndex === 120 && !actor.cubKind) {
    actor.removed = ctx.state.round;
    sender.removed = ctx.state.round;
    ctx.objects.spawn(23, { class: "sli", x: 130, y: 132, params: { orientation: 0, unknownArgument: 1 } });
    ctx.emit({ type: "sound", id: 17 });
    return 1;
  }
  if (actor.cubItem === 255) return 1;
  showMessage(ctx, pickupText[actor.cubItem]!, 4, 3);
  actor.removed = ctx.state.round;
  ctx.emit({ type: "sound", id: 20 });
  switch (actor.cubItem) {
    case 1: ctx.state.ammo = u8(ctx.state.ammo + 1); break;
    case 2: ctx.state.portableLaserCount = u8(ctx.state.portableLaserCount + 1); break;
    case 3: ctx.state.shieldCount = u8(ctx.state.shieldCount + 1); break;
    case 4: ctx.state.slowMotionCount = u8(ctx.state.slowMotionCount + 1); break;
    case 5: ctx.state.carriedBombs = u8(ctx.state.carriedBombs + 1); break;
    case 6: ctx.state.lives = u8(ctx.state.lives + 1); break;
  }
  return 1;
}

// h0:8e4a (DOS 0:86fc): break the seal of a closed kind-1 cubicle.
function open(ctx: ActorContext, actor: CubActor, message: ActorMessage): void {
  if (actor.cubKind !== 1 || actor.cubState !== 1) return;
  const sender = message.sender;
  if (!sender) return;
  if (sender.classId !== 17 && (![0, 6, 15, 9].includes(sender.classId) || sender.height)) return;
  if (sender.classId === 17 && (sender as Actor & { remainsSourceClass: number }).remainsSourceClass !== 19) sender.speed = 0;
  ctx.objects.send(sender, { type: 9, sender: actor });
  flash(ctx, 0, 6);
  spawnRemains(ctx, actor, 0, 0, 0);
  actor.removed = 0;
  actor.cubState = 2;
}

// h0:8ef8 (DOS 0:879c): projectile and bomb impacts destroy eligible cubicles.
function hit(ctx: ActorContext, actor: CubActor, message: ActorMessage): void {
  const cls = message.sender?.classId;
  if (actor.cubActive && cls === 20) return;
  if (ctx.state.sceneIndex === 120 && !actor.cubKind) return;
  if (cls === 19 || cls === 20 || cls === 21 || cls === 11) spawnRemains(ctx, actor, 1, 0, 0);
}

export const cubClass: ActorClass = {
  id: 7,
  name: "CUB",
  // h0:9380 (DOS 0:8c57): AGA terminals have no DOS countdown/palette logic.
  init(ctx, base, spec) {
    const actor = base as CubActor;
    Object.assign(actor, { cubKind: 0, cubState: 0, cubActive: 0, cubVariant: 0, cubItem: 255, cubSpecial: 0, animationTime: 0 });
    actor.cubKind = spec.params.kind;
    actor.cubState = spec.params.state;
    if (actor.cubKind === 6) actor.height = 9;
    if (actor.cubKind === 1 && (actor.cubState === 1 || actor.cubState === 2)) {
      actor.collisionDisabled = 1;
      actor.frame = ctx.random.next(6);
      actor.firstLayer = 1;
    }
    if (actor.cubKind === 6 && ctx.state.specialItemCollected && ctx.state.sceneIndex === 68) actor.cubSpecial = 1;
    if (actor.cubKind === 4 && ctx.state.sceneIndex !== 101) actor.cubState = 0;
    if (!actor.cubKind && !actor.cubState) {
      const index = pickupRooms.indexOf(ctx.state.sceneIndex + 1);
      if (index !== -1) {
        const item = ctx.state.cubeItems[index];
        if (item) actor.cubItem = item;
      }
    }
    if (!actor.cubKind && ctx.state.sceneIndex === 120) actor.facing = 1;
    // h0:b684 is RTS in AGA; room-7 map variants therefore see the zero comparison result.
  },
  // h0:8d40 (DOS 0:8484): move and release an activated room-event generator.
  update(ctx, base) {
    const actor = base as CubActor;
    moveActor(ctx, actor, 5);
    const player = ctx.state.player;
    if (!actor.cubActive || !player) return;
    const heading = sightActor(ctx, actor, player, 80, 4);
    if (heading === -1) return;
    actor.removed = ctx.state.round;
    cubSpawn(ctx, actor, heading);
  },
  // h0:8df2 (DOS 0:869b).
  message(ctx, base, message) {
    const actor = base as CubActor;
    switch (message.type) {
      case 0: return use(ctx, actor, message);
      case 6: open(ctx, actor, message); return 0;
      case 8: actor.direction = u8(message.direction ?? 0); return -1;
      case 9: hit(ctx, actor, message); return 0;
      default: return 1;
    }
  },
  // h0:936e -> h0:10608 (DOS 0:8c42): lid/terminal animation, with static state variants.
  post(ctx, base) {
    const actor = base as CubActor;
    actor.spriteEnabled[0] = 1;
    actor.spriteEnabled[1] = 0;
    actor.spriteOffsetX[0] = -1;
    let frame = 0;
    if (!actor.cubKind) {
      frame = actor.cubState;
      if (actor.cubVariant) frame = 2 + actor.cubVariant;
      actor.spriteOffsetX[0] = -2;
    } else if (actor.cubKind === 1) {
      actor.spriteOffsetX[0] = -2;
      if (actor.cubState === 1) frame = animate(ctx, actor, lid, 200).frame;
      else if (actor.cubState === 2) { actor.spriteOffsetY[0] = 1; frame = 7; }
    } else if (actor.cubKind === 6) {
      frame = animate(ctx, actor, terminal, 400).frame;
      if (actor.cubSpecial) { frame = 4; actor.spriteOffsetX[0] = 2; }
    } else if (actor.cubKind === 4) frame = actor.cubState;
    actor.spritePaths[0] = [actor.cubKind, frame];
  },
  // h0:9374 (DOS 0:8c48).
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx, 0); },
  // h0:94c4 (DOS 0:8d63): byte 3 = kind | state<<5; state seven resets unless active.
  save(ctx, base): ObjectSpec {
    const actor = base as CubActor;
    if (!ctx.state.sceneIndex) throw new Error("AGA h0:94c4 leaves the scene-1 cub record slot unwritten (stale save buffer); not ported");
    if (!actor.cubActive && actor.cubState === 7) actor.cubState = 0;
    return saveRecord(actor, actor.cubKind | (actor.cubState << 5));
  },
};
