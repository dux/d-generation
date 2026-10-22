import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { s16, u16 } from "../core/int.ts";
import { animate, countDown, drawPart } from "./shared.ts";
import type { GeneratorActor } from "./cgen.ts";

// AGA +f, +14, +98..+a1: scripted ending animations. Kind 0 drops from the ceiling and starts the jet-pack
// countdown, kind 1 is a figure of the bomb aftermath, kind 2 is the cannon fired from the scene-122 switch,
// kind 3 loops with a random phase.
export interface AnimationActor extends Actor {
  anmHeightFraction: number;
  anmSpeed: number;
  anmAnimationTime: number;
  anmDelay: number;
  anmLanded: number;
  anmKind: number;
  anmTriggered: number;
  anmTime: number;
}

const LANDED = [10, 10, 10, 10, 0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, -1] as const; // g:3f1b
const CANNON = [0, 1, 2, 3, 4, 5, 6, -1] as const; // g:3f2d
const LOOP = [0, 1, 2, 3, 4, 5, 6, 7, 8, -1] as const; // g:3f35
const LANDING_SHAKE = [-4, -2, -1, 0, 128] as const; // g:18e8

// h0:8366: while fired, the beam kills a DGEN standing on its diagonal.
function fireCannon(ctx: ActorContext, actor: AnimationActor): void {
  if (!actor.anmTriggered) return;
  const time = countDown(ctx, actor.anmTime);
  actor.anmTime = time.value;
  if (time.expired) {
    // h0:8544 (h10:37e4) only masks the audio interrupts.
    actor.anmTriggered = 0;
    return;
  }
  ctx.emit({ type: "sound", id: 36 });
  // h0:e584 returns the first class-26 slot.
  const dgen = ctx.objects.slots.find(other => other?.classId === 26) as GeneratorActor | undefined;
  if (!dgen) return;
  const band = (u16(((dgen.x >>> 8) - (dgen.y >>> 8) + 0x100) << 7) >>> 8);
  if (band >= 0x82 || band <= 0x7a || dgen.generatorDying) return;
  ctx.objects.send(dgen, { type: 9, sender: actor });
}

// h0:82aa (DOS 0:a31e): after the delay, fall with speed += ticks/4, height -= 3*ticks*speed/256.
function fall(ctx: ActorContext, actor: AnimationActor): void {
  if (actor.anmDelay) {
    actor.anmDelay = s16(actor.anmDelay - ctx.state.frameTicks);
    if (actor.anmDelay < 0) actor.anmDelay = 0;
    return;
  }
  if (!actor.height) return;
  const ticks = s16(ctx.state.frameTicks);
  actor.anmSpeed = s16(actor.anmSpeed + (ticks >> 2));
  const height = u16(((actor.height << 8) | actor.anmHeightFraction) - (Math.imul(ticks * 3, actor.anmSpeed) >> 8));
  actor.height = height >>> 8;
  actor.anmHeightFraction = height & 0xff;
  if (actor.height <= 0x7f) return;
  actor.height = actor.anmHeightFraction = 0;
  ctx.emit({ type: "sound", id: 38 });
  ctx.state.shakeScript = LANDING_SHAKE;
  actor.anmLanded = 1;
  ctx.state.roomEffect = 1;
  ctx.state.endingTime = 0x3200;
}

export const anmClass: ActorClass<AnimationActor> = {
  id: 25,
  name: "anm",
  createState: () => ({
    anmHeightFraction: 0, anmSpeed: 0, anmAnimationTime: 0, anmDelay: 0, anmLanded: 0, anmKind: 0, anmTriggered: 0, anmTime: 0,
  }),
  // h0:8254 (DOS 0:a2fb).
  init(ctx, actor, spec) {
    if (spec.class !== "anm") throw new Error("AGA animation requires anm record");
    actor.collisionDisabled = 1;
    actor.anmKind = spec.params.unknownArgument;
    if (actor.anmKind === 0) {
      actor.height = 0x78;
      actor.anmDelay = 0x2800;
    } else if (actor.anmKind === 3) actor.anmAnimationTime = u16(ctx.random.next(8) * 1400 + 3000);
  },
  // h0:82aa (DOS 0:a31e).
  update(ctx, actor) {
    if (actor.anmKind === 2) fireCannon(ctx, actor);
    else if (actor.anmKind === 0) fall(ctx, actor);
  },
  // h0:83f8 (DOS 0:a3bd).
  message() {
    return 1;
  },
  // h0:8404 -> h0:11216 (DOS 12cc:191d).
  post(ctx, actor) {
    if (actor.anmKind === 1) actor.spritePaths[0] = [1, 0, ctx.random.next(10)];
    else if (actor.anmKind === 2) {
      actor.spritePaths[0] = actor.anmTriggered ? [2, 1, animate(ctx, actor, CANNON, 0xc8, "anmAnimationTime").frame] : [2, 0, 0];
    } else if (actor.anmKind === 3) {
      const loop = animate(ctx, actor, LOOP, 0x898, "anmAnimationTime");
      let frame = loop.frame;
      if (loop.wrapped) actor.frame = frame = 8;
      actor.spritePaths[0] = [3, 0, frame];
    } else if (actor.anmKind === 0) {
      // Part 1 is the hole in the ceiling; part 0 the figure, shown once it has landed.
      actor.spriteEnabled[1] = 1;
      actor.spritePaths[1] = [0, 0, 0];
      actor.spriteOffsetX[1] = -4;
      if (actor.anmLanded) {
        const frame = animate(ctx, actor, LANDED, 0x47e, "anmAnimationTime").frame;
        if (frame !== 10) {
          actor.spriteEnabled[0] = 1;
          actor.spritePaths[0] = [0, 1, frame];
          actor.spriteOffsetX[0] = -4;
        }
      } else actor.spriteEnabled[0] = 0;
    }
  },
  // h0:840a (DOS 0:a3c7): part 1 then part 0, into the front buffer.
  draw(ctx, actor, gfx) {
    drawPart(ctx, actor, gfx, 1);
    drawPart(ctx, actor, gfx, 0);
  },
};
