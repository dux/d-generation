import type { ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { angleBetween, blocked, moveActor, targetAim } from "../core/geometry.ts";
import { drawPart, saveRecord, spawnRemains } from "./shared.ts";
import { fireProjectile } from "./gre.ts";
import type { PlayerActor } from "./player.ts";

export interface TrkActor extends Actor { switchGroup: number;
turretFireTime: number;
turretTurnTime: number;
turretEnabled: number;
turretReclaiming: number;
turretArmed: number;
turretFixed: number;
turretDestroyed: number;
turretTransitionTime: number; }

const TRANSITION_FRAMES = [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]; // g:3ccb
const HEAVY_SHOTS = [11, 21, 19]; // g:18f2

// h0:9634 (DOS 0:706a): fire only at a visible, in-range target along the current facing.
function shootAt(ctx: ActorContext, actor: TrkActor, target: Actor | null): number {
  if (!target || (target.classId === 0 && (target as PlayerActor).invulnerable)) return 0;
  if ((((angleBetween(target, actor) + 4) >> 3) & 7) !== actor.facing) return 0;
  const angle = targetAim(ctx, actor, target, 0x63, 4);
  if ((angle & 255) === 255 || fireProjectile(ctx, actor)) return 0;
  const shot = ctx.state.spawned;
  if (!shot) throw new Error("h0:9634 projectile spawn succeeded without an actor");
  shot.movementHeading = angle & 255;
  return 1;
}

// h0:95bc (DOS 0:7008): the player has priority; the survivor scan repeats only after successful shots.
function fire(ctx: ActorContext, actor: TrkActor): void {
  if (!actor.turretArmed) return;
  actor.turretFireTime = (actor.turretFireTime - ctx.state.frameTicks) & 0xffff;
  if (!(actor.turretFireTime & 0x8000)) return;
  const fast = ctx.state.sceneIndex === 86 || ctx.state.sceneIndex === 54 || ctx.state.sceneIndex === 108;
  actor.turretFireTime = (actor.turretFireTime + (fast ? 0x400 : 0x700)) & 0xffff;
  if (shootAt(ctx, actor, ctx.state.player)) return;
  for (const target of ctx.objects.slots) {
    if (target?.classId === 9 && !shootAt(ctx, actor, target)) break;
  }
}

// h0:12df4/12dc4 (DOS 0:71c8/67c8): switch the turret's extending/retracting mechanism.
function switchTurret(actor: TrkActor, action: number): number {
  const before = actor.turretEnabled ? 255 : 0;
  const after = (action & 255) === 1 ? before ^ 255 : action & 255;
  if (before === after) return 0;
  if (after & 128) actor.turretReclaiming = 1;
  else {
    actor.turretEnabled = 0;
    actor.collisionDisabled = 1;
  }
  actor.turretArmed = 0;
  return 1;
}

// h0:96f8 (DOS 0:715c): the first heavy hit destroys the turret; subsequent hits select the ruined sprite.
function hit(ctx: ActorContext, actor: TrkActor, message: ActorMessage): void {
  if (actor.collisionDisabled || !message.sender || !HEAVY_SHOTS.includes(message.sender.classId)) return;
  spawnRemains(ctx, actor, 1, 0, 0);
  actor.removed = 0;
  if (!actor.turretDestroyed) {
    actor.collisionDisabled = 0;
    actor.turretDestroyed = ctx.state.round;
    actor.turretArmed = 0;
    actor.switchGroup = 7;
    actor.facing = actor.frame = 0;
  } else actor.facing = actor.frame = 1;
}

export const trkClass: ActorClass = {
  id: 10,
  name: "TRK",
  // h0:97a4/h0:12818 (DOS 0:7249): decode group, facing, destroyed/off state and fixed-facing bit.
  init(_ctx, base, spec) {
    const actor = base as TrkActor;
    actor.frame = 0;
    actor.switchGroup = spec.params.group ?? 0;
    actor.facing = spec.params.facing ?? 0;
    actor.turretFireTime = actor.turretTurnTime = actor.turretEnabled = actor.turretReclaiming = 0;
    actor.turretArmed = actor.turretFixed = actor.turretDestroyed = actor.turretTransitionTime = 0;
    if (actor.switchGroup === 7) {
      actor.turretDestroyed = actor.turretEnabled = 1;
      if (actor.facing) actor.frame = actor.collisionDisabled = 1;
    } else if (spec.params.stateBit6) actor.frame = 10;
    else {
      actor.turretArmed = actor.turretEnabled = 1;
      actor.turretFireTime = 0xc00;
    }
    if (spec.params.fixedFacing) actor.turretFixed = 1;
    if (!actor.turretEnabled) actor.collisionDisabled = 1;
    actor.activeThreat = 1;
  },
  // h0:954c/957e/12d5c/956c (DOS 0:6f6a/6f93/6fd3/6f77): fire, reclaim, turn, drift, then release the reclaim latch.
  update(ctx, base) {
    const actor = base as TrkActor;
    fire(ctx, actor);
    if (actor.turretReclaiming) {
      actor.collisionDisabled = 0;
      if (blocked(ctx, actor)) actor.collisionDisabled = 1;
      else { actor.turretEnabled = 1; actor.turretReclaiming = 0; }
    }
    if (actor.turretArmed && !actor.turretFixed) {
      actor.turretTurnTime = (actor.turretTurnTime - ctx.state.frameTicks) & 0xffff;
      if (actor.turretTurnTime & 0x8000) {
        const scene = ctx.state.sceneIndex;
        const fast = scene === 86 || scene === 54 || scene === 108 || scene === 101;
        actor.turretTurnTime = (actor.turretTurnTime + (fast ? 0x500 : 0xb00)) & 0xffff;
        actor.facing = (actor.facing + 1) & 7;
      }
    }
    moveActor(ctx, actor, 5);
    if (ctx.state.player) actor.turretReclaiming = 0;
  },
  // h0:969c/96e4 (DOS 0:70e4/7145): touches turn movement direction; switches retract; shots destroy.
  message(ctx, base, message) {
    const actor = base as TrkActor;
    switch (message.type) {
      case 0:
      case 8: actor.direction = (message.direction ?? 0) & 255; return 0xffff;
      case 4: return switchTurret(actor, message.switchAction ?? 0);
      case 9: hit(ctx, actor, message); return 1;
      default: return 0;
    }
  },
  // h0:9792/h0:100b2/1018e (DOS 0:7234): extend/retract one step per elapsed transition period.
  post(ctx, base) {
    const actor = base as TrkActor;
    actor.firstLayer = 0;
    if (!actor.turretArmed) {
      if (actor.turretDestroyed) {
        actor.spritePaths[0] = [2, actor.frame];
        actor.spriteOffsetY[0] = actor.spriteOffsetY[1] = 0;
      } else {
        actor.turretTransitionTime = (actor.turretTransitionTime - ctx.state.frameTicks) & 0xffff;
        if (actor.turretTransitionTime & 0x8000) {
          actor.turretTransitionTime = (actor.turretTransitionTime + 0x190) & 0xffff;
          if (actor.turretEnabled) { if (actor.frame) actor.frame--; }
          else if (actor.frame < 10) actor.frame++;
        }
        if (!actor.frame && actor.turretEnabled) actor.turretArmed = 1;
        else {
          actor.spritePaths[0] = [1, TRANSITION_FRAMES[actor.frame]];
          actor.spriteOffsetY[0] = actor.spriteOffsetY[1] = -1;
          if (actor.frame === 10 && !actor.turretEnabled) actor.firstLayer = 1;
        }
      }
    }
    if (actor.turretArmed) {
      actor.spritePaths[0] = [0, actor.facing];
      actor.spriteOffsetY[0] = actor.spriteOffsetY[1] = 3;
    }
  },
  // h0:9798 (DOS 0:723a): render the selected turret part.
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx); },
  // h0:97ba/h0:41dc (DOS 0:72ce/4642): byte 3 = group | facing<<3 | disabled<<6 | fixed<<7.
  save(_ctx, base): ObjectSpec {
    const actor = base as TrkActor;
    return saveRecord(actor, actor.switchGroup | (actor.facing << 3) | (actor.turretEnabled ? 0 : 0x40) | (actor.turretFixed ? 0x80 : 0));
  },
};
