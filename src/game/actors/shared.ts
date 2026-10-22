import { decodeRoomBlock, type ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorContext } from "../core/model.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import type { Gfx } from "../render/gfx.ts";
import { drawObjectPart } from "../render/objects.ts";
import type { RemainsActor } from "./exp.ts";

// h0:f7f0 (DOS 12cc:0768): advance a signed, -1-terminated animation sequence.
export function animate<T extends Actor>(ctx: ActorContext, actor: T, sequence: readonly number[], period: number, timerField: keyof T = "animationTime" as keyof T): { frame: number; wrapped: boolean } {
  let time = s16(Number(actor[timerField]) - ctx.state.frameTicks);
  let wrapped = false;
  while (time < 0) {
    actor.frame = u8(actor.frame + 1);
    if (sequence[actor.frame] === 0xff || sequence[actor.frame] === -1) {
      actor.frame = 0;
      wrapped = true;
    }
    if (sequence[actor.frame] === undefined) throw new Error(`AGA animation index ${actor.frame} outside sequence`);
    time = s16(time + period);
  }
  actor[timerField] = u16(time) as T[keyof T];
  const frame = sequence[actor.frame];
  if (frame === undefined) throw new Error(`AGA animation index ${actor.frame} outside sequence`);
  return { frame: s8(frame), wrapped };
}

// h0:4322 (DOS 0:47e9): saturating signed-word countdown, firing only once.
export function countDown(ctx: ActorContext, value: number): { value: number; expired: boolean } {
  if (!u16(value)) return { value: 0, expired: false };
  const next = s16(value - ctx.state.frameTicks);
  return next <= 0 ? { value: 0, expired: true } : { value: next, expired: false };
}

// h0:41dc (DOS 0:4642) / h0:4220: rebuild the four disk bytes from live fields, then decode them as level data.
// The fine variant rounds the position in place (+8) and stores 1/16 fractions like ORB/TUB/BAR records.
export function saveRecord(actor: Actor, argument: number, fine = false): ObjectSpec {
  let byte0 = (actor.classId & 15) | ((actor.classId & 16) << 3);
  if (fine) {
    actor.x = u16(actor.x + 8);
    actor.y = u16(actor.y + 8);
    byte0 |= actor.x & 0x70;
    argument = (actor.y & 0xf0) | ((actor.x & 0xff) >> 4 & 8) | s8(argument);
  } else byte0 |= s8(actor.direction) << 4;
  return objectRecord(byte0, actor.x >>> 8, actor.y >>> 8, argument);
}

// Four-byte object record (class/orientation, x, y, argument) as the level decoder reads it, e.g. h0:1878 spawn records.
export function objectRecord(byte0: number, x: number, y: number, argument: number): ObjectSpec {
  const block = new Uint8Array(0x434);
  block.set([byte0 & 255, x & 255, y & 255, argument & 255], 0x1e);
  const record = decodeRoomBlock(block).objects[0];
  if (!record) throw new Error(`AGA object record ${byte0} is empty`);
  return record;
}

// h0:3e36 (DOS 0:42bd): consume an actor and create the drifting class-17 remains.
export function spawnRemains(ctx: ActorContext, actor: Actor, _effect: number, direction: number, speed: number, sound = 7): Actor | null {
  const height = Math.max(0, s8(actor.height - 8));
  actor.removed = ctx.state.round;
  actor.collisionDisabled = 1;
  const remains = ctx.objects.spawn(17, { class: "exp", x: actor.x >>> 8, y: actor.y >>> 8, params: { variant: 0 } });
  if (!remains) throw new Error("AGA h0:3e36 exhausted object pool for remains");
  const effect = remains as RemainsActor;
  effect.height = u8(height);
  effect.facing = u8(direction);
  effect.direction = u8(direction);
  effect.speed = u8(speed);
  effect.remainsSourceClass = actor.classId;
  ctx.emit({ type: "sound", id: sound });
  return remains;
}

// h0:533a (in the shared death routine h0:524a): touching the D/Generation creature (class 26) is not a death.
// In scene index 0x39 it moves to the scene-0x45 story room with a remains object; anywhere else it starts the
// alternate ending (g:bfc). Record byte 3 of the remains is stack left over in the original; 0 matches the harness.
export function dgenTouch(ctx: ActorContext): void {
  ctx.state.invulnerable = 0;
  if (ctx.state.sceneIndex === 0x39) {
    ctx.state.useDisabled = 0;
    ctx.state.specialItemCollected = 1;
    ctx.storyTransition(0x45);
    const remains = ctx.objects.spawn(objectRecord(0x81, 0x7f, 0x52, 0));
    if (!remains) throw new Error("AGA h0:533a writes the remains it could not create");
    remains.height = 8;
    remains.facing = remains.direction = 1;
    ctx.emit({ type: "sound", id: 7 });
    return;
  }
  ctx.storyTransition(0x8e);
  ctx.state.endingAlt = 1;
}

// h0:3b1a drawObjectPart() (projection h0:e2b2, floor-edge occlusion h0:b240, blit h0:d336).
export function drawPart(ctx: ActorContext, base: Actor, gfx: Gfx, part = 0, clip?: { left: number; top: number; right: number; bottom: number }, mirror = base.spriteMirror): void {
  drawObjectPart(ctx, base, gfx, part, clip, mirror);
}
