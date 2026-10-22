import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { boxesOverlap } from "../core/geometry.ts";
import { s8, u8 } from "../core/int.ts";
import { animate, drawPart, saveRecord } from "./shared.ts";

// AGA +98..+ad: a teleporter pad; pads with the same link id are connected.
export interface TelActor extends Actor {
  telLastFrame: number;
  telPeriod: number;
  telAnimationTime: number;
  telActive: number;
  telPassenger: Actor | null;
  telOccupied: number;
  telDestination: TelActor | null;
  telLink: number;
  telPassengerId: number;
}

const TELEPORTABLE = [9, 0, 20, 24, 21, 6, 15, 19] as const; // g:925, terminated by ff
const PAD = [0, 1, 1, 2, 2, 3, 2, 1, 0, 0, -1] as const; // g:3f55
const BEAM = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1] as const; // g:3f60

// h0:4628 (DOS 0:4ab4): stop when the passenger's pool entry no longer holds the same object.
function checkPassenger(actor: TelActor): void {
  if (!actor.telActive && !actor.telOccupied) return;
  if (actor.telPassenger!.id === actor.telPassengerId) return;
  actor.frame = 0;
  actor.telOccupied = 0;
  actor.telActive = 0;
}

// h0:46e0 (DOS 0:4b8a): the pad rearms once the passenger has stepped off it.
function checkLeft(actor: TelActor): void {
  if (actor.telOccupied && !boxesOverlap(actor, actor.telPassenger!)) actor.telOccupied = 0;
}

// h0:4700 (DOS 0:4bb0): message 2 moves the passenger one unit above the destination pad.
function sendPassenger(ctx: ActorContext, actor: TelActor): void {
  const destination = actor.telDestination!;
  const passenger = actor.telPassenger!;
  if (ctx.objects.send(passenger, { type: 2, sender: actor, x: destination.x, y: (destination.y + 0xff00) & 0xffff })) {
    destination.telPassenger = actor.telPassenger;
    destination.telOccupied = 1;
    // g:3f80 = 2 only delays the dirty-rectangle redraw (h0:11654), which the native renderer does not have.
  } else {
    actor.telOccupied = 1;
    passenger.noTurn = 0;
  }
}

// h0:465e (DOS 0:4aef): events of the animation steps passed since the last update.
function runAnimation(ctx: ActorContext, actor: TelActor): void {
  const passenger = actor.telPassenger;
  if (!actor.telActive || actor.telLastFrame === actor.frame) return;
  for (let step = s8(actor.telLastFrame + 1); step <= s8(actor.frame); step = s8(step + 1)) {
    if (step === 1) ctx.emit({ type: "sound", id: passenger!.classId === 0 ? 9 : 10 });
    else if (step === 5) sendPassenger(ctx, actor);
    else if (step === 6) passenger!.noTurn = 0;
    else if (step === 9) actor.telActive = 0;
  }
  actor.telLastFrame = actor.frame;
}

// h0:47c2 (DOS 0:4c82): next class-3 slot after *index other than the pad, with the same link.
function nextLinked(ctx: ActorContext, pad: TelActor, cursor: { index: number }): TelActor | null {
  // h0:e584 walks the slot list without a removed check.
  while (cursor.index < 30) {
    const other = ctx.objects.slots[cursor.index++];
    if (other?.classId === 3 && other !== pad && (other as TelActor).telLink === pad.telLink) return other as TelActor;
  }
  return null;
}

// h0:4772 (DOS 0:4c24): a random linked pad.
function pickDestination(ctx: ActorContext, pad: TelActor): TelActor | null {
  const cursor = { index: 0 };
  let count = 0;
  while (nextLinked(ctx, pad, cursor)) count = u8(count + 1);
  if (!count) return null;
  let n = s8(ctx.random.next(s8(count)));
  cursor.index = 0;
  let found: TelActor | null;
  do {
    found = nextLinked(ctx, pad, cursor);
    n = s8(n - 1);
  } while (n >= 0);
  return found;
}

// h0:480c (DOS 0:4d0c): an idle pad stepped on by a teleportable class pulls it in and starts both pads.
function start(ctx: ActorContext, actor: TelActor, sender: Actor): number {
  if (actor.telOccupied || actor.telActive) return 0;
  if (!(TELEPORTABLE as readonly number[]).includes(sender.classId)) return 0;
  const destination = pickDestination(ctx, actor);
  if (!destination || destination.telActive) return 0;
  actor.telDestination = destination;
  if (!ctx.objects.send(sender, { type: 2, sender: actor, x: actor.x, y: (actor.y + 0xff00) & 0xffff })) return 0;
  sender.noTurn = 1;
  actor.telActive = 1;
  actor.telLastFrame = 0;
  actor.telPeriod = sender.classId === 20 || sender.classId === 19 ? 0x140 : 0x1c2;
  actor.telPassenger = destination.telPassenger = sender;
  actor.telPassengerId = destination.telPassengerId = sender.id;
  actor.frame = 0;
  return 1;
}

export const telClass: ActorClass<TelActor> = {
  id: 3,
  name: "tel",
  createState: () => ({
    telLastFrame: 0, telPeriod: 0, telAnimationTime: 0, telActive: 0, telPassenger: null, telOccupied: 0,
    telDestination: null, telLink: 0, telPassengerId: 0,
  }),
  // h0:45d4 (DOS 0:4a69): byte 3 low two bits are the link id.
  init(_ctx, actor, spec) {
    if (spec.class !== "tel") throw new Error("AGA teleporter requires tel record");
    actor.telLink = spec.params.linkId;
    actor.telPeriod = 0x15e;
    actor.collisionDisabled = 1;
  },
  // h0:461a (DOS 0:4aaa).
  update(ctx, actor) {
    checkPassenger(actor);
    checkLeft(actor);
    runAnimation(ctx, actor);
  },
  // h0:47ee (DOS 0:4cc4): only the step-on message 6 is handled.
  message(ctx, actor, message) {
    return u8(message.type) === 6 ? start(ctx, actor, message.sender!) : 0;
  },
  // h0:4910 -> h0:11442 (DOS 12cc:1a8a): pad animation and the arrival beam drawn over the destination pad.
  post(ctx, actor) {
    let frame = 0;
    if (actor.telActive) {
      frame = animate(ctx, actor, PAD, actor.telPeriod, "telAnimationTime").frame;
      actor.firstLayer = 0;
    } else {
      actor.firstLayer = 1;
      actor.frame = 0;
    }
    actor.spritePaths[0] = [0, frame];
    actor.spriteOffsetX[0] = -1;
    if (actor.telActive) {
      const destination = actor.telDestination!;
      actor.spriteEnabled[1] = 1;
      actor.spritePaths[1] = [1, BEAM[actor.frame]!];
      actor.spriteOffsetX[1] = ((destination.x >>> 8) - (actor.x >>> 8)) * 2 - 3;
      actor.spriteOffsetY[1] = (destination.y >>> 8) - (actor.y >>> 8);
    } else actor.spriteEnabled[1] = 0;
  },
  // h0:4916 (DOS 0:4e13): pad, then beam.
  draw(ctx, actor, gfx) {
    drawPart(ctx, actor, gfx, 0);
    drawPart(ctx, actor, gfx, 1);
  },
  // h0:45fe (DOS 0:4a8c): byte 3 = link id.
  save(_ctx, actor) {
    return saveRecord(actor, actor.telLink);
  },
};
