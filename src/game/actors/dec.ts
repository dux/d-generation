import type { Actor, ActorClass } from "../core/model.ts";
import { animate, drawPart } from "./shared.ts";

const SEQUENCE = [2, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0, 0, 0, 1, 2, 1, 2, 255] as const; // g:3ef4.

// AGA +98 animation time.
export interface DecActor extends Actor { animationTime: number }

export const decClass: ActorClass<DecActor> = {
  id: 12,
  name: "dec",
  createState: () => ({ animationTime: 0 }),
  // h0:80ce (DOS 0:a184): effect never participates in actor collision.
  init(_ctx, actor) { actor.collisionDisabled = 1; actor.animationTime = 0; },
  // h0:80e4 (DOS 0:a192): original handler is RTS.
  update() {},
  // h0:80e6 (DOS 0:a193): all messages accepted without effects.
  message() { return 1; },
  // h0:80f2 -> h0:11098 (DOS 12cc:174e): looping five-frame decoration.
  post(ctx, actor) {
    actor.spritePaths[0] = [animate(ctx, actor, SEQUENCE, 0xe6).frame];
    actor.spriteOffsetX[0] = -6;
    actor.spriteOffsetY[0] = 0;
    actor.spriteEnabled[0] = 1;
  },
  // h0:80f8 (DOS 0:a19d): draw its only part.
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx); },
};
