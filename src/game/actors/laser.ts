import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { applyStep, moveActor, resolveMove, teleportActor, updateBounds } from "../core/geometry.ts";
import { drawPart } from "./shared.ts";

export interface LaserActor extends Actor { bounces: number;
flicker: number;
exploding: number;
explosionTimer: number;
lifetime: number; }

const DEADLY = [24, 10, 7, 9, 6, 0, 15, 20]; // g:9c3
const SHADES = [3, 0, 1, 163]; // g:9cc

// h0:573a (DOS 0:5c31): the fourth reflection explodes the bolt.
function bounce(ctx: ActorContext, a: LaserActor): void {
  a.bounces = (a.bounces + 1) & 255;
  if (a.bounces === 4) ctx.objects.send(a, { type: 9, sender: a });
  else if (!a.removed) ctx.emit({ type: "sound", id: 3 });
}

export const laserClass: ActorClass = {
  id: 20,
  name: "laser",
  // h0:381a (DOS 0:3c9f): centre the bolt within its integer world coordinate.
  init(_ctx, actor) {
    const a = actor as LaserActor;
    a.bounces = a.flicker = a.exploding = a.explosionTimer = a.lifetime = 0;
    a.height = 9;
    a.speed = 85;
    a.x = (a.x & 0xff00) | 128;
    a.y = (a.y & 0xff00) | 128;
    a.ignoredClass = 21;
    updateBounds(a);
  },
  // h0:557a (DOS 0:5a36): retry reflected movement up to three times.
  update(ctx, actor) {
    const a = actor as LaserActor;
    if (a.exploding) return;
    let delta = moveActor(ctx, a, 6);
    if (!delta.collision) {
      for (let retry = 0; retry < 3; retry++) {
        applyStep(ctx, a, delta.dx, delta.dy);
        delta = resolveMove(ctx, a, delta.dx, delta.dy, 6);
        if (delta.collision) break;
      }
    }
    if (a.lifetime) {
      a.lifetime = (a.lifetime - 1) & 255;
      if (!a.lifetime) a.ownerId = 65535;
    }
  },
  // h0:561c/5702 (DOS 0:5aee/5c04): collision, teleport, reflection, explosion.
  message(ctx, actor, message) {
    const a = actor as LaserActor;
    switch (message.type) {
      case 0:
        if (!a.noTurn) {
          if (message.sender && DEADLY.includes(message.sender.classId)) {
            const sender = message.sender;
            ctx.objects.send(a, { type: 9, sender });
            ctx.objects.send(sender, { type: 9, sender: a });
          } else {
            a.direction = message.direction ?? 0;
            a.flicker = 1;
            bounce(ctx, a);
          }
        }
        return 1;
      case 2: return Number(teleportActor(ctx, a, message.x ?? a.x, message.y ?? a.y));
      case 8:
        a.direction = a.facing = message.direction ?? 0;
        a.flicker = 1;
        a.frame = 0;
        bounce(ctx, a);
        return 1;
      case 9:
        a.collisionDisabled = 1;
        a.exploding = 1;
        a.explosionTimer = 0x2e4;
        a.frame = 0;
        return 1;
      default: return 0;
    }
  },
  // h0:5778/12eba (DOS 0:5c73/5d3f): directional bolt or five-frame explosion.
  post(ctx, actor) {
    const a = actor as LaserActor;
    if (a.exploding) {
      a.explosionTimer = (a.explosionTimer - ctx.state.frameTicks) & 65535;
      while (a.explosionTimer & 0x8000) {
        a.frame = (a.frame + 1) & 255;
        a.explosionTimer = (a.explosionTimer + 0x190) & 65535;
      }
      if ((a.frame << 24 >> 24) >= 5) { a.removed = ctx.state.round; return; }
      if (a.frame === 1) ctx.emit({ type: "sound", id: 4 });
      a.spritePaths = [[8, a.frame]];
    } else {
      a.spriteShade = SHADES[a.bounces];
      a.spritePaths = [[a.facing, a.flicker & 1]];
      a.flicker = 0;
    }
    a.spriteEnabled = [1, 0, 0];
    a.spriteOffsetX = [0];
    a.spriteOffsetY = [a.exploding ? 2 : 0];
  },
  // h0:583a (DOS 0:5d30).
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx); },
};
