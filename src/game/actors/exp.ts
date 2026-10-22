import type { Actor, ActorClass } from "../core/model.ts";
import { applyStep, moveActor, resolveMove } from "../core/geometry.ts";
import { s8, s16, u8 } from "../core/int.ts";
import { animate, drawPart } from "./shared.ts";

const SEQUENCE = [0, 1, 2, 3, 4, 255] as const; // g:3cb4.

// AGA +98 lifetime, +9b class of the consumed actor.
export interface RemainsActor extends Actor { remainsTime: number; remainsSourceClass: number }

export const expClass: ActorClass<RemainsActor> = {
  id: 17,
  name: "exp",
  createState: () => ({ remainsTime: 0, remainsSourceClass: 0 }),
  // h0:8620 (DOS 0:7c0a): AGA ignores record argument and initializes a 700-unit timer.
  init(_ctx, actor) { actor.remainsTime = 700; actor.triggerOnly = 1; },
  // h0:8574 (DOS 0:7b44): drift with collision retry and fade the byte movement speed.
  update(ctx, actor) {
    const moved = moveActor(ctx, actor, 7);
    if (!moved.collision) {
      applyStep(ctx, actor, moved.dx, moved.dy);
      resolveMove(ctx, actor, moved.dx, moved.dy, 7);
    }
    const speed = u8(actor.speed - (s16(ctx.state.frameTicks) >> 5));
    actor.speed = speed > 85 ? 0 : speed;
  },
  // h0:85cc (DOS 0:7ba8): message8 stops drift.
  message(_ctx, actor, message) { if (message.type === 8) actor.noTurn = 1; return 1; },
  // h0:860e -> h0:ffac (DOS 12cc:0522): reflected direction tree and finite lifetime.
  post(ctx, actor) {
    actor.spriteScheme = 0;
    const frame = animate(ctx, actor, SEQUENCE, 700, "remainsTime");
    if (frame.wrapped) { actor.removed = ctx.state.round; return; }
    let facing = s8(actor.facing);
    actor.spriteMirror = facing > 3 ? 1 : 0;
    if (facing > 3) {
      facing = facing === 4 ? 0 : 8 - facing;
      actor.spriteMirrorWidth[0] = 35;
    }
    actor.spritePaths[0] = [facing, frame.frame];
    actor.spriteOffsetX[0] = -6;
    actor.spriteOffsetY[0] = 0;
    actor.spriteEnabled[0] = 1;
  },
  // h0:8614 (DOS 0:7bfb): draw the cloud part.
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx); },
};
