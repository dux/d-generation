import type { Actor, ActorClass } from "../core/model.ts";
import { s8, u8 } from "../core/int.ts";
import { animate, drawPart } from "./shared.ts";

// AGA +98..+9d: the squashed remains h0:524a leaves where a TUB killed the player or a survivor.
export interface SquActor extends Actor {
  hits: number;
  animationTime: number;
  squeaked: number;
}

const SEQUENCE = [0, 2, 4, 5, 6, 7, 6, 5, 255]; // g:92e

export const squClass: ActorClass = {
  id: 5,
  name: "squ",
  createState: (): Partial<SquActor> => ({ hits: 0, animationTime: 0, squeaked: 0 }),
  // h0:492c (DOS 0:4e30) init(record, object).
  init(_ctx, actor) {
    const a = actor as SquActor;
    a.collisionDisabled = 1;
    a.squeaked = 0;
    a.animationTime = 0xcc00;
  },
  // h0:494c (DOS 0:4e4a): the original update handler is an empty function.
  update() {},
  // h0:494e (DOS 0:4e4b) message(kind, msg): 9 counts a hit (h0:496e); from the second on, the animation restarts at 4.
  message(_ctx, actor, message) {
    if (s8(message.type) !== 9) return 0;
    const a = actor as SquActor;
    a.hits = u8(a.hits + 1);
    if (s8(a.hits) > 1) a.frame = 4;
    return 1;
  },
  // h0:4990 (DOS 0:4ea8) post(): play the sequence once and hold its last frame; squeak at the first frame >= 1.
  post(ctx, actor) {
    const a = actor as SquActor;
    const index = a.frame;
    const animation = animate(ctx, a, SEQUENCE, 0x1d6);
    let frame = animation.frame;
    if (animation.wrapped) {
      a.frame = index;
      frame = s8(SEQUENCE[s8(index)]!);
    }
    if (!a.squeaked && frame >= 1) {
      a.squeaked = 1;
      ctx.emit({ type: "sound", id: 37 });
    }
    a.spritePaths = [[frame]];
    a.spriteOffsetX[0] = -6;
    a.spriteOffsetY[0] = 2;
  },
  // h0:4a40 (DOS 0:4f49).
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx, 0); },
};
