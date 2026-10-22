import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { applyStep, moveActor, resolveMove, teleportActor } from "../core/geometry.ts";
import { s8, u8 } from "../core/int.ts";
import { drawPart, saveRecord, spawnRemains } from "./shared.ts";
import type { PlayerActor } from "./player.ts";

// AGA +98..+9b. Disk records of encoded class 19 are rewritten to class 21 by h0:21a6, so they arrive here.
export interface BarActor extends Actor {
  barFlash: number;
  barHomeX: number;
  barHomeY: number;
  barHomeDirection: number;
}

// g:900: scene numbers whose barriers keep their position when the room is saved (-1 terminated).
const KEEP_POSITION_SCENES = [109];

// h0:7c06 (DOS 0:65f3) breakBar(): stop; the first time, burst into remains along the sender's motion.
function breakBar(ctx: ActorContext, a: BarActor, sender: Actor | null): void {
  a.noTurn = 1;
  if (a.removed) return;
  if (!sender) throw new Error("AGA h0:7c06 reads the sender of a barrier break; none was given");
  ctx.emit({ type: "sound", id: 7 });
  spawnRemains(ctx, a, 2, s8(sender.direction), sender.speed);
}

// h0:7b4a (DOS 0:6546) touched(): zap the toucher unless it is an invulnerable player, a shot, a laser, a barrier or a door.
function touched(ctx: ActorContext, a: BarActor, sender: Actor | null): number {
  if (!sender) throw new Error("AGA h0:7b4a reads the toucher of a barrier; none was given");
  if (sender.classId === 0 && (sender as PlayerActor).invulnerable) return 0;
  if ([19, 20, 21, 2].includes(sender.classId)) return 0;
  ctx.objects.send(sender, { type: 9, sender: a });
  a.barFlash = 1;
  if (!a.removed) breakBar(ctx, a, sender);
  return -1;
}

export const barClass: ActorClass = {
  id: 21,
  name: "bar",
  createState: (): Partial<BarActor> => ({ barFlash: 0, barHomeX: 0, barHomeY: 0, barHomeDirection: 0 }),
  // h0:3922 (DOS 0:3d6e) init(record, object): fine position (h0:44bc -> h0:128b0), facing, floor-scaled speed, home.
  init(ctx, actor, spec) {
    const a = actor as BarActor;
    a.direction = a.facing = (spec.params.facing ?? 0) & 7;
    a.height = 3;
    a.speed = u8(Math.trunc(ctx.state.sceneIndex / 50) * 4 + 0x37);
    if (ctx.state.sceneIndex === 0x22) a.speed = u8(a.speed - 10);
    a.ignoredClass = 19;
    a.barHomeX = a.x >>> 8;
    a.barHomeY = a.y >>> 8;
    a.barHomeDirection = a.direction;
    a.activeThreat = 1;
  },
  // h0:7aa8 -> h0:7aae (DOS 0:6476 -> 0:647a) update(): a free path is travelled up to three times per pass.
  update(ctx, actor) {
    const move = moveActor(ctx, actor, 7);
    if (move.collision) return;
    applyStep(ctx, actor, move.dx, move.dy);
    if (resolveMove(ctx, actor, move.dx, move.dy, 7).collision) return;
    applyStep(ctx, actor, move.dx, move.dy);
    resolveMove(ctx, actor, move.dx, move.dy, 1);
  },
  // h0:7b04 (DOS 0:64e6) message(kind, msg): 0 touched, 2 teleport, 8 turned, 9 shot.
  message(ctx, actor, message) {
    const a = actor as BarActor;
    switch (s8(message.type)) {
      case 0: return touched(ctx, a, message.sender);
      case 2: return Number(teleportActor(ctx, a, message.x ?? a.x, message.y ?? a.y));
      case 8:
        // h0:7bc0 (DOS 0:65ad) turned(msg).
        ctx.recordObject(a.id);
        a.facing = a.direction = u8(message.direction ?? 0);
        a.barFlash = 1;
        ctx.emit({ type: "sound", id: 26 });
        return -1;
      case 9:
        breakBar(ctx, a, message.sender);
        return 1;
      default: return 0;
    }
  },
  // h0:7bf4 -> h0:111d6 (DOS 0:65de -> 12cc:18cd) post(): one flash frame after a touch or turn, per facing.
  post(_ctx, actor) {
    const a = actor as BarActor;
    const flash = a.barFlash & 1;
    a.barFlash = 0;
    a.spritePaths = [[flash, s8(a.facing)]];
  },
  // h0:7bfa (DOS 0:65e4).
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx, 0); },
  // h0:399c (DOS 0:3dd9) save(object, record): back home unless h0:39e6 finds the scene in g:900.
  save(ctx, actor) {
    const a = actor as BarActor;
    if (!KEEP_POSITION_SCENES.includes(u8(ctx.state.sceneIndex + 1))) {
      a.x = a.barHomeX << 8;
      a.y = a.barHomeY << 8;
      a.direction = a.barHomeDirection;
    }
    return saveRecord(a, a.direction, true);
  },
};
