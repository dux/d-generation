import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { s8, s16, s32 } from "../core/int.ts";
import { animate, drawPart, objectRecord } from "./shared.ts";

// AGA +14, +98..+a7: the courier's sled. Kind 0 lands in scene 1 at the start of a game, kind 5 descends behind the
// title, kinds 1..4 take off (kinds 3/4 as the jet pack of the ending).
export interface SledActor extends Actor {
  sledSpeed: number;
  sledAnimationTime: number;
  sledStepTime: number;
  sledLanded: number;
  sledDescending: number;
  sledWaitTime: number;
  sledWaiting: number;
  sledAscending: number;
  sledKind: number;
  sledJet: number;
  sledAltitude: number;
}

// g:127e: per-step braking of the landing descent, -1 terminated.
const BRAKING = [
  0x28, 0x3c, 0x32, 0x28, 0x64, 0x82, 0x17c, 0x244, 0x1f4, 0x1f4, 0x190, 0x12c, 0x12c, 0x3c, 0x3c, 0x1e,
  0x28, 0x32, 0x12c, 0x1d6, 0x230, 0x8c, 0xb4, 0x78, 0x50, 0x1e, 0x28, 0x96, 0x1fe, 0x2bc, 0x168, -1,
] as const;
const DOOR = [0, 1, 1, 0, 0, 0, -1] as const; // g:3fed
const STEP = 0x2bc;

// Bytes 1..2 of the signed 32-bit product (h0:7420, h0:76fc, h0:12c98): the 8.8 distance of one pass.
function travel(ctx: ActorContext, actor: SledActor): number {
  return s16(Math.imul(s16(ctx.state.frameTicks), s16(actor.sledSpeed)) >> 8);
}

// The 8.8 altitude as a signed word (bytes +a5..+a6).
function altitudeWord(actor: SledActor): number {
  return s16(actor.sledAltitude >> 8);
}

// h0:12c62: the jet descends with a speed that drops by 8 each step and never lands.
function descendJet(ctx: ActorContext, actor: SledActor): void {
  actor.sledStepTime = s16(actor.sledStepTime - ctx.state.frameTicks);
  if (actor.sledStepTime <= 0) {
    actor.sledStepTime = s16(actor.sledStepTime + STEP);
    actor.sledSpeed = s16(actor.sledSpeed - 8);
  }
  actor.sledAltitude = s32(actor.sledAltitude - travel(ctx, actor));
  if (actor.sledAltitude < 0x800) ctx.state.titleAnimation = 0;
}

// h0:766e: braked landing; touching down opens the hatch.
function descend(ctx: ActorContext, actor: SledActor): void {
  if (!actor.sledDescending) return;
  if (actor.sledJet) {
    descendJet(ctx, actor);
    return;
  }
  actor.sledStepTime = s16(actor.sledStepTime - ctx.state.frameTicks);
  if (actor.sledStepTime <= 0) {
    actor.sledStepTime = s16(actor.sledStepTime + STEP);
    const index = actor.frame;
    actor.frame = (actor.frame + 1) & 0xff;
    let braking: number = BRAKING[index]!;
    if (braking < 0) {
      actor.frame = 0;
      braking = BRAKING[0];
    }
    actor.sledSpeed = s16(actor.sledSpeed - (braking - 0xf5));
  }
  actor.sledAltitude = s32(actor.sledAltitude - travel(ctx, actor));
  if (actor.sledAltitude >= 0) return;
  actor.sledAltitude = 0;
  actor.sledLanded = 1;
  actor.sledDescending = 0;
  actor.frame = 0;
  ctx.emit({ type: "sound", id: 17 });
}

// h0:73de: accelerating take-off; above its ceiling the sled leaves the room.
function ascend(ctx: ActorContext, actor: SledActor): void {
  if (!actor.sledAscending) return;
  actor.sledStepTime = s16(actor.sledStepTime - ctx.state.frameTicks);
  if (actor.sledStepTime <= 0) {
    actor.sledStepTime = s16(actor.sledStepTime + STEP);
    actor.sledSpeed = s16(actor.sledSpeed + 100);
  }
  actor.sledAltitude = s32(actor.sledAltitude + travel(ctx, actor));
  // Only kinds 1..4 ascend; h0:7466 leaves the ceiling register unset for any other kind.
  const ceiling = actor.sledKind === 1 ? 0 : actor.sledKind === 2 ? 0x46 : actor.sledKind === 3 || actor.sledKind === 4 ? -0x82 : null;
  if (ceiling === null) throw new Error(`AGA sled kind ${actor.sledKind} cannot ascend`);
  if (altitudeWord(actor) <= ceiling + 0xa0) return;
  const index = ctx.state.sceneIndex;
  if (index === 0x66) {
    // h0:7490..74e6: the jet pack leaves the bombed building: aftermath picture or ending by kind and bomber.
    ctx.wait(0x32, false);
    actor.removed = ctx.state.round;
    if (actor.sledKind === 4) {
      ctx.bombed();
      ctx.state.endingId = ctx.state.endingAlt ? 3 : 4;
    } else if (ctx.state.bomberActive && s8(ctx.state.bomberMinutes) < 3) {
      ctx.bombed();
      ctx.state.endingId = 1;
    } else ctx.ending(0);
    return;
  }
  if (index !== 0x90) {
    ctx.requestRoom(0x91);
    ctx.objects.spawn(objectRecord(0x87, 0x80, 0xb7, 2));
  } else {
    // h0:7512 also clears the screen (h0:ad8a).
    ctx.requestRoom(0x67);
    ctx.objects.spawn(objectRecord(0x87, 0x84, 0x42, 3));
  }
}

// h0:12a6e: hatch animation once landed (returns 1 when the courier steps out), engine flame while flying.
function place(ctx: ActorContext, actor: SledActor): boolean {
  let leave = false;
  let frame = 0;
  if (actor.sledLanded) {
    actor.spriteEnabled[1] = 0;
    const hatch = animate(ctx, actor, DOOR, STEP, "sledAnimationTime");
    frame = hatch.frame;
    if (hatch.wrapped) {
      ctx.state.spawnX = ctx.state.spawnY = 0x7f;
      ctx.state.spawnDirection = 5;
      leave = true;
    }
  } else if (!actor.sledJet) {
    actor.spriteEnabled[1] = 1;
    actor.spritePaths[1] = [1, ctx.random.next(8)];
    actor.spriteOffsetX[1] = 12;
    actor.spriteOffsetY[1] = 3 - altitudeWord(actor);
  }
  actor.spritePaths[0] = actor.sledJet ? [actor.sledKind, ctx.random.next(7)] : [0, frame];
  actor.spriteOffsetX[0] = 0;
  actor.spriteOffsetY[0] = -altitudeWord(actor);
  return leave;
}

export const sliClass: ActorClass<SledActor> = {
  id: 23,
  name: "sli",
  createState: () => ({
    sledSpeed: 0, sledAnimationTime: 0, sledStepTime: 0, sledLanded: 0, sledDescending: 0, sledWaitTime: 0,
    sledWaiting: 0, sledAscending: 0, sledKind: 0, sledJet: 0, sledAltitude: 0,
  }),
  // h0:77ca -> h0:1292a (DOS 0:6f3f): byte 3 selects the flight.
  init(_ctx, actor, spec) {
    if (spec.class !== "sli") throw new Error("AGA sled requires sli record");
    actor.sledKind = spec.params.unknownArgument;
    switch (actor.sledKind) {
      case 0:
        actor.sledAltitude = 0x7800;
        actor.sledSpeed = 0x14;
        actor.sledWaitTime = 0xf00;
        actor.sledWaiting = actor.sledDescending = 1;
        break;
      case 1:
        actor.sledWaitTime = 0x3200;
        actor.sledWaiting = actor.sledAscending = 1;
        break;
      case 2:
        actor.sledWaitTime = 0x1e00;
        actor.sledWaiting = actor.sledAscending = 1;
        actor.sledSpeed = 0x834;
        actor.sledAltitude = -0x1900;
        break;
      case 3:
      case 4:
        actor.sledAscending = actor.sledJet = 1;
        actor.sledSpeed = 0xfa;
        break;
      case 5:
        actor.x = (actor.x & 0xff) | 0x7100;
        actor.y = (actor.y & 0xff) | 0x8000;
        actor.sledSpeed = 0x172;
        actor.sledAltitude = 0x5f00;
        actor.sledJet = 1;
        actor.sledWaitTime = 0x1100;
        actor.sledWaiting = actor.sledDescending = 1;
        actor.sledKind = 3;
        break;
    }
  },
  // h0:73b2 (DOS 0:6c33): wait, then fly.
  update(ctx, actor) {
    if (actor.sledWaiting) {
      actor.sledWaitTime = s16(actor.sledWaitTime - ctx.state.frameTicks);
      if (actor.sledWaitTime <= 0) actor.sledWaiting = 0;
      return;
    }
    descend(ctx, actor);
    ascend(ctx, actor);
  },
  // h0:774e (DOS 0:6d90).
  message() {
    return 1;
  },
  // h0:775a (DOS 0:6dd5): the courier steps out as the player; the sled is gone.
  post(ctx, actor) {
    if (!place(ctx, actor)) return;
    const state = ctx.state;
    ctx.objects.spawnPlayer(state.spawnX * 256, state.spawnY * 256, state.spawnDirection); // h0:17d8 -> g:85c8
    ctx.world.savePlayerState(state); // h0:e6a
    ctx.world.saveCheckpoint(state); // h0:e7e
    ctx.objects.spawn(objectRecord(0x07, 0x82, 0x7e, 0xa0)); // h0:14f2
    actor.removed = state.round;
  },
  // h0:7782 (DOS 0:6e0e): flame, then hull, clipped above the panel (and below row 11 for the jet).
  draw(ctx, actor, gfx) {
    const clip = { left: 0, top: actor.sledKind >= 3 ? 11 : 0, right: 320, bottom: 0xa1 };
    drawPart(ctx, actor, gfx, 1, clip);
    drawPart(ctx, actor, gfx, 0, clip);
  },
};
