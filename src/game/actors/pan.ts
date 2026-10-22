import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { bumpObjects } from "../core/geometry.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import { animate, drawPart, saveRecord } from "./shared.ts";
import { actorDistance } from "./orb.ts";

// AGA +98..+a1: an electrified floor panel, live from its on step to its off step of an eight-step cycle.
export interface PanActor extends Actor {
  panStepTimer: number;
  panOnStep: number;
  panOffStep: number;
  panStep: number;
  panLive: number;
  panSpeedIndex: number;
  panStepLength: number;
  animationTime: number;
}

const STEP_LENGTHS = [5, 6, 4, 0]; // g:3fea, signed bytes per speed index
const SEQUENCE = [0, 1, 2, 3, 4, 5, 255]; // g:3f3f

// h0:9532 -> h0:12b88 (DOS 0:82aa) panStep(): advance the cycle; true when the panel has just switched on.
function step(ctx: ActorContext, a: PanActor): boolean {
  a.panStepTimer = u16(a.panStepTimer - ctx.state.frameTicks);
  if (s16(a.panStepTimer) >= 0) return false;
  a.panStepTimer = u16(a.panStepTimer + (s8(a.panStepLength) << 8));
  a.panStep = u8(a.panStep + 1);
  if (a.panStep === 8) a.panStep = 0;
  if (a.panOnStep === a.panStep) {
    a.panLive = 1;
    a.frame = 0;
    return true;
  }
  if (a.panOffStep === a.panStep) a.panLive = 0;
  return false;
}

// h0:8c72 (DOS 0:8359) touched(): a live panel zaps a low toucher within distance 7; except for ORB, TUB and ART
// touchers it also delays its own next step.
function touched(ctx: ActorContext, a: PanActor, sender: Actor | null): number {
  if (!a.panLive) return 0;
  if (!sender) throw new Error("AGA h0:8c72 reads the toucher of a floor panel; none was given");
  if (s16(actorDistance(a, sender)) >= 7) return 0;
  if (sender.height >= 2) return 0;
  ctx.objects.send(sender, { type: 9, sender: a });
  if (![6, 15, 11].includes(sender.classId)) a.panStepTimer = 0x2800;
  return 0;
}

export const panClass: ActorClass = {
  id: 14,
  name: "pan",
  createState: (): Partial<PanActor> => ({
    panStepTimer: 0, panOnStep: 0, panOffStep: 0, panStep: 0, panLive: 0, panSpeedIndex: 0, panStepLength: 0, animationTime: 0,
  }),
  // h0:8cf6 -> h0:950e -> h0:129f8 (DOS 0:83d7) init(record, object): the step length shortens by one per 100 scenes.
  init(ctx, actor, spec) {
    const a = actor as PanActor;
    a.panOnStep = (spec.params.onStep ?? 0) & 7;
    a.panOffStep = (spec.params.offStep ?? 0) & 7;
    a.panSpeedIndex = (spec.params.speedIndex ?? 0) & 3;
    a.panStepLength = u8(STEP_LENGTHS[a.panSpeedIndex]! - Math.trunc(ctx.state.sceneIndex / 100));
    a.panStepTimer = 0;
    a.panStep = 7;
    a.collisionDisabled = 1;
    a.activeThreat = 1;
  },
  // h0:8c1c -> h0:8c22 (DOS 0:82a6): switching on touches everything already standing on the panel.
  update(ctx, actor) {
    if (step(ctx, actor as PanActor)) bumpObjects(ctx, actor);
  },
  // h0:8c34 (DOS 0:830d) message(kind, msg): only 6 (touch) is handled.
  message(ctx, actor, message) {
    return s8(message.type) === 6 ? touched(ctx, actor as PanActor, message.sender) : 0;
  },
  // h0:8ce4 -> h0:9544 -> h0:1137e (DOS 0:83c2 -> 12cc:19cf) post(): animate while live at double speed in slow motion;
  // each completed loop advances the colour scheme 0..3.
  post(ctx, actor) {
    const a = actor as PanActor;
    const ticks = ctx.state.frameTicks;
    if (ctx.state.slowMotion) ctx.state.frameTicks = u16(ticks * 2);
    try {
      if (!a.panLive) {
        a.spriteEnabled[0] = 0;
        return;
      }
      a.spriteEnabled[0] = 1;
      const animation = animate(ctx, a, SEQUENCE, 0x96);
      if (animation.wrapped) {
        a.spriteScheme = u8(a.spriteScheme + 1);
        if (s8(a.spriteScheme) > 3) a.spriteScheme = 0;
      }
      a.spriteOffsetY[0] = 1;
      a.spritePaths = [[animation.frame]];
      a.spriteOffsetX[0] = 2;
    } finally {
      ctx.state.frameTicks = ticks;
    }
  },
  // h0:8cea (DOS 0:83c8).
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx, 0); },
  // h0:8d0c (DOS 0:8442) save(object, record): byte 3 from the cycle fields, then h0:41dc.
  save(_ctx, actor) {
    const a = actor as PanActor;
    return saveRecord(a, s8(a.panOnStep) | (s8(a.panOffStep) << 3) | (s8(a.panSpeedIndex) << 6));
  },
};
