import type { ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorClass } from "../core/model.ts";
import { blocked, chase } from "../core/geometry.ts";
import { u16 } from "../core/int.ts";
import { countDown, drawPart, saveRecord } from "./shared.ts";

// AGA +98..+9f.
export interface VentActor extends Actor {
  ventOff: number;
  ventHostileLimit: number;
  ventCreatureKind: number;
  ventTimer: number;
  ventPeriod: number;
  ventFrameSet: number;
}

const PERIODS = [48, 34, 26, 15] as const; // g:937; fourth byte overlaps g:93a.
const CREATURES = [15, 6, 22] as const; // g:93a.
const SHUTDOWN = [0, 0, 1, 2, 2, 255, 3, 3, 255] as const; // g:93d.

export const venClass: ActorClass<VentActor> = {
  id: 13,
  name: "ven",
  createState: () => ({ ventOff: 0, ventHostileLimit: 0, ventCreatureKind: 0, ventTimer: 0, ventPeriod: 0, ventFrameSet: 0 }),
  // h0:4a4c (DOS 0:4f58): AGA keeps a random delay and an active-threat flag.
  init(ctx, actor, spec) {
    if (spec.class !== "ven") throw new Error("AGA vent requires ven record");
    actor.ventCreatureKind = spec.params.creatureKind;
    actor.ventHostileLimit = spec.params.hostileLimit;
    actor.ventFrameSet = spec.params.frameAndPeriodIndex;
    actor.ventOff = spec.params.off ? 1 : 0;
    actor.frame = actor.ventOff ? 3 : 0;
    actor.collisionDisabled = 1;
    actor.ventTimer = u16((ctx.random.next(20) + 20) << 8);
    actor.ventPeriod = PERIODS[actor.ventFrameSet]!;
    actor.activeThreat = 1;
  },
  // h0:4b14 / h0:4b1a (DOS 0:501f / 0:5023): dispense only with a clear player probe.
  update(ctx, actor) {
    if (actor.ventOff) return;
    const timer = countDown(ctx, actor.ventTimer);
    actor.ventTimer = timer.value;
    if (!timer.expired) return;
    const player = ctx.state.player;
    if (ctx.objects.countHostiles() > actor.ventHostileLimit || !player || chase(ctx, actor, player, 70, 4) === -1) {
      actor.ventTimer = u16(actor.ventTimer + 0xf00);
      return;
    }
    actor.ventTimer = u16(actor.ventTimer + (actor.ventPeriod << 8));
    const classId = CREATURES[actor.ventCreatureKind];
    if (classId === undefined) throw new Error(`AGA vent creature kind ${actor.ventCreatureKind} has no g:93a entry`);
    const facing = ctx.random.next(7);
    const name = classId === 15 ? "tub" : classId === 6 ? "orb" : "cgen";
    const creature = ctx.objects.spawn(classId, { class: name, x: actor.x >>> 8, y: actor.y >>> 8, params: { facing, unknownArgument: facing, unknownOrientation: 0, dormant: 0, playerTriggered: 0 } } as ObjectSpec);
    if (!creature) return;
    // h0:4bbc writes the class-specific byte at +9c, not the tub waking flag.
    if (classId === 6) (creature as typeof creature & { attackReset: number }).attackReset = 1;
    else if (classId === 15) (creature as typeof creature & { attackDamage: number }).attackDamage = 1;
    else (creature as typeof creature & { nudgePending: number }).nudgePending = 1;
    creature.frame = 22;
    const height = creature.height;
    creature.height = 0;
    if (blocked(ctx, creature)) creature.removed = 1;
    creature.height = height;
  },
  // h0:4bf2 / h0:4c10 (DOS 0:5109 / 0:5151): touching player powers it down.
  message(ctx, actor, message) {
    if (message.type !== 6) return 0;
    if (message.sender?.classId === 0 && !actor.ventOff) {
      actor.ventOff = 1;
      actor.frame = 0;
      ctx.objects.checkRoomCleared(1);
      ctx.emit({ type: "sound", id: 59 });
    }
    return 1;
  },
  // h0:4c44 (DOS 0:5183): select before incrementing the shutdown frame index.
  post(_ctx, actor) {
    const frame = SHUTDOWN[actor.frame];
    if (frame === undefined) throw new Error(`AGA vent shutdown frame ${actor.frame} outside table`);
    if (actor.ventOff && actor.frame < 4) actor.frame++;
    actor.spritePaths[0] = [frame];
    actor.spriteOffsetX[0] = 2;
    actor.spriteOffsetY[0] = 0;
    actor.spriteEnabled[0] = 1;
  },
  // h0:4c96 (DOS 0:51df): draw its sole part.
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx); },
  // h0:4ad4 (DOS 0:4fd0): byte 3 = kind | limit<<2 | frame set<<4 | off<<6; the timer does not persist.
  save(_ctx, actor) {
    return saveRecord(actor, actor.ventCreatureKind | (actor.ventHostileLimit << 2) | (actor.ventFrameSet << 4) | (actor.ventOff ? 0x40 : 0));
  },
};
