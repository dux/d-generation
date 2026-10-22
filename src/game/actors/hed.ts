import type { ObjectSpec } from "../../formats/level.ts";
import { moveActor, teleportActor } from "../core/geometry.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import type { Gfx } from "../render/gfx.ts";
import { animate, drawPart, spawnRemains } from "./shared.ts";

export interface HeadActor extends Actor { headTime: number;
headVerticalSpeed: number;
headHeightFraction: number;
headAnimationTime: number; }

const SEQUENCE = [0, 1, 2, 3, -1] as const; // g:3eef
const KNOCKABLE = [20, 19, 21, 0] as const; // g:12ff

// h0:8104 (DOS 0:a1ac): initialise the shared word whose high byte is drift speed.
export function hedInit(ctx: ActorContext, base: Actor, _spec: ObjectSpec): void {
  const actor = base as HeadActor;
  actor.headTime = 0x3000;
  actor.headVerticalSpeed = -0x600;
  actor.headHeightFraction = 0;
  actor.headAnimationTime = 0;
  actor.facing = 0;
  actor.height = 15;
  actor.ignoredClass = 12;
  actor.frame = ctx.random.next(4);
}

// h0:813a (DOS 0:a1dc): word-height gravity and bounce, then mode-five drift.
export function hedUpdate(ctx: ActorContext, base: Actor): void {
  const actor = base as HeadActor;
  actor.headTime = Math.max(0, s16(actor.headTime - ctx.state.frameTicks));
  let height = s16((actor.height << 8) | actor.headHeightFraction);
  height = s16(height - actor.headVerticalSpeed);
  if (height < 0) {
    actor.headVerticalSpeed = s16(0x190 - actor.headVerticalSpeed);
    height = 0;
  }
  actor.height = u16(height) >>> 8;
  actor.headHeightFraction = u8(height);
  actor.headVerticalSpeed = s16(actor.headVerticalSpeed + ctx.state.frameTicks);
  actor.speed = actor.headTime >>> 8;
  moveActor(ctx, actor, 5);
}

// h0:81ac/h0:81f2/h0:8204 (DOS 0:a23c): turn, guarded teleport, or knockable remains.
export function hedMessage(ctx: ActorContext, base: Actor, message: ActorMessage): number {
  const actor = base as HeadActor;
  switch (message.type & 0xff) {
    case 0:
    case 8:
      actor.direction = u8(message.direction ?? 0);
      return 0;
    case 2:
      return Number(teleportActor(ctx, actor, message.x ?? 0, message.y ?? 0));
    case 9:
      if ((KNOCKABLE as readonly number[]).includes(actor.classId) && message.sender) {
        spawnRemains(ctx, actor, 2, s8(message.sender.direction), message.sender.speed);
      }
      return 0;
    default:
      return 1;
  }
}

// h0:8242 -> h0:11004 (DOS 12cc:16a4): slow the rotation as the high drift byte falls.
export function hedPost(ctx: ActorContext, base: Actor): void {
  const actor = base as HeadActor;
  const speed = s8(actor.speed);
  const frame = speed > 2
    ? animate(ctx, actor, SEQUENCE, 0x1c2 + (speed < 13 ? (13 - speed) * 50 : 0), "headAnimationTime").frame
    : SEQUENCE[0];
  actor.spritePaths[0] = [frame];
  actor.spriteEnabled[0] = 1;
  actor.spriteOffsetX[0] = 0;
  actor.spriteOffsetY[0] = 0;
}

// h0:8248 (DOS 0:a2ec): draw the selected head frame.
export function hedDraw(ctx: ActorContext, actor: Actor, gfx: Gfx): void {
  drawPart(ctx, actor, gfx);
}

export const hedClass: ActorClass = {
  id: 24,
  name: "hed",
  init: hedInit,
  update: hedUpdate,
  message: hedMessage,
  post: hedPost,
  draw: hedDraw,
};
