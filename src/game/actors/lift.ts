import type { Actor, ActorClass } from "../core/model.ts";
import { s8, u8, u16 } from "../core/int.ts";
import { animate, drawPart, saveRecord } from "./shared.ts";
import { showMessage } from "../core/messages.ts";

// AGA +98..+a4.
export interface LiftActor extends Actor {
  liftArrival: number;
  liftRunning: number;
  animationTime: number;
  liftDestination: number;
  liftTimer: number;
  liftClipBottom: number;
  liftClipTop: number;
  liftDoorsOpen: number;
}

const CABIN = [0, 1, 2, 3, 4, 5, 6, 7, 255] as const; // g:3ca4.
const DOORS = [2, 2, 2, 1, 0, 0, 255] as const; // g:3cad.

export const liftClass: ActorClass<LiftActor> = {
  id: 18,
  name: "lift",
  createState: () => ({ liftArrival: 0, liftRunning: 0, animationTime: 0, liftDestination: 0, liftTimer: 0, liftClipBottom: 0, liftClipTop: 0, liftDoorsOpen: 0 }),
  // h0:7a64 -> h0:12c00 (DOS 0:63ee): AGA scene137 overrides destination to33.
  init(ctx, actor, spec) {
    if (spec.class !== "lift") throw new Error("AGA lift requires lift record");
    actor.facing = 0;
    actor.liftArrival = spec.params.arrival;
    actor.liftRunning = 0;
    actor.liftDestination = ctx.state.sceneIndex === 136 ? 33 : spec.params.destination;
    actor.liftTimer = 0;
    actor.liftClipBottom = 0;
    actor.liftClipTop = 0;
    actor.liftDoorsOpen = actor.liftArrival ? 1 : 0;
    actor.animationTime = 0;
    actor.collisionDisabled = 1;
    actor.x = (actor.x & 0xff00) | 0x80;
    if (actor.liftArrival) actor.frame = 4;
  },
  // h0:783c / 7924 / 78a4 / 784a (DOS 0:61c7): tick, arrival, then departure.
  update(ctx, actor) {
    if (actor.liftRunning) actor.liftTimer = u16(actor.liftTimer + ctx.state.frameTicks);
    if (actor.liftRunning && actor.liftArrival) {
      if (s8(actor.liftTimer >>> 8) < 2) actor.liftDoorsOpen = 0;
      else {
        actor.liftRunning = 0;
        actor.liftDoorsOpen = 1;
        actor.liftArrival = 1;
        actor.animationTime = 0;
        actor.frame = 4;
        ctx.state.spawnX = u8((actor.x >>> 8) + 1);
        ctx.state.spawnY = actor.y >>> 8;
        ctx.state.spawnDirection = 4;
        // h0:7906: record g:340 with the new x/y; its orientation byte g:343 is 0.
        ctx.state.player = ctx.objects.spawnPlayer(ctx.state.spawnX << 8, ctx.state.spawnY << 8, 0);
        ctx.saveCheckpoint();
      }
    }
    if (actor.liftRunning && !actor.liftArrival && s8(actor.liftTimer >>> 8) >= 30) {
      let rawScene = Math.trunc(ctx.state.sceneIndex / 50) * 50 + actor.liftDestination - 1;
      if (actor.liftDestination === 1) rawScene += 50;
      ctx.departLift(u8(rawScene) + 1);
    }
  },
  // h0:7938 / 7968 / 797e (DOS 0:62aa): call an arrival lift or enter a departure lift.
  message(ctx, actor, message) {
    if (message.type === 5) {
      actor.liftRunning = 1;
      actor.liftTimer = (actor.liftTimer & 255) | 0xf100;
      return 1;
    }
    if (message.type !== 6) return 0;
    if (!actor.liftArrival && message.sender?.classId === 0) {
      message.sender.removed = ctx.state.round;
      actor.liftRunning = 1;
      showMessage(ctx, `\`Entering Floor ${ctx.state.buildingFloor + 1}`, 3, 2);
      ctx.emit({ type: "sound", id: 25 });
    }
    return 1;
  },
  // h0:79d4 -> h0:fde8 (DOS 0:6357): cabin and lift-door animation parts.
  post(ctx, actor) {
    actor.spriteMirror = 0;
    actor.spriteShade = 0;
    if (actor.liftRunning) {
      let frame = animate(ctx, actor, CABIN, 0x12c).frame;
      actor.spriteOffsetX[1] = 2;
      actor.spriteOffsetY[1] = -s8(actor.liftTimer >>> 8);
      actor.spriteEnabled[1] = 1;
      if (frame > 4) {
        actor.spriteMirror = 1;
        frame = 8 - frame;
        actor.spriteMirrorWidth.fill(19);
      }
      actor.spritePaths[1] = [2, frame];
      if (actor.liftArrival) actor.liftClipBottom = u8((actor.y >>> 8) - ctx.state.scrollY + 2);
    } else actor.spriteEnabled[1] = 0;
    if (!actor.liftArrival) {
      actor.liftClipTop = u8(Math.max(0, (actor.y >>> 8) - ctx.state.scrollY - 30));
      actor.spriteEnabled[2] = 1;
      actor.spriteOffsetY[2] = -30;
      actor.spriteOffsetX[2] = 2;
      actor.spritePaths[2] = [0, 0];
    } else actor.spriteEnabled[2] = 0;
    actor.spriteOffsetX[0] = 2;
    actor.spriteOffsetY[0] = 0;
    let frame = actor.liftArrival ? 2 : 0;
    if (actor.liftDoorsOpen) {
      const doors = animate(ctx, actor, DOORS, 0x140);
      frame = doors.frame;
      if (doors.wrapped) { actor.frame = 4; frame = 0; }
    }
    actor.spritePaths[0] = [1, frame];
    actor.spriteEnabled[0] = 1;
  },
  // h0:79da (DOS 0:635d): unmirrored frame/front around the clipped moving cabin.
  draw(ctx, actor, gfx) {
    drawPart(ctx, actor, gfx, 0, undefined, 0);
    drawPart(ctx, actor, gfx, 1, { left: 0, top: actor.liftArrival ? 0 : actor.liftClipTop, right: 320, bottom: actor.liftArrival ? actor.liftClipBottom : 182 });
    if (!actor.liftArrival) drawPart(ctx, actor, gfx, 2, undefined, 0);
  },
  // h0:7a7a (DOS 0:643e): byte 3 = arrival | destination<<1.
  save(_ctx, actor) {
    return saveRecord(actor, (actor.liftArrival ? 1 : 0) | (actor.liftDestination << 1));
  },
};
