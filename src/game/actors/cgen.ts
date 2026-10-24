import type { ObjectSpec } from "../../formats/level.ts";
import { angle, animateWalk, chase, moveActor, nudge, setSpeed, teleportActor } from "../core/geometry.ts";
import { s8, u8 } from "../core/int.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage, GameState } from "../core/model.ts";
import type { Gfx } from "../render/gfx.ts";
import { animate, countDown, drawPart, objectRecord, spawnRemains } from "./shared.ts";

// AGA +98..+ac.
export interface GeneratorActor extends Actor { walkDistance: number;
nudgePending: number;
generatorActive: number;
generatorPlayerTriggered: number;
generatorSpawnTime: number;
generatorHits: number;
generatorDying: number;
generatorDeathFrame: number;
generatorAnimationTime: number;
generatorSkipDraw: number;
lastPlayerX: number;
lastPlayerY: number; }

export interface GeneratorState extends GameState {
  flashMessage: number;
  flashTimer: number;
  forceRedraw: number;
  gorePending: number;
  goreEntry: number;
  goreX: number;
  goreY: number;
  backgroundDirty: number;
  roomEffect: number;
  collisionHandled: number;
  shakeScript: readonly number[];
  shakeRestoreScript: readonly number[];
}

const DEATH_SEQUENCE = [0, 0, 1, 2, 3, 4, -1] as const; // g:3ee4
const MIRROR_WIDTH = [17, 21, 22, 21, 0] as const; // g:3eeb
const WALK_OFFSETS = [1, 4, 9, 5, 2, 2, 0, 3] as const; // g:3eba
const REST_OFFSETS = [1, 1, 1, 1, 1, 2, 2, 2] as const; // g:3ec2
const HEAD_OFFSETS = [
  [0, 1, 2, 1, 0, 1, 2, 1, 0],
  [0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0],
  [0, 4, 4, 4, 3, 3, 3, 4, 4, 3, 3],
  [0, 0, 2, 2, 1, 1, 0, 1, 1, 1, 1],
  [0, 1, 2, 2, 2, 1, 1, 1, 2],
] as const; // g:3e9a points at one table per mirrored facing.
const RELEASE_COORDINATES = [100, 80, 110, 90, 120, 90, 95, 100, 125, 80, 127, 65, 121, 65, 130, 60] as const; // g:3b7, ff-terminated
const TOUCH_CLASSES = [11, 21, 19, 7] as const; // g:12d4, terminated by ff
const PICKUPS = [0, 1, 2, 3, 4, 5] as const; // g:12d9
const SHAKE = [-4, -2, 0, 3, 0, -2, 2, 0, 128] as const; // g:12e0
const SHAKE_RESTORE = [-2, 1, 0, -1, 0, 128] as const; // g:12f2
const DGEN_TOP_COLORS = [24, 49, 63, 49, 49, 49, 16, 32, 42, 3, 21, 17] as const; // g:203c
const DGEN_BOTTOM_COLORS = [17, 33, 44, 24, 49, 63, 12, 28, 37, 8, 19, 24] as const; // g:1f88
const CGEN_TOP_COLORS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 16, 16] as const; // g:2060
const CGEN_BOTTOM_COLORS = [58, 0, 1, 0, 0, 0, 42, 0, 0, 33, 0, 0] as const; // g:1f94
const FLASH_COLORS = [[63, 63, 63], [63, 0, 0], [0, 63, 0], [0, 0, 63], [63, 0, 63]] as const; // g:28a -> g:27b..287

// h0:8040 (DOS 0:a0e8): both descriptors 22/26 share these handlers and select front banks by flags.
export function cgenInit(ctx: ActorContext, base: Actor, spec: ObjectSpec): void {
  const actor = base as GeneratorActor;
  actor.generatorActive = 1;
  actor.generatorPlayerTriggered = 0;
  actor.generatorSpawnTime = 0;
  actor.generatorHits = 0;
  actor.generatorDying = 0;
  actor.generatorDeathFrame = 0;
  actor.generatorAnimationTime = 0;
  actor.generatorSkipDraw = 0;
  actor.spriteScheme = 0;
  actor.lastPlayerX = 0;
  actor.lastPlayerY = 0;
  if (spec.params.playerTriggered) {
    // Cleared sprite offset zero is the first frame of the DGEN front bank.
    actor.spriteSets[0] = 26;
    actor.spritePaths[0] = [0, 0, 0];
    actor.generatorPlayerTriggered = 1;
    ctx.state.frontShapeSet = 1;
    if (ctx.state.sceneIndex === 57) actor.generatorSpawnTime = 0x1400;
    else {
      ctx.state.paletteTop = 10;
      ctx.state.paletteBottom = 12;
      ctx.state.paletteColor = 16;
      // h0:fa9c -> h0:155c2: two four-color writes at scheme + c0/+c4.
      ctx.emit({ type: "palette", start: 208, colors: DGEN_TOP_COLORS });
      ctx.emit({ type: "palette", start: 212, colors: DGEN_BOTTOM_COLORS });
      if (spec.params.dormant) actor.generatorActive = 0;
    }
  } else {
    actor.direction = 3;
    actor.facing = 3;
    if (ctx.state.frontShapeSet !== 5) ctx.state.frontShapeSet = 0;
    actor.spriteScheme = 32;
    ctx.state.paletteTop = 12;
    ctx.state.paletteBottom = 14;
    ctx.state.paletteColor = 32;
    ctx.emit({ type: "palette", start: 224, colors: CGEN_TOP_COLORS });
    ctx.emit({ type: "palette", start: 228, colors: CGEN_BOTTOM_COLORS });
  }
  actor.frame = 0;
  actor.activeThreat = 1;
}

// h0:5c7a (DOS 0:617f): forget the last player position once both integer axes arrive.
function clearTarget(actor: GeneratorActor): void {
  if (Math.abs((actor.x >>> 8) - actor.lastPlayerX) < 2 && Math.abs((actor.y >>> 8) - actor.lastPlayerY) < 2) {
    actor.lastPlayerX = 0;
    actor.lastPlayerY = 0;
  }
}

// h0:6750/h0:680a/h0:447e (DOS 0:9682): LOS pursuit, remembered target and facing hysteresis.
export function chasePlayer(ctx: ActorContext, actor: Actor & { lastPlayerX: number; lastPlayerY: number }, range = 0x41, speed = 2): number {
  const player = ctx.state.player;
  if (!player) return 0;
  let heading = chase(ctx, actor, player, range, speed);
  let result = -1;
  if (heading !== -1) {
    actor.lastPlayerX = player.x >>> 8;
    actor.lastPlayerY = player.y >>> 8;
  } else {
    if (!actor.lastPlayerX) return 0;
    heading = angle((actor.lastPlayerX - (actor.x >>> 8)) << 8, (actor.lastPlayerY - (actor.y >>> 8)) << 8);
    result = 1;
  }
  actor.movementHeading = u8(heading);
  const signed = s8(heading);
  if ((((signed + 6) >> 3) & 7) !== s8(actor.facing) && (((signed + 2) >> 3) & 7) !== s8(actor.facing)) {
    actor.facing = ((signed + 4) >> 3) & 7;
    actor.direction = actor.facing;
    actor.frame = 1;
  }
  actor.direction = heading & 7 ? ((signed + 8) >> 3) & 6 : signed >> 3;
  return result;
}

// h0:7d52 (DOS 0:9e45): acquire the player at expiry, then move at AGA speed 54.
function spawn(ctx: ActorContext, actor: GeneratorActor): void {
  if (!ctx.state.player || actor.generatorSpawnTime || !actor.generatorActive) return;
  if (!chasePlayer(ctx, actor)) return;
  setSpeed(actor, 54);
  actor.generatorHits = 0;
}

// h0:5c3a (DOS 0:6134): seven-step walk animation, followed by a requested path nudge.
function walk(ctx: ActorContext, actor: GeneratorActor): void {
  const delta = moveActor(ctx, actor, 7);
  animateWalk(ctx, actor, delta.dx, delta.dy);
  if (actor.nudgePending) {
    actor.nudgePending = 0;
    nudge(ctx, actor);
    actor.facing = actor.direction;
  }
}

// h0:7c5c (DOS 0:9d7f): AGA has no DOS mark-player or self-destruct countdown branch.
export function cgenUpdate(ctx: ActorContext, base: Actor): void {
  const actor = base as GeneratorActor;
  if (!actor.generatorActive) return;
  if (actor.generatorPlayerTriggered && !ctx.state.generatorOverride && ctx.state.sceneIndex !== 57) return;
  clearTarget(actor);
  spawn(ctx, actor);
  walk(ctx, actor);
  if (!ctx.state.abortFrame) actor.generatorSpawnTime = countDown(ctx, actor.generatorSpawnTime).value;
}

// h0:7ef4 (DOS 0:a050): laser hits do not restart; the fifth restart stops the generator.
function restart(ctx: ActorContext, actor: GeneratorActor, message: ActorMessage): void {
  if (message.sender?.classId === 20) return;
  const direction = (ctx.random.next(3) + s8(message.direction ?? 0) - 1) & 7;
  actor.direction = direction;
  actor.facing = direction;
  actor.movementHeading = direction << 3;
  actor.frame = 1;
  actor.generatorSpawnTime = 0x500;
  if (actor.generatorHits === 4) {
    actor.lastPlayerX = 0;
    actor.speed = 0;
    actor.frame = 0;
  } else actor.generatorHits = u8(actor.generatorHits + 1);
}

// h0:c9a/h0:c16 (DOS 0:1de6): flash two palette entries, or the full palette for ids >= 100.
export function flash(ctx: ActorContext, id: number, duration: number): void {
  const state = ctx.state as GeneratorState;
  state.flashMessage = u8(id);
  const color = FLASH_COLORS[id >= 100 ? id - 100 : id];
  if (!color) throw new Error(`AGA flash palette ${id} has no RGB descriptor`);
  if (id >= 100) {
    // h0:c16 writes 255..0 one at a time; h0:155c2 drops the write at 255 (first + count reaches 0x100).
    const colors: number[] = [];
    for (let i = 0; i < 255; i++) colors.push(...color);
    ctx.emit({ type: "palette", start: 0, colors });
  } else {
    ctx.emit({ type: "palette", start: 0, colors: color });
    ctx.emit({ type: "palette", start: 253, colors: color });
  }
  ctx.timers.thaw(state.flashTimer);
  ctx.timers.set(state.flashTimer, duration);
  ctx.timers.enable(state.flashTimer, true);
  ctx.timers.freeze(state.flashTimer);
}

// h0:7d88/h0:7dd2/h0:7e44/h0:7e8a (DOS 0:9e88): AGA dispatch returns zero for hit/shot/touch.
export function cgenMessage(ctx: ActorContext, base: Actor, message: ActorMessage): number {
  const actor = base as GeneratorActor;
  switch (message.type & 0xff) {
    case 0:
      if (actor.generatorActive) {
        actor.speed = 60;
        restart(ctx, actor, message);
      }
      if (message.sender?.classId === 0) ctx.objects.send(message.sender, { type: 9, sender: actor });
      return 0;
    case 2:
      return Number(teleportActor(ctx, actor, message.x ?? 0, message.y ?? 0));
    case 8:
      if (ctx.state.player || actor.generatorPlayerTriggered) restart(ctx, actor, message);
      else {
        actor.removed = ctx.state.round;
        ctx.objects.spawn(7, objectRecord(7, actor.x >>> 8, actor.y >>> 8, PICKUPS[ctx.random.next(6)]!));
        ctx.emit({ type: "sound", id: 32 });
        flash(ctx, 0, 2);
      }
      return 0;
    case 9:
      if (actor.generatorPlayerTriggered) {
        if (message.sender?.classId === 25) {
          actor.generatorDying = 1;
          actor.generatorActive = 0;
          actor.frame = 0;
        }
      } else if (message.sender && (TOUCH_CLASSES as readonly number[]).includes(message.sender.classId)) {
        spawnRemains(ctx, actor, 3, s8(message.sender.direction), message.sender.speed);
        (ctx.state as GeneratorState).collisionHandled = 0;
      }
      return 0;
    default:
      return 1;
  }
}

// h0:855c -> h0:10d5a (DOS 12cc:14d9): AGA uses a separate animated head and death overlay.
function animateGenerator(ctx: ActorContext, actor: GeneratorActor): boolean {
  actor.spriteOffsetX[0] = 0;
  actor.spriteOffsetY[0] = 3;
  actor.spriteMirror = 0;
  let direction = s8(actor.facing);
  let finished = false;
  if (actor.generatorDying) {
    const animation = animate(ctx, actor, DEATH_SEQUENCE, 0xfa0, "generatorAnimationTime");
    finished = animation.wrapped;
    if (!finished) {
      actor.spriteSets[0] = 26;
      actor.spritePaths[0] = [1, 0, animation.frame];
      actor.spriteOffsetX[0] = actor.spriteOffsetX[1] = -3;
      actor.spriteOffsetY[0] = actor.spriteOffsetY[1] = -3;
      const previous = actor.generatorDeathFrame;
      actor.generatorDeathFrame = u8(previous + 1);
      if (s8(previous) > 3) actor.generatorDeathFrame = 0;
      actor.spriteSets[1] = 26;
      actor.spritePaths[1] = [2, 0, actor.generatorDeathFrame];
      actor.spriteEnabled[1] = 1;
    }
  } else if (actor.generatorActive && actor.generatorPlayerTriggered) {
    if (direction > 4) {
      actor.spriteMirror = 1;
      direction = 8 - direction;
      actor.spriteMirrorWidth[0] = actor.frame ? MIRROR_WIDTH[direction] : 17;
    }
    actor.spriteSets[0] = 26;
    actor.spritePaths[0] = [0, direction, actor.frame];
  }
  if (actor.generatorActive && !actor.generatorPlayerTriggered) {
    actor.spriteEnabled[1] = 1;
    if (direction > 4) {
      actor.spriteMirror = 1;
      direction = 8 - direction;
      actor.spriteMirrorWidth[1] = 14;
    }
    actor.spriteMirrorWidth[0] = actor.frame ? MIRROR_WIDTH[direction] : 17;
    actor.spriteOffsetX[1] = actor.frame ? WALK_OFFSETS[actor.facing & 7] : REST_OFFSETS[actor.facing & 7];
    actor.spriteSets[0] = 40;
    actor.spritePaths[0] = [0, direction, actor.frame];
    actor.spriteOffsetY[1] = HEAD_OFFSETS[direction][actor.frame] - 16;
    actor.spriteSets[1] = 41;
    actor.spritePaths[1] = [0, 0, direction];
  }
  return finished;
}

// h0:1ec2: record 89 x y 03 per g:3b7 pair; h0:1878 decodes 0x89 as class 25 (bit 7 -> +16), so these are eight
// looping ANM kind-3 figures, not survivors.
function releaseFigures(ctx: ActorContext): void {
  for (let i = 0; i < RELEASE_COORDINATES.length; i += 2) {
    ctx.objects.spawn(objectRecord(0x89, RELEASE_COORDINATES[i]!, RELEASE_COORDINATES[i + 1]!, 3));
  }
}

// h0:7f8a/h0:1236e (DOS 0:a0b7): complete the generator death and install its shake scripts.
export function cgenPost(ctx: ActorContext, base: Actor): void {
  const actor = base as GeneratorActor;
  if (!animateGenerator(ctx, actor)) return;
  const state = ctx.state as GeneratorState;
  spawnRemains(ctx, actor, 2, 0, 0, 57); // g:12fe = 50 during h0:3e36.
  flash(ctx, 101, 10);
  const animation = ctx.objects.slots.find(value => value?.classId === 25);
  if (animation) animation.removed = state.round;
  state.forceRedraw = 1;
  state.gorePending = 1;
  state.goreEntry = 0x44;
  state.goreX = 0x54;
  state.goreY = 0x1a;
  state.backgroundDirty = 1;
  releaseFigures(ctx);
  state.collisionHandled = 0;
  state.roomEffect = 0;
  state.shakeScript = SHAKE;
  state.shakeRestoreScript = SHAKE_RESTORE;
}

// h0:8006 (DOS 0:a0bd): skip once if requested; the second part is conditional for DGEN.
export function cgenDraw(ctx: ActorContext, base: Actor, gfx: Gfx): void {
  const actor = base as GeneratorActor;
  drawPart(ctx, actor, gfx, 0);
  if (!actor.generatorPlayerTriggered || actor.generatorDying) drawPart(ctx, actor, gfx, 1);
}

export const cgenClass: ActorClass = { id: 22, name: "cgen", createState: (): Partial<GeneratorActor> => ({ walkDistance: 0, nudgePending: 0 }), init: cgenInit, update: cgenUpdate, message: cgenMessage, post: cgenPost, draw: cgenDraw };
