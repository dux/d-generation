import type { Dialogue, ObjectSpec } from "../../formats/level.ts";
import { angle, animateWalk, moveActor, nearActor, nudge, sightActor, teleportActor } from "../core/geometry.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { flash } from "./cgen.ts";
import { animate, countDown, dgenTouch, drawPart, saveRecord, spawnRemains } from "./shared.ts";
import type { MarkerActor } from "./sur-marker.ts";
import { showMessage } from "../core/messages.ts";
import { spawnElectricDeath } from "./elc.ts";

// h11:20bc (15 entries) / h11:2078 (17 entries), consumed by h0:fa9c: four RGB triples per palette; 10..14 are player/light-room sets.
export const surSkinPalettes: readonly (readonly number[])[] = [
  [33,24,19,19,19,19,23,16,7,3,21,17],
  [40,35,24,17,17,17,28,26,17,26,24,3],
  [46,32,24,49,49,32,30,23,14,21,26,32],
  [53,42,37,53,28,14,35,28,19,21,26,32],
  [37,28,24,19,19,19,30,23,14,26,24,3],
  [42,32,23,26,21,17,28,19,12,26,24,3],
  [44,26,23,19,19,19,30,17,10,21,17,0],
  [42,30,26,24,20,0,19,17,21,19,24,12],
  [44,37,28,19,19,19,28,23,17,19,24,14],
  [44,33,28,44,44,44,32,23,19,24,19,19],
  [24,49,63,49,49,49,16,32,42,3,21,17],
  [46,32,24,49,49,32,30,23,14,3,21,17],
  [0,0,0,0,0,0,0,0,0,40,16,16],
  [30,28,28,49,48,46,21,19,19,16,21,40],
  [28,21,17,33,24,21,37,28,24,42,32,26],
];
export const surClothesPalettes: readonly (readonly number[])[] = [
  [26,46,33,42,60,46,21,35,24,7,23,5],
  [46,10,19,62,21,28,35,5,14,23,0,8],
  [30,35,53,42,49,62,21,28,39,12,17,24],
  [32,32,32,40,40,40,24,24,24,16,16,16],
  [24,24,24,32,32,32,16,16,16,8,8,8],
  [17,17,17,24,24,24,13,13,13,10,10,10],
  [17,32,21,21,40,28,12,23,16,8,17,12],
  [16,19,37,19,24,46,12,14,28,8,10,19],
  [28,5,10,39,8,16,19,1,8,14,1,5],
  [26,19,37,37,28,51,21,16,30,19,14,26],
  [44,42,19,60,58,28,30,28,14,21,19,10],
  [42,26,7,51,33,10,30,19,3,24,14,3],
  [17,33,44,24,49,63,12,28,37,8,19,24],
  [46,14,14,63,21,21,30,8,8,23,7,7],
  [58,0,1,0,0,0,42,0,0,33,0,0],
  [0,0,46,0,0,63,0,0,33,0,0,24],
  [46,35,30,51,40,33,56,44,37,62,48,40],
];

// h0:fa9c: load the skin/clothes colour quads at 0xc0+base/0xc4+base and remember the selection in g:3c04..3c08.
export function applySurvivorPalette(ctx: ActorContext, skin: number, clothes: number, scheme: number): void {
  const first = surSkinPalettes[skin], second = surClothesPalettes[clothes];
  if (!first || !second) throw new Error(`AGA survivor palette ${skin}/${clothes} is outside its source table`);
  ctx.emit({ type: "palette", start: 0xc0 + scheme, colors: first });
  ctx.emit({ type: "palette", start: 0xc4 + scheme, colors: second });
  ctx.state.paletteTop = u16(skin);
  ctx.state.paletteBottom = u16(clothes);
  ctx.state.paletteColor = u16(scheme);
}

// AGA +98..+cf; palette indices are native-only profile selections.
export interface SurActor extends Actor { walkDistance: number;
kind: number;
nudgePending: number;
surLastX: number;
surLastY: number;
surPause: number;
surHunting: number;
surAlerted: number;
surTargetDelay: number;
surFidget: number;
surWakeTime: number;
surTargetId: number;
surActionTime: number;
surWandering: number;
surGesture: number;
surWakePending: number;
surHits: number;
surSitting: number;
surStanding: number;
surStandFidget: number;
surReacted: number;
surNoiseTime: number;
surHealth: number;
surCanWander: number;
surReaction: number;
surReactionPending: number;
surBaseAnimation: number;
surProfile: Dialogue | null;
surCarrying: number;
surGrabbed: number;
surGrabType: number;
surIdleTime: number;
surAttackTime: number;
surFrozen: number;
surProtected: number;
surRecordState: number;
surProfileFlags: number;
// +cc topic on screen, +d0 bit per topic index asked (h0:135ac).
surTopic: number;
surAsked: number;
surPalette1: number;
surPalette2: number; }

interface NoiseMessage extends ActorMessage { noiseKind?: number }
const wakeSequence = [0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 3, 255];
const wakeHeight = [0, 0, 0, 0, 0, 0, 6, 10, 13, 10, 6, 0, 0];
const standSequence = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 255];
const gestureSequence = [0, 1, 2, 1, 0, 1, 2, 1, 0, 255];
const carrySequence = [0, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 255];
const reactionSequence = [0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0, 255];
const sitSequence = [0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 255];
const headWalkX = [1, 4, 9, 5, 2, 2, 0, 3];
const headIdleX = [1, 1, 1, 1, 1, 2, 2, 2];
const headWalkY = [
  [0, 1, 2, 1, 0, 1, 2, 1, 0],
  [0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0],
  [0, 4, 4, 4, 3, 3, 3, 4, 4, 3, 3],
  [0, 0, 2, 2, 1, 1, 0, 1, 1, 1, 1],
  [0, 1, 2, 2, 2, 1, 1, 1, 2],
];
const followText = ["Let's go now.", "Can we leave now?", "Come on.  Let's go.", "Could we go now?", "Let's get out of here."];
const leaveText = ["Now go!", "Leave!", "Go on!", "You must leave!", "Hurry!"];
const panicText = ["Oh God!  Help me!", "Oh no!  Help! Help!", "Save me!  Somebody save me!"];

// h0:680a (DOS 0:973a): turn only outside the two-heading hysteresis band.
function turn(actor: SurActor, heading: number): void {
  if ((((s8(heading) + 6) >> 3) & 7) === actor.facing || (((s8(heading) + 2) >> 3) & 7) === actor.facing) return;
  actor.facing = actor.direction = ((s8(heading) + 4) >> 3) & 7;
  actor.frame = 1;
}

// h0:4294 (DOS 0:4757): diagonal speed is 180/128 of cardinal speed.
function speed(actor: SurActor, value: number): void {
  actor.speed = u8(actor.facing & 1 ? (value * 180) >> 7 : value);
}

// h0:5c0e (DOS 0:6114): facing changes start the walk cycle.
function face(actor: SurActor, direction: number): void {
  if (actor.facing !== direction) actor.frame = 1;
  actor.facing = actor.direction = direction;
}

// h0:447e (DOS 0:4945): between exact eighth-turns, movement rounds to an even direction.
function movementDirection(heading: number): number {
  return heading & 7 ? ((s8(heading) + 8) >> 3) & 6 : s8(heading) >> 3;
}

// h0:6750 (DOS 0:9682): chase a visible player, otherwise his remembered position.
function chase(ctx: ActorContext, actor: SurActor, range: number): number {
  const player = ctx.state.player;
  if (!player) return 0;
  let heading = sightActor(ctx, actor, player, range, 4);
  let result = -1;
  if (heading !== -1) {
    actor.surLastX = player.x >>> 8;
    actor.surLastY = player.y >>> 8;
  } else {
    if (!actor.surLastX) return 0;
    heading = angle((actor.surLastX << 8) - actor.x, (actor.surLastY << 8) - actor.y);
    result = 1;
  }
  actor.movementHeading = u8(heading);
  turn(actor, heading);
  actor.direction = u8(movementDirection(heading));
  return result;
}

// h0:6548 (DOS 0:94a1): a wake noise activates a nearby survivor.
function wake(ctx: ActorContext, actor: SurActor): void {
  if (actor.surWakeTime || !actor.surWakePending) return;
  actor.surWakeTime = u16(actor.surWakeTime + 0x400);
  if (ctx.state.invulnerable || !chase(ctx, actor, 70)) return;
  if (actor.surAlerted) {
    actor.surHunting = 1;
    actor.facing = actor.direction = 3;
  } else {
    if (!actor.surRecordState && actor.surProfile?.wakeTextOffset) dialogue(ctx, actor, actor.surProfile.wakeTextOffset);
    if (ctx.state.sceneIndex !== 132) actor.surWandering = 1;
    if (actor.surSitting) actor.frame = 0;
    if (actor.surStanding) actor.frame = 2;
    actor.surActionTime = ctx.random.next(8) << 8;
  }
  actor.surFidget = actor.surStanding = actor.surSitting = actor.surWakePending = 0;
}

// h0:b7aa (DOS 0:cff8): enqueue an inline survivor message from the decoded text pool.
function dialogue(ctx: ActorContext, actor: SurActor, offset: number): void {
  showMessage(ctx, profileText(actor, offset), 4, 1);
}

// h0:636c reads relocated profile text pointers; disk offsets are one-based into the text pool (h0:11b88).
function profileText(actor: SurActor, offset: number): string {
  const profile = actor.surProfile;
  if (!profile) throw new Error("AGA survivor text without a dialogue profile");
  const index = offset - 1;
  if (index < 0 || index >= profile.textPool.length) throw new Error(`AGA survivor text offset ${offset} outside dialogue pool`);
  const end = profile.textPool.indexOf("\0", index);
  return profile.textPool.slice(index, end === -1 ? undefined : end);
}

// h0:6f76 -> h0:124b6 (DOS 0:a790): underscore codes award inventory before displaying a greeting.
function countCodes(ctx: ActorContext, text: string): number {
  let skip = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) !== 95) continue;
    const counter = s8(text.charCodeAt(++index) + 0xd0);
    const amount = u8(text.charCodeAt(++index) + 0xd0);
    skip = u16(index + 1);
    switch (counter) {
      case 0: ctx.state.portableLaserCount = u8(ctx.state.portableLaserCount + amount); break;
      case 1: ctx.state.slowMotionCount = u8(ctx.state.slowMotionCount + amount); break;
      case 2: ctx.state.shieldCount = u8(ctx.state.shieldCount + amount); break;
      case 3: ctx.state.carriedBombs = u8(ctx.state.carriedBombs + amount); break;
    }
  }
  return skip;
}

// h0:689a (DOS 0:97b7): inspect class-1 marker slots in order, retaining RNG evaluation order.
function target(ctx: ActorContext, actor: SurActor): number {
  if (actor.surTargetDelay) return -1;
  let heading = -1;
  if (actor.surTargetId) {
    for (const marker of ctx.objects.slots as readonly (MarkerActor | null)[]) {
      if (!marker || marker.removed || marker.classId !== 1 || !marker.markerClosed) continue;
      heading = sightActor(ctx, actor, marker, 85, 4);
      if (heading === -1) return -1;
      break;
    }
  }
  for (const marker of ctx.objects.slots as readonly (MarkerActor | null)[]) {
    if (!marker || marker.removed || marker.classId !== 1 || marker.markerClosed) continue;
    const direction = sightActor(ctx, actor, marker, 75, 4);
    if (direction === -1) break;
    heading = direction;
    actor.surTargetId = marker.kind;
    if (ctx.random.next(8)) break;
    if (actor.surAlerted || actor.surReacted || !actor.surReaction) break;
    const player = ctx.state.player;
    if (!player || (player.x >>> 8) <= (actor.x >>> 8) || (player.y >>> 8) <= (actor.y >>> 8)) break;
    actor.surReacted = 1;
    actor.surHunting = 0;
    actor.surActionTime = 0x300;
    actor.speed = actor.frame = 0;
    if (actor.surProfile?.interactionTextOffset) dialogue(ctx, actor, actor.surProfile.interactionTextOffset);
    if (actor.surReaction === 1) actor.surGesture = 1;
    else if (actor.surReaction === 2) actor.surReactionPending = 1;
    break;
  }
  if (heading !== -1) {
    actor.movementHeading = u8(heading);
    turn(actor, heading);
    actor.direction = u8(movementDirection(heading));
    actor.surWakeTime = 0;
    actor.ownerId = ctx.state.player?.id ?? 0;
    actor.ignoredClass = 9;
  }
  return heading;
}

// h0:6866 (DOS 0:978e): an alerted survivor gives up and turns around.
function giveUp(actor: SurActor): void {
  actor.movementHeading = 255;
  speed(actor, s8(actor.surBaseAnimation) + 15);
  face(actor, actor.direction ^ 4);
}

// h0:6696 (DOS 0:95ba): marker targets take precedence over following the player.
function hunt(ctx: ActorContext, actor: SurActor): void {
  if (actor.surWakeTime || actor.surPause || !actor.surHunting) return;
  speed(actor, s8(actor.surBaseAnimation));
  if (target(ctx, actor) !== -1) return;
  actor.ownerId = 0xffff;
  if (!ctx.state.player) { actor.frame = actor.speed = 0; return; }
  const result = chase(ctx, actor, 65);
  if (result === -1 && actor.surAlerted) { giveUp(actor); return; }
  if (!result) { actor.frame = actor.speed = 0; return; }
  if (nearActor(actor, ctx.state.player, 9)) actor.frame = actor.speed = 0;
  else speed(actor, s8(actor.surBaseAnimation));
}

// h0:636c (DOS 0:92ed): face the player and optionally pull him to a checked position.
function grab(ctx: ActorContext, actor: SurActor): void {
  const player = ctx.state.player;
  if (actor.surGrabType === 255 || !player || ctx.state.invulnerable) return;
  const heading = sightActor(ctx, actor, player, 9, 4);
  if (heading === -1 || actor.surGrabbed || actor.surAlerted || !actor.surHunting) return;
  const direction = (((s8(heading) + 4) >> 3) & 7) | 1;
  player.direction = player.facing = direction ^ 4;
  player.speed = player.frame = 0;
  if (actor.surGrabType === 1) {
    const index = (direction ^ 4) >> 1;
    const x = u8((player.x >>> 8) + [6, 6, -7, -7][index]) << 8;
    const y = u8((player.y >>> 8) + [-3, 3, 3, -3][index]) << 8;
    if (!teleportActor(ctx, actor, x, y)) { actor.surGrabbed = 0; return; }
    if (!ctx.objects.send(player, { type: 5, sender: actor, x, y })) { actor.surGrabbed = 0; return; }
    actor.surActionTime = 0x300;
    actor.speed = actor.frame = 0;
    actor.surGrabbed = actor.surCarrying = 1;
    actor.surHunting = 0;
    actor.direction = actor.facing = direction;
  } else actor.surGrabbed = 1;
  const offset = actor.surProfile?.topics[0]?.textOffset;
  if (offset) {
    const text = profileText(actor, offset);
    const skip = countCodes(ctx, text);
    if (!actor.surRecordState) showMessage(ctx, text.slice(skip), 4, 1);
  }
}

// h0:662a (DOS 0:956a): player death freezes movement and wake timers.
function timers(ctx: ActorContext, actor: SurActor): void {
  const player = ctx.state.player;
  if (player) {
    if (actor.surTargetDelay) actor.surTargetDelay = u8(actor.surTargetDelay - 1);
    if (!player.noTurn) {
      actor.surWakeTime = countDown(ctx, actor.surWakeTime).value;
      if (player.speed) actor.surFrozen = 0;
    } else {
      actor.surFrozen = 1;
      actor.frame = 0;
      actor.surWakeTime = 0x500;
    }
  }
  actor.surNoiseTime = countDown(ctx, actor.surNoiseTime).value;
}

// h0:6240 (DOS 0:91c1): impatient survivors ask the player to leave.
function attackTimer(ctx: ActorContext, actor: SurActor): void {
  if (!actor.surHunting || !actor.surProfile || actor.surProfile.patience >= 80) return;
  actor.surAttackTime = u16(actor.surAttackTime + (s16(ctx.state.frameTicks) >> 1));
  if (s16(actor.surAttackTime) <= 0x6e00) return;
  nag(ctx, actor);
}

// h0:6274 nag(actor): a new attack delay from the profile patience and one "let's go" line (g:b1e), or a "leave"
// line (g:b62) from class 27 and in scene 107. The conversation calls it too (h0:14450) when a survivor
// will not talk.
export function nag(ctx: ActorContext, actor: Actor & { surProfile: Dialogue | null; surAttackTime: number }): void {
  // A survivor without a profile has +be = 0, so the patience byte is read from address 5: the second byte of
  // the ExecBase pointer at 4 (0x00810000 in the truth harness).
  const patience = actor.surProfile?.patience ?? 0x81;
  actor.surAttackTime = u16((ctx.random.next(20) - patience + 50) >> 1);
  const texts = actor.classId === 27 || ctx.state.sceneIndex === 106 ? leaveText : followText;
  showMessage(ctx, texts[ctx.random.next(5)]!, 4, 1);
}

// h0:62d8, h0:6348 (DOS 0:9241): idle survivors panic when a nearby orb is visible.
function idleSound(ctx: ActorContext, actor: SurActor): void {
  if (actor.surHunting) return;
  actor.surIdleTime = u16(actor.surIdleTime - ctx.state.frameTicks);
  if (s16(actor.surIdleTime) >= 0) return;
  actor.surIdleTime = u16(actor.surIdleTime + 0x500);
  let visible = false;
  for (const other of ctx.objects.slots) {
    if (other && !other.removed && other.classId === 6 && sightActor(ctx, actor, other, 30, 4) !== -1) { visible = true; break; }
  }
  if (!visible) return;
  showMessage(ctx, panicText[ctx.random.next(3)]!, 4, 1);
  ctx.objects.send(actor, { type: 5, sender: actor, noiseKind: 1 } as NoiseMessage);
  actor.surIdleTime = u16(actor.surIdleTime + 0x2300);
}

// h0:6c20 (DOS 0:9b37): AGA resets the fourth consecutive hit and pauses targeting four passes.
function hit(actor: SurActor, message: ActorMessage): number {
  const direction = u8(message.direction ?? 0);
  actor.direction = actor.facing = direction;
  actor.movementHeading = u8(s8(direction) << 3);
  actor.frame = 1;
  actor.surWakeTime = 0x500;
  if (actor.surHits === 3) {
    actor.surLastX = actor.surTargetId = actor.speed = actor.frame = actor.surHits = 0;
    actor.surTargetDelay = 4;
  } else actor.surHits = u8(actor.surHits + 1);
  return 1;
}

// h0:6a96 (DOS 0:99d1): wake/fidget messages preserve the original random call ordering.
function noise(ctx: ActorContext, actor: SurActor, message: NoiseMessage): number {
  if (!message.noiseKind) actor.surWakePending = 1;
  else if (message.noiseKind === 1) {
    if (actor.surSitting && !actor.surProtected) { actor.surFidget = 1; actor.frame = ctx.random.next(12); }
    if (actor.surStanding && !actor.surNoiseTime) { actor.surStandFidget = 1; actor.frame = ctx.random.next(3); }
    actor.surNoiseTime = u16((ctx.random.next(40) + 55) << 8);
  }
  return 1;
}

// h0:6b0e, h0:6b8e, h0:6b98 (DOS 0:9a5f): player projectiles alert all unprotected survivors.
function killed(ctx: ActorContext, actor: SurActor, message: ActorMessage): number {
  const sender = message.sender;
  const cls = sender?.classId ?? 19;
  if (cls === 20 && actor.surProtected) return 1;
  // h0:6b2e/h0:6b4a: +98 is the laser's bounce count (class 20) but the projectile's owner class (class 19).
  const shot = sender as (Actor & { bounces?: number; projectileOwnerClass?: number }) | null;
  if ((cls === 20 && !shot?.bounces) || (cls === 19 && !actor.surProtected && !shot?.projectileOwnerClass)) {
    for (const other of ctx.objects.slots) if (other?.classId === 9 && !other.removed) (other as SurActor).surAlerted = 1;
  }
  if (cls === 6) showMessage(ctx, "Agggghhmmmppphh!", 4, 1);
  if (cls === 14) showMessage(ctx, "Aggggghhyyyyyiiiiioooww!!!!", 3, 1);
  return death(ctx, actor, sender, cls);
}

// h0:524a (DOS 0:5792): death effects depend on the killer's native class.
function death(ctx: ActorContext, actor: SurActor, sender: Actor | null, cls: number): number {
  if (![11, 22, 7, 21, 19, 6, 15, 20, 14, 26].includes(cls)) return 1;
  actor.collisionDisabled = 0;
  actor.removed = ctx.state.round;
  const x = actor.x >>> 8, y = actor.y >>> 8;
  if (cls === 6) { ctx.emit({ type: "sound", id: 37 }); return 1; }
  if (cls === 15) { ctx.objects.spawn(5, { class: "squ", x, y, params: { orientation: 0, unknownArgument: 0 } }); return 1; }
  if (cls === 14) { spawnElectricDeath(ctx, actor); return 1; } // h0:52fa
  if (cls === 26) { dgenTouch(ctx); return 0; }
  if (cls === 22) {
    ctx.objects.spawn(12, { class: "dec", x, y, params: { orientation: 0, unknownArgument: 0 } });
    ctx.objects.spawn(24, { class: "hed", x, y, params: { orientation: (sender?.direction ?? 0) ^ 4, unknownArgument: 0 } });
  }
  spawnRemains(ctx, actor, 2, cls === 7 || cls === 22 ? 0 : sender?.direction ?? 0, cls === 7 || cls === 22 ? 0 : sender?.speed ?? 0);
  if (cls !== 7) ctx.emit({ type: "sound", id: cls === 22 ? 37 : 8 });
  return 1;
}

// h0:6f64 -> h0:107d8 (DOS 12cc:0ed7): ordered body/head overrides.
function post(ctx: ActorContext, actor: SurActor): boolean {
  let ended = false;
  let frame = 0;
  let direction = s8(actor.facing);
  actor.spriteMirror = 0;
  actor.spriteEnabled[0] = actor.spriteEnabled[1] = 1;
  actor.spriteSets[0] = actor.surProfile && s8(actor.surProfile.palette2) >= 100 ? 109 : 9;
  actor.spriteSets[1] = 38;
  if (actor.surWandering) {
    const result = animate(ctx, actor, wakeSequence, 520, "surActionTime");
    frame = result.frame;
    if (result.wrapped || (s8(actor.frame) > 1 && actor.surCanWander !== 3)) {
      actor.height = actor.frame = actor.surWandering = 0;
      actor.surHunting = 1;
      actor.surWakeTime = 0x400;
      actor.facing = actor.direction = 3;
      if (actor.surProtected) ended = true;
    } else {
      actor.spritePaths[0] = [3, 0, frame];
      actor.spriteOffsetX[0] = actor.spriteOffsetY[0] = 0;
      actor.height = wakeHeight[actor.frame];
      actor.spriteOffsetX[1] = [4, 4, 3, 1, 2][frame];
      actor.spriteOffsetY[1] = [9, 6, 4, 3, 0][frame] - 19;
      direction = 3;
    }
  }
  if (actor.surStanding) {
    if (actor.surStandFidget) {
      const result = animate(ctx, actor, standSequence, 600, "surActionTime");
      frame = result.frame;
      if (result.wrapped) actor.surStandFidget = 0;
    }
    actor.spritePaths[0] = [2, 0, frame];
    actor.spriteOffsetX[0] = actor.spriteOffsetY[0] = 0;
    direction = frame + 3;
    actor.spriteOffsetX[1] = 2;
    actor.spriteOffsetY[1] = -16;
  }
  if (actor.surGesture) {
    const result = animate(ctx, actor, gestureSequence, 450, "surActionTime");
    frame = result.frame;
    if (result.wrapped) { actor.surGesture = 0; actor.surHunting = 1; }
    actor.spritePaths[0] = [4, 0, frame];
    actor.spriteOffsetX[0] = 0;
    actor.spriteOffsetY[0] = 3;
    actor.spriteOffsetX[1] = 4;
    actor.spriteOffsetY[1] = -15;
    direction = 3;
  }
  if (actor.surCarrying) {
    const result = animate(ctx, actor, carrySequence, 450, "surActionTime");
    frame = result.frame;
    if (result.wrapped || (actor.surGrabType !== 1 && s8(actor.frame) > 1)) { actor.surCarrying = 0; actor.surHunting = 1; actor.frame = 0; }
    direction = s8(actor.facing);
    if (direction > 4) { actor.spriteMirror = 1; direction = 8 - direction; actor.spriteMirrorWidth[0] = 18; actor.spriteMirrorWidth[1] = 14; }
    actor.spritePaths[0] = [6, direction >> 1, frame];
    actor.spriteOffsetX[0] = 0;
    actor.spriteOffsetY[0] = 3;
    actor.spriteOffsetX[1] = [-3, 0, 3, 6][s8(actor.facing) >> 1];
    actor.spriteOffsetY[1] = (direction >> 1) - 16;
  }
  if (actor.surReactionPending) {
    const result = animate(ctx, actor, reactionSequence, 650, "surActionTime");
    frame = result.frame;
    if (result.wrapped) { actor.surReactionPending = 0; actor.surHunting = 1; }
    actor.spritePaths[0] = [5, 0, frame];
    actor.spriteOffsetX[0] = 0;
    actor.spriteOffsetY[0] = 3;
    actor.spriteOffsetX[1] = [1, 1, 3, 5][frame];
    actor.spriteOffsetY[1] = [1, 2, 2, 3][frame] - 16;
    direction = 3;
  }
  if (actor.surSitting) {
    if (actor.surFidget) {
      actor.frame = u8(actor.frame + 1);
      if (s8(sitSequence[actor.frame]) < 0) actor.frame = 0;
      frame = sitSequence[actor.frame];
      if (!actor.frame) actor.surFidget = 0;
    }
    actor.spritePaths[0] = [1, 0, frame];
    actor.spriteOffsetX[0] = 0;
    actor.spriteOffsetY[0] = 3;
    actor.spriteOffsetX[1] = 1;
    actor.spriteOffsetY[1] = frame - 9;
    direction = 3;
  }
  if (actor.surHunting) {
    if (direction > 4) { actor.spriteMirror = 1; direction = 8 - direction; actor.spriteMirrorWidth[1] = 14; }
    else actor.spriteMirror = 0;
    if (actor.frame) {
      actor.spriteMirrorWidth[0] = [17, 21, 22, 21, 0][direction];
      actor.spriteOffsetX[1] = headWalkX[actor.facing];
    } else { actor.spriteOffsetX[1] = headIdleX[actor.facing]; actor.spriteMirrorWidth[0] = 17; }
    actor.spritePaths[0] = [0, direction, s8(actor.frame)];
    actor.spriteOffsetX[0] = 0;
    actor.spriteOffsetY[0] = 3;
    actor.spriteOffsetY[1] = headWalkY[direction][actor.frame] - 16;
  }
  const appearance = actor.kind;
  actor.spritePaths[1] = [appearance >= 100 ? 1 : 0, appearance >= 100 ? appearance - 100 : appearance, direction];
  return ended;
}

export const surClass: ActorClass = {
  createState: (): Partial<SurActor> => ({ walkDistance: 0, kind: 0, nudgePending: 0 }),
  id: 9,
  name: "SUR",
  // h0:6d24, h0:6de2 (DOS 0:9c17): profile records are decoded dialogue chunks, never byte memory.
  init(ctx, base, spec) {
    const actor = base as SurActor;
    Object.assign(actor, {
      surLastX: 0, surLastY: 0, surPause: 0, surHunting: 0, surAlerted: 0, surTargetDelay: 0, surFidget: 0,
      surWakeTime: 0, surTargetId: 255, surActionTime: 0, surWandering: 0, surGesture: 0, surWakePending: 0, surHits: 0,
      surSitting: 0, surStanding: 0, surStandFidget: 0, surReacted: 0, surNoiseTime: 0, surHealth: 0, surCanWander: 0,
      surReaction: 0, surReactionPending: 0, surBaseAnimation: 0, surProfile: null, surCarrying: 0, surGrabbed: 0, surGrabType: 0,
      surIdleTime: 0, surAttackTime: 0, surFrozen: 0, surProtected: 0, surRecordState: 0, surProfileFlags: 0, surTopic: 0, surAsked: 0,
      surPalette1: 0, surPalette2: 0,
    });
    actor.spriteScheme = u8((ctx.state.survivorIndex + 1) << 4);
    actor.surProtected = spec.params.protected & 1;
    const profiles = ctx.room.chunks.filter(chunk => chunk.kind === "dialogue");
    const profile = profiles[ctx.state.survivorIndex];
    if (profile?.kind === "dialogue") actor.surProfile = profile.dialogue;
    if (!actor.surProfile) {
      actor.surCanWander = actor.surSitting = 1;
      actor.surBaseAnimation = 45;
      actor.surPalette1 = ctx.random.withSeed(10, ctx.state.sceneIndex + ctx.state.survivorIndex);
      actor.surPalette2 = ctx.random.withSeed(12, ctx.state.sceneIndex + ctx.state.survivorIndex);
      applySurvivorPalette(ctx, actor.surPalette1, actor.surPalette2, actor.spriteScheme);
    } else {
      const p = actor.surProfile;
      actor.surPalette1 = s8(p.palette1);
      actor.surPalette2 = s8(p.palette2);
      actor.surHealth = p.patience;
      actor.surProfileFlags = p.answerAllowance;
      actor.surBaseAnimation = p.speed;
      if (s8(p.initialMode) === 0) actor.surHunting = 1;
      else if (s8(p.initialMode) === 1) actor.surSitting = 1;
      else if (s8(p.initialMode) === 2) actor.surStanding = 1;
      actor.surCanWander = p.behavior;
      actor.surReaction = p.interaction;
      actor.surGrabType = p.grabMode;
      actor.kind = p.appearance;
      ctx.state.survivorIndex = u8(ctx.state.survivorIndex + 1);
    }
    actor.surRecordState = ctx.state.visited[ctx.state.sceneIndex] ? u8(s8((spec.params.conversationFlags << 1) | spec.params.protected) >> 1) : 0;
    if (actor.surRecordState) {
      actor.surHunting = 1;
      actor.surStanding = actor.surSitting = actor.surProfileFlags = 0;
      actor.surProfile = null;
    }
    // h0:6d4c..6db2: object bank group (g:49f via h0:6de) 5 for a profile with palette byte >= 100, else 0.
    if (actor.surProfile && s8(actor.surProfile.palette2) >= 100) {
      actor.spriteScheme = 0;
      actor.surPalette2 -= 100;
      if (ctx.state.sceneIndex === 106) actor.kind = 7;
      ctx.state.frontShapeSet = 5;
    } else ctx.state.frontShapeSet = 0;
    if (actor.surProfile) applySurvivorPalette(ctx, actor.surPalette1, actor.surPalette2, actor.spriteScheme || 16);
    if (ctx.state.sceneIndex === 132) {
      actor.surWakePending = actor.surSitting = 1;
      actor.surHunting = 0;
      if (ctx.state.generatorOverride) actor.removed = ctx.state.round;
    }
  },
  // h0:61f6 (DOS 0:918d).
  update(ctx, base) {
    const actor = base as SurActor;
    if (ctx.state.slowMotion) return;
    wake(ctx, actor);
    // h0:5c7a (DOS 0:617f): discard a remembered player position once reached.
    if (Math.abs((actor.x >>> 8) - actor.surLastX) < 2 && Math.abs((actor.y >>> 8) - actor.surLastY) < 2) actor.surLastX = actor.surLastY = 0;
    hunt(ctx, actor);
    grab(ctx, actor);
    if (ctx.state.sceneIndex === 106 || !actor.surFrozen) {
      const movement = moveActor(ctx, actor, 7);
      animateWalk(ctx, actor, movement.dx, movement.dy);
      if (actor.nudgePending) {
        actor.nudgePending = 0;
        nudge(ctx, actor);
        actor.facing = actor.direction;
      }
    }
    timers(ctx, actor);
    attackTimer(ctx, actor);
    idleSound(ctx, actor);
    if (actor.speed) actor.surAttackTime = 0;
  },
  // h0:6a32 (DOS 0:996d).
  message(ctx, base, message) {
    const actor = base as SurActor;
    switch (message.type) {
      case 0: // h0:6bb0: touching a survivor on the jet-pack roof (scene index 0x84) takes both into the escape room.
        if (ctx.state.sceneIndex === 0x84 && !ctx.state.generatorOverride) {
          ctx.state.useDisabled = 1;
          ctx.storyTransition(0x8a);
        }
        if (actor.surHunting) { actor.speed = 60; hit(actor, message); }
        return 1;
      case 2:
        if (message.x === undefined || message.y === undefined) throw new Error("AGA survivor relocation message is missing coordinates");
        if (!teleportActor(ctx, actor, message.x, message.y)) return 0;
        actor.collisionDisabled = 0;
        return 1;
      case 5: return noise(ctx, actor, message);
      case 8:
        if (!actor.removed) {
          hit(actor, message);
          if (actor.surAlerted) { actor.surWakeTime = 0x500; actor.speed = 52; }
        }
        return 1;
      case 9: return killed(ctx, actor, message);
      default: return 0;
    }
  },
  // h0:6caa (DOS 0:9b8a): protected wake completion spawns a class-22 room event.
  post(ctx, base) {
    const actor = base as SurActor;
    if (!post(ctx, actor)) return;
    actor.removed = ctx.state.round;
    const spawned = ctx.objects.spawn(22, {
      class: "cgen", x: actor.x >>> 8, y: actor.y >>> 8,
      params: { orientation: actor.facing, unknownArgument: 0, dormant: 0, playerTriggered: 0 },
    });
    if (spawned) {
      ctx.emit({ type: "sound", id: 32 });
      ctx.objects.broadcastNoise(1);
      flash(ctx, 0, 2);
    }
  },
  // h0:6d06 (DOS 0:9bf0): survivor parts are always drawn to the front layer.
  draw(ctx, actor, gfx) { drawPart(ctx, actor, gfx, 0); drawPart(ctx, actor, gfx, 1); },
  // h0:6f1e (DOS 0:9d4e): byte 3 = protected | record state<<1.
  save(_ctx, base): ObjectSpec {
    const actor = base as SurActor;
    return saveRecord(actor, (actor.surProtected & 1) | (actor.surRecordState << 1));
  },
};
