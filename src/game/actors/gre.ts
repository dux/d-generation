import type { ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { applyStep, blocked, bumpObjects, collide, findCollision, moveActor, resolveMove, spawnAhead, teleportActor, updateBounds } from "../core/geometry.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import { drawPart, spawnRemains } from "./shared.ts";
import { flash } from "./cgen.ts";

// Class 19: the grenade the player (h0:50a4) and turrets (h0:9634) fire, rolling along its direction until it hits
// something; in scene index 0x89 the h0:1514 records circle along a fixed path instead.
// AGA +98 shooter class, +99 parked (no roll this pass), +9a passes until the shooter can be hit, +9b lifetime
// (written by h0:5b04, never read), +9c path step timer, +9e path, +9f path point.
export interface ProjectileActor extends Actor {
  projectileOwnerClass: number;
  projectileParked: number;
  projectileOwnerGrace: number;
  projectileLifetime: number;
  projectilePathTime: number;
  projectilePath: number;
  projectilePathStep: number;
}

const SEQUENCE = [0, 1, 0, 1, 0, 1, 0, 1, 255]; // g:3cba
const SCHEMES = [0, 4, 8, 12, 0, 4, 8, 12]; // g:3cc3
// g:9cf: (x, y) high bytes of the scene-0x89 circuit, 0xff-terminated; path p starts at point 19 * p.
const PATH = [
  [163, 148], [165, 146], [167, 144], [170, 141], [172, 139], [172, 136], [173, 135], [175, 133], [177, 133], [177, 131], [174, 131], [172, 129],
  [172, 127], [172, 125], [170, 123], [168, 121], [170, 119], [173, 116], [175, 114], [175, 112], [177, 112], [175, 110], [172, 111], [169, 108],
  [167, 110], [164, 113], [162, 113], [159, 113], [157, 113], [155, 111], [155, 109], [153, 107], [151, 107], [148, 110], [146, 110], [143, 110],
  [140, 110], [137, 113], [135, 113], [132, 116], [133, 111], [133, 108], [131, 106], [131, 104], [129, 102], [127, 100], [126, 99], [124, 97],
  [122, 99], [120, 99], [117, 99], [115, 99], [112, 99], [110, 99], [109, 98], [107, 96], [104, 93], [102, 91], [99, 88], [102, 91],
  [104, 93], [107, 96], [109, 98], [110, 99], [110, 101], [110, 103], [110, 106], [112, 108], [112, 111], [109, 114], [111, 116], [114, 119],
  [116, 121], [117, 121], [119, 121], [122, 121], [124, 123], [124, 125], [122, 127], [122, 130], [122, 132], [122, 135], [120, 137], [120, 140],
  [120, 142], [122, 144], [125, 147], [127, 149], [125, 151], [122, 154], [121, 155], [122, 158], [122, 160], [122, 162], [124, 162], [126, 162],
  [128, 162], [130, 160], [130, 159], [132, 159], [135, 159], [136, 160], [138, 160], [140, 160], [143, 163], [145, 163], [147, 161], [149, 159],
  [151, 159], [153, 159], [155, 159], [158, 156], [158, 154], [158, 152], [158, 150],
] as const;

// Record byte 3 of a class-19 spec. h0:5518 records carry it as `facing`; records built as disk bytes (h0:1514) decode
// through the h0:21a6 class-19 alias as BAR, whose fine position fractions hold byte 3's bits 3..7.
function recordArgument(spec: ObjectSpec): number {
  const x = Math.round((spec.x % 1) * 256), y = Math.round((spec.y % 1) * 256);
  return ((spec.params.facing ?? 0) & 7) | ((x >> 4) & 8) | (y & 0xf0);
}

// h0:5934 (DOS 0:5e66): unless parked, roll along the direction, retrying once after a free step.
function roll(ctx: ActorContext, a: ProjectileActor): void {
  if (a.projectileParked) return;
  const moved = moveActor(ctx, a, 7);
  if (moved.collision) return;
  applyStep(ctx, a, moved.dx, moved.dy);
  resolveMove(ctx, a, moved.dx, moved.dy, 7);
}

// h0:5886 (DOS 0:5db0): jump to the next path point every 0xc8 ticks, colliding at each point.
function followPath(ctx: ActorContext, a: ProjectileActor): void {
  a.height = 0;
  a.projectilePathTime = u16(a.projectilePathTime - ctx.state.frameTicks);
  while (s16(a.projectilePathTime) <= 0) {
    const point = PATH[s8(a.projectilePathStep)];
    if (!point) throw new Error(`AGA g:9cf path point ${s8(a.projectilePathStep)} outside the table`);
    a.x = (point[0] << 8) | (a.x & 0xff);
    a.y = (point[1] << 8) | (a.y & 0xff);
    a.projectilePathStep = u8(a.projectilePathStep + 1);
    if (s8(a.projectilePathStep) === PATH.length) a.projectilePathStep = 0;
    updateBounds(a);
    const code = blocked(ctx, a);
    if (code) collide(ctx, a, s8(code));
    a.projectilePathTime = u16(a.projectilePathTime + 0xc8);
  }
}

// h0:5a26 (DOS 0:5f79): stop, then unless already removed flash, alert the survivors (noise 1) and turn into remains
// that bump what they overlap.
function explode(ctx: ActorContext, a: ProjectileActor): void {
  a.noTurn = 1;
  if (a.removed) return;
  flash(ctx, 0, 6);
  ctx.objects.broadcastNoise(1);
  const remains = spawnRemains(ctx, a, 2, 0, 0);
  if (!remains) throw new Error("AGA h0:5a26 bumps the remains it could not create");
  bumpObjects(ctx, remains);
}

// h0:59b8 (DOS 0:5f15): hit the other object; explode unless the hit removed it, then just vanish.
function collision(ctx: ActorContext, a: ProjectileActor, other: Actor | null): number {
  if (!other) throw new Error("AGA h0:59b8 sends message 9 to the collision partner; none was given");
  ctx.objects.send(other, { type: 9, sender: a });
  flash(ctx, 0, 6);
  if (!other.removed) {
    a.speed = 0;
    explode(ctx, a);
  } else a.removed = ctx.state.round;
  return 0xffff;
}

// h0:5b04 (DOS 0:5fff): the shooter (g:85bc) fires a grenade along its facing; 0 when fired or resolved against an
// object, 1 when blocked.
export function fireProjectile(ctx: ActorContext, shooter: Actor): number {
  if (ctx.state.useDisabled) return 0;
  if (ctx.state.sceneIndex === 0x84 && !ctx.state.generatorOverride) {
    ctx.state.useDisabled = 1;
    ctx.storyTransition(0x8a);
    return 0;
  }
  const shot = spawnAhead(ctx, shooter, 19, s8(shooter.facing)) as ProjectileActor | null;
  ctx.state.spawned = shot;
  if (!shot) {
    ctx.emit({ type: "sound", id: 2 });
    return 1;
  }
  shot.ownerId = shooter.id;
  shot.projectileOwnerClass = shooter.classId;
  shot.facing = 1;
  const hit = findCollision(ctx, shot);
  if (hit) return collide(ctx, shot, hit.classId + 0x60);
  if (blocked(ctx, shot)) {
    ctx.objects.remove(shot);
    ctx.emit({ type: "sound", id: 2 });
    return 1;
  }
  shot.projectileLifetime = 0x10;
  shot.speed = 0x55;
  shot.projectileOwnerGrace = 6;
  if (!shooter.classId) {
    ctx.emit({ type: "sound", id: 6 });
    ctx.state.ammo = u8(ctx.state.ammo - 1);
  } else ctx.emit({ type: "sound", id: 5 });
  return 0;
}

// h0:38f6 save is unreachable: h0:234a never saves class 19.
export const projectileClass: ActorClass<ProjectileActor> = {
  id: 19,
  name: "bomb",
  createState: () => ({
    projectileOwnerClass: 0, projectileParked: 0, projectileOwnerGrace: 0, projectileLifetime: 0,
    projectilePathTime: 0, projectilePath: 0, projectilePathStep: 0,
  }),
  // h0:384c (DOS 0:3cc4) init(record, object): byte 3 = direction | stopped << 3 | path << 4; speed grows by 3 every
  // 50 scenes; starts parked for one pass.
  init(ctx, a, spec) {
    const argument = recordArgument(spec);
    a.direction = argument & 7;
    a.movementHeading = (argument & 7) << 3;
    if (argument & 8) a.noTurn = 1;
    a.projectilePath = (s8(argument) >> 4) & 7;
    a.projectilePathStep = u8(a.projectilePath * 19);
    a.facing = 0;
    a.height = 9;
    a.speed = u8(Math.trunc(ctx.state.sceneIndex / 50) * 3 + 0x19);
    a.ignoredClass = 19;
    a.projectileParked = 1;
    a.x = (a.x & 0xff00) | 0x80;
    a.y = (a.y & 0xff00) | 0x80;
    if (ctx.state.sceneIndex === 0x89) a.collisionDisabled = 1;
  },
  // h0:5846 (DOS 0:5d78): roll, or follow the scene-0x89 path; the shooter becomes hittable after the grace passes.
  update(ctx, a) {
    roll(ctx, a);
    if (ctx.state.sceneIndex === 0x89) {
      followPath(ctx, a);
      return;
    }
    a.projectileParked = 0;
    if (!a.projectileOwnerGrace) return;
    a.projectileOwnerGrace = u8(a.projectileOwnerGrace - 1);
    if (!a.projectileOwnerGrace) a.ownerId = 0xffff;
  },
  // h0:5972 (DOS 0:5eb5) message(kind, msg): 0 collision, 2 teleport, 8 wall (explode), 9 hit (explode).
  message(ctx, a, message) {
    switch (s8(message.type)) {
      case 0: return collision(ctx, a, message.sender);
      case 2: return Number(teleportActor(ctx, a, message.x ?? a.x, message.y ?? a.y));
      case 8: explode(ctx, a); return 0xffff;
      case 9: explode(ctx, a); return 1;
      default: return 0;
    }
  },
  // h0:5a14 -> h0:10062 (DOS 0:5f64): spin one frame per pass, the colour scheme following the frame.
  post(_ctx, a) {
    a.frame = u8(a.frame + 1);
    let shape = SEQUENCE[s8(a.frame)];
    if (shape === undefined || shape === 255) {
      a.frame = 0;
      shape = SEQUENCE[0]!;
    }
    a.spriteScheme = SCHEMES[s8(a.frame)]!;
    a.spritePaths[0] = [shape];
    a.spriteOffsetX[0] = 1;
    a.spriteOffsetY[0] = 0;
  },
  // h0:5a1a (DOS 0:5f6a).
  draw(ctx, a, gfx) { drawPart(ctx, a, gfx, 0); },
};
