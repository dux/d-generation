import type { ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { moveActor, targetAim, teleportActor } from "../core/geometry.ts";
import { animate, countDown, drawPart, saveRecord, spawnRemains } from "./shared.ts";
import { flash, type GeneratorActor } from "./cgen.ts";
import type { PlayerActor } from "./player.ts";

// AGA +98..+ab.
export interface OrbActor extends Actor { animationTime: number;
attackActive: number;
attackReset: number;
attackDamage: number;
captured: number;
capturePending: number;
deathTimer: number;
capturedAnimationTime: number;
capturedFrame: number;
cooldown: number;
targetId: number;
capturedScheme: number;
capturedClass: number; }

const SEQUENCE = [0,4,1,2,4,3,4,2,1,4,255,0,4,1,2,4,3,4,2,1,4,255,0,0,1,1,1,1,2,4,3,4,2,1,4,255]; // g:3c23
const DAMAGE = [0,25,50,50,50,50,50,50,50,25,255,0,255,255,255,255,255,255,255,255,255,255,0,0,0,0,20,20,20,20,20,20,20,255,0,1]; // g:3c5e, including adjacent-table bytes
const HEIGHT = [0,1,3,8,12,15,12,8,3,1,255,0,2,8,16,25,30,25,16,8,2,255,233,241,247,0,2,8,16,25,30,25,16,8,2,255]; // g:3c80
const CAPTURE = [0,0,1,0,0,2,0,2,0,0,1,0,2,0,1,0,1,255]; // g:3c47
const CAPTURE_HEIGHT = [12,22,20,14,17]; // g:3c59

// h0:3cd2 (DOS 0:414b): square range, using integer coordinate bytes.
export function within(a: Actor, b: Actor | null, range: number): boolean {
  return b !== null && Math.abs((a.x >>> 8) - (b.x >>> 8)) <= range && Math.abs((a.y >>> 8) - (b.y >>> 8)) <= range;
}

// h0:42ca/h0:db40/h0:dae8: the original bounded integer square-root iteration.
export function actorDistance(a: Actor, b: Actor): number {
  const dx = Math.abs((a.x >>> 8) - (b.x >>> 8)) >>> 1;
  const dy = Math.abs((a.y >>> 8) - (b.y >>> 8)) >>> 1;
  const squared = (dx * dx + dy * dy) & 65535;
  if (squared === 65535) return 510;
  let root = (squared >>> 4) | 1;
  for (let iteration = 0; iteration < 20; iteration++) {
    const quotient = Math.trunc(squared / root);
    const delta = Math.abs(root - quotient) >>> 1;
    root = root > quotient ? root - delta : root + delta;
    if (delta <= 1) break;
  }
  return root * 2;
}

// h0:37fe/h0:4220 (DOS 0:3c82/4693): byte 3 = direction, plus the fine position bits.
export function saveFine(actor: Actor): ObjectSpec {
  return saveRecord(actor, actor.direction, true);
}

// h0:5eb0 (DOS 0:8eed): acquire the player, or the first survivor if player aim fails.
function acquire(ctx: ActorContext, a: OrbActor): void {
  const player = ctx.state.player;
  if (!player || a.captured || a.attackActive || (player as PlayerActor).invulnerable || ctx.state.invulnerable) return;
  if ((a.frame << 24 >> 24) >= 2 || a.cooldown) {
    if ((a.frame << 24 >> 24) >= 26) a.attackReset = 1;
    return;
  }
  a.cooldown = (a.cooldown + 0x400) & 65535;
  let target = player;
  let heading = targetAim(ctx, a, target, 60, 4);
  if (heading === -1) {
    const survivor = ctx.objects.slots.find(o => o && !o.removed && o.classId === 9);
    if (survivor) {
      target = survivor;
      heading = targetAim(ctx, a, target, 60, 4);
    }
  }
  if (heading === -1) { a.targetId = 0; return; }
  a.ownerId = a.targetId = target.id;
  a.movementHeading = heading;
  a.direction = heading & 7 ? ((heading + 8) >> 3) & 6 : heading >> 3;
  a.attackDamage = (Math.trunc(ctx.state.sceneIndex / 50) * 3 + 65) & 255;
  a.attackActive = 1;
  a.frame = 11;
  a.ignoredClass = 6;
}

// h0:5fdc (DOS 0:902c): release a captured player and possibly generate a homing creature.
function hit(ctx: ActorContext, a: OrbActor, sender: Actor | null): void {
  if (!sender || ![11,7,21,19,20,14].includes(sender.classId)) return;
  if (sender.classId === 14) { a.attackDamage = 70; a.attackActive = 1; a.frame = 11; return; }
  spawnRemains(ctx, a, 2, sender.direction, sender.speed);
  if (a.captured && a.capturedClass === 0) {
    const player = ctx.objects.spawnPlayer(a.x & 0xff00, a.y & 0xff00, 4);
    if (!player) throw new Error("ORB captured-player restoration exhausted object slots");
    ctx.timers.thaw(ctx.state.roomTimer);
  }
  if (!a.captured) {
    const chance = ctx.random.next((40 - ctx.state.sceneIndex) >> 3);
    if (!chance && ctx.state.sceneIndex > 50 && ctx.state.player) {
      const heading = targetAim(ctx, a, ctx.state.player, 80, 4);
      if (heading !== -1 && !ctx.objects.count(22)) {
        const generated = ctx.objects.spawn(22, { class: "cgen", x: a.x >>> 8, y: a.y >>> 8, params: { orientation: ((heading + 4) >> 3) & 7 } });
        if (generated) {
          (generated as GeneratorActor).generatorSpawnTime = 0xa00;
          ctx.emit({ type: "sound", id: 32 });
          flash(ctx, 0, 2);
        }
      }
    }
  }
  ctx.objects.checkRoomCleared(1);
}

export const orbClass: ActorClass = {
  id: 6,
  name: "orb",
  createState: (): Partial<OrbActor> => ({ animationTime: 0 }),
  // h0:37c4 (DOS 0:3c4a).
  init(ctx, actor, spec) {
    const a = actor as OrbActor;
    a.attackActive = a.attackReset = a.attackDamage = a.captured = a.capturePending = 0;
    a.deathTimer = a.capturedAnimationTime = a.capturedFrame = a.cooldown = a.targetId = 0;
    a.capturedScheme = a.capturedClass = 0;
    a.direction = spec.params.facing ?? spec.params.orientation ?? 0;
    a.facing = 0;
    a.frame = ctx.random.next(9);
    a.activeThreat = 1;
  },
  // h0:5d4c,5d62,5da2,5e7c,5e8e (DOS 0:8da3..8eca).
  update(ctx, actor) {
    const a = actor as OrbActor;
    acquire(ctx, a);
    moveActor(ctx, a, 5);
    const death = countDown(ctx, a.deathTimer);
    a.deathTimer = death.value;
    if (death.expired) {
      a.speed = a.direction = 0;
      spawnRemains(ctx, a, 2, 0, 0);
      ctx.objects.checkRoomCleared(1);
    }
    const target = ctx.objects.find(a.targetId);
    if (a.attackActive && target && a.height >= 11 && (a.frame << 24 >> 24) > 16 && within(a, target, 5)) {
      if (ctx.objects.send(target, { type: 2, sender: null, x: target.x, y: target.y })) {
        a.noTurn = 1;
        ctx.objects.send(target, { type: 9, sender: a });
        a.captured = 1;
        a.capturedClass = target.classId;
        a.attackActive = 0;
        a.capturedScheme = target.spriteScheme;
        a.frame = (a.frame - 11) & 255;
        a.deathTimer = 0x3700;
      }
    }
    if (a.cooldown) {
      a.cooldown = (a.cooldown - ctx.state.frameTicks) & 65535;
      if (a.cooldown & 0x8000) a.cooldown = 0;
    }
  },
  // h0:60fe/615c/6196 (DOS 0:9088/90ec/9125). Type 3 (h0:4040) is never sent by any h0:1bd8 caller.
  message(ctx, actor, message) {
    const a = actor as OrbActor;
    switch (message.type) {
      case 0:
      case 8:
        a.cooldown = 0xa00;
        a.direction = message.direction ?? 0;
        a.movementHeading = 255;
        // h0:617e reads the class of the message's receiver (+4), always this ORB, so every touch plays sound 16.
        if (message.type === 0) ctx.emit({ type: "sound", id: 16 });
        return -1;
      case 2: return Number(teleportActor(ctx, a, message.x ?? a.x, message.y ?? a.y));
      case 9: hit(ctx, a, message.sender); return 1;
      default: return 0;
    }
  },
  // h0:61be -> h0:fc1c/fd9a (DOS 0:914a -> 12cc:017c).
  post(ctx, actor) {
    const a = actor as OrbActor;
    const attack = a.attackActive & 255;
    const selected = animate(ctx, a, SEQUENCE, attack ? 0x140 : 0x1c2);
    if (selected.wrapped) {
      a.movementHeading = 255;
      a.noTurn = a.attackActive = a.frame = 0;
      if (a.capturePending) a.captured = 1;
    }
    a.height = HEIGHT[a.frame];
    a.speed = DAMAGE[a.frame] & 128 ? a.attackDamage : DAMAGE[a.frame];
    const high = a.height > 127;
    a.spritePaths = [[high ? 3 : attack ? 1 : 0, selected.frame], [2, selected.frame]];
    a.spriteEnabled = [1, high ? 0 : 1, a.captured ? 1 : 0];
    a.spriteOffsetX = [high ? 1 : (a.spriteOffsetX[0] ?? 0), 0, 4];
    a.spriteOffsetY = [high ? (a.spriteOffsetY[0] ?? 0) : 1, a.height + 4, 0];
    if (a.captured) {
      const oldFrame = a.frame, oldTime = a.animationTime;
      a.frame = a.capturedFrame;
      a.animationTime = a.capturedAnimationTime;
      const captured = animate(ctx, a, CAPTURE, 0x190);
      a.capturedFrame = a.frame;
      a.capturedAnimationTime = a.animationTime;
      a.frame = oldFrame;
      a.animationTime = oldTime;
      a.spritePaths[2] = [4, captured.frame];
      // g:3c59 indexes the main selected frame, not the captured animation index.
      a.spriteOffsetY[2] = 3 - CAPTURE_HEIGHT[selected.frame];
    }
  },
  // h0:61c4 (DOS 0:9150): AGA ignores the captured overlay's DOS scheme argument.
  draw(ctx, actor, gfx) {
    const a = actor as OrbActor;
    drawPart(ctx, a, gfx, 1);
    drawPart(ctx, a, gfx, 0);
    drawPart(ctx, a, gfx, 2);
  },
  // h0:37fe (DOS 0:3c82).
  save(_ctx, actor) { return saveFine(actor); },
};
