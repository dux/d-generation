import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { applyStep, blocked, moveActor, resolveMove, targetAim, teleportActor } from "../core/geometry.ts";
import { animate, drawPart, spawnRemains } from "./shared.ts";
import { actorDistance, saveFine, within } from "./orb.ts";
import type { PlayerActor } from "./player.ts";

// AGA +98..+a3.
export interface TubActor extends Actor { animationTime: number;
attackActive: number;
attackReset: number;
attackDamage: number;
movementStopped: number;
dormant: number;
surpriseJump: number;
wakeTimer: number;
waking: number;
jumpAttempted: number; }

const SEQUENCE = [0,1,2,4,3,2,3,4,2,1,255,0,1,2,4,3,2,3,4,2,1,255,2,2,2,2,4,4,4,4,4,3,2,255,3,4,7,8,9,10,255,10,9,8,7,255]; // g:3cd6
const DAMAGE = [0,0,0,60,60,60,60,60,0,0,255,0,0,0,255,255,255,255,255,0,0,255,0,0,0,0,24,24,24,24,24,0,0,255,0,0,0,0,0,0,255,0,0,0,0,255]; // g:3d04
const HEIGHT = [0,0,0,5,11,16,11,5,0,0,255,0,0,0,10,20,27,20,10,0,0,255,237,243,249,0,4,9,15,19,15,9,4,255,20,10,0,0,0,0,255,0,0,0,0,255]; // g:3d32

// h0:99ba (DOS 0:74e0): aim and scale attack speed to player distance.
function aim(ctx: ActorContext, a: TubActor): void {
  const player = ctx.state.player;
  if (!player || ctx.state.invulnerable || a.attackActive) return;
  const step = a.frame << 24 >> 24;
  if (step !== 0 && step !== 1) {
    if (step >= 32) a.attackReset = 0;
    return;
  }
  const heading = targetAim(ctx, a, player, 60, 4);
  if (heading === -1) return;
  a.movementHeading = heading;
  a.direction = ((heading + 4) >> 3) & 7;
  let damage = (actorDistance(a, player) << 2) & 65535;
  if ((damage << 16 >> 16) > 69) damage = Math.trunc(ctx.state.sceneIndex / 50) * 3 + 69;
  a.attackDamage = damage & 255;
  a.attackActive = 1;
  a.frame = 11;
  a.ignoredClass = 15;
  a.ownerId = player.id;
}

// h0:98d4 (DOS 0:7410): a one-in-seven surprise jump, or a close-range bite.
function attack(ctx: ActorContext, a: TubActor): void {
  const player = ctx.state.player;
  if (!a.attackActive || !player || a.height < 15 || (a.frame << 24 >> 24) < 16) return;
  if (!within(a, player, 3)) {
    if (a.jumpAttempted) return;
    a.jumpAttempted = 1;
    if (ctx.random.next(7)) return;
    a.surpriseJump = 1;
    a.frame = 34;
    return;
  }
  if ((player as PlayerActor).invulnerable) return;
  if (ctx.objects.send(a, { type: 2, sender: a, x: player.x, y: player.y })) {
    a.noTurn = 1;
    ctx.objects.send(player, { type: 9, sender: a });
    a.movementStopped = 1;
  }
}

export const tubClass: ActorClass = {
  id: 15,
  name: "tub",
  createState: (): Partial<TubActor> => ({ animationTime: 0 }),
  // h0:97fe -> h0:128e8 (DOS 0:731a).
  init(ctx, actor, spec) {
    const a = actor as TubActor;
    a.attackActive = a.attackReset = a.attackDamage = a.movementStopped = 0;
    a.dormant = a.surpriseJump = a.wakeTimer = a.waking = a.jumpAttempted = 0;
    a.direction = a.facing = spec.params.facing ?? 0;
    a.frame = ctx.random.next(7);
    a.activeThreat = 1;
  },
  // h0:9830/9852/9a86 (DOS 0:737a/7392/75bd): wake runs after active behavior.
  update(ctx, actor) {
    const a = actor as TubActor;
    if (!a.dormant && !a.waking) {
      aim(ctx, a);
      if (!a.movementStopped) {
        const delta = moveActor(ctx, a, 7);
        if (a.attackActive) {
          applyStep(ctx, a, delta.dx, delta.dy);
          const next = resolveMove(ctx, a, delta.dx, delta.dy, 7);
          applyStep(ctx, a, next.dx, next.dy);
          resolveMove(ctx, a, next.dx, next.dy, 4);
        }
      }
      attack(ctx, a);
    }
    if (!ctx.state.player || !a.dormant) return;
    a.wakeTimer = (a.wakeTimer - ctx.state.frameTicks) & 65535;
    if ((a.wakeTimer << 16 >> 16) > 0) return;
    a.wakeTimer = (a.wakeTimer + 0xd00) & 65535;
    a.collisionDisabled = 0;
    if (blocked(ctx, a)) { a.collisionDisabled = 1; return; }
    if (targetAim(ctx, a, ctx.state.player, 65, 4) === -1) return;
    a.dormant = 0;
    a.waking = 1;
    a.frame = 41;
    a.spriteEnabled[0] = 1;
  },
  // h0:9ae4/9b42/9b90/9bae (DOS 0:7634/7698/76de/76f9). Type 3 (h0:4040) is never sent by any h0:1bd8 caller.
  message(ctx, actor, message) {
    const a = actor as TubActor;
    switch (message.type) {
      case 0:
      case 8:
        a.direction = message.direction ?? 0;
        a.movementHeading = 255;
        return -1;
      case 2: return Number(teleportActor(ctx, a, message.x ?? a.x, message.y ?? a.y));
      case 9:
        if (message.sender && [11,21,19,20].includes(message.sender.classId) && (a.frame << 24 >> 24) <= 40) {
          spawnRemains(ctx, a, 1, message.sender.direction, message.sender.speed);
          ctx.objects.checkRoomCleared(1);
        }
        return 1;
      default: return 0;
    }
  },
  // h0:9bcc -> h0:10228/10390/103c4 (DOS 0:7714 -> 12cc:07f5).
  post(ctx, actor) {
    const a = actor as TubActor;
    let frame = 11;
    if (!a.dormant) {
      const animation = animate(ctx, a, SEQUENCE, 0x168);
      frame = animation.frame;
      if (animation.wrapped) {
        a.jumpAttempted = 0;
        if (a.surpriseJump) {
          a.surpriseJump = 0;
          a.collisionDisabled = a.dormant = 1;
          frame = 11;
          a.wakeTimer = 0x2800;
        }
        a.movementHeading = 255;
        a.noTurn = a.attackActive = a.frame = 0;
        if (a.waking) { a.waking = 0; a.frame = 2; frame = 2; }
        if (a.movementStopped) {
          const squ = ctx.objects.slots.find(o => o && !o.removed && o.classId === 5) as (Actor & { hits: number }) | undefined;
          if (squ) { squ.hits = (squ.hits + 1) & 255; if ((squ.hits << 24 >> 24) > 1) squ.frame = 4; }
        }
      }
    }
    a.height = HEIGHT[a.frame];
    a.speed = DAMAGE[a.frame] & 128 ? a.attackDamage : DAMAGE[a.frame];
    const extra = a.height > 127 ? (a.frame - 20) & 255 : 0;
    a.spritePaths = [[0, frame + extra], [1, frame]];
    a.spriteEnabled = [1, !a.movementStopped && !a.surpriseJump && !a.dormant && !a.waking ? 1 : 0, 0];
    a.spriteOffsetX = [-1, -1];
    a.spriteOffsetY = [0, a.height + 3];
  },
  // h0:9bd2 (DOS 0:771a): AGA draws both parts even while dormant.
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx, 1); drawPart(ctx, actor, gfx, 0); },
  // h0:9814 (DOS 0:735d).
  save(_ctx, actor) { return saveFine(actor); },
};
