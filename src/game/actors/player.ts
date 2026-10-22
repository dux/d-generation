import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { animateWalk, blocked, collide, findCollision, moveActor, nudge, setSpeed, spawnAhead, teleportActor, updateBounds } from "../core/geometry.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import { animate, dgenTouch, drawPart, spawnRemains } from "./shared.ts";
import { fireProjectile } from "./gre.ts";
import { spawnElectricDeath } from "./elc.ts";
import type { LaserActor } from "./laser.ts";
import type { TubActor } from "./tub.ts";
import { flash, type GeneratorActor } from "./cgen.ts";

// AGA +98..+b0.
export interface PlayerActor extends Actor {
  walkDistance: number;
  knockbackFrames: number;
  nudgePending: number;
  inputHeading: number;
  invulnerabilityTicks: number;
  invulnerable: number;
  liftedAnimation: number;
  controlled: number;
  liftedTicks: number;
  playerShieldFrame: number;
}

const DEADLY = new Set([11,22,7,21,19,6,15,20,14,26]); // g:9b8.
const LIFT_SEQUENCE = [0,0,1,2,1,0,1,2,1,0,1,2,1,0,255]; // g:3c0c.
const SHIELD_SEQUENCE = [0,2,3,255]; // g:3c1b.
const MIRROR_WIDTH = [17,21,22,21,0]; // g:3c1f.

// h0:4dd8 (DOS 0:5355): joystick/demo first, keyboard only below its dead zone.
function input(ctx: ActorContext, actor: PlayerActor): void {
  if (ctx.state.demoRecording) throw new Error("AGA demo recording UI not ported (h0:4dea)");
  const joy = ctx.readDirection();
  let direction = joy.direction;
  let moved = false, speed = 0;
  if (direction !== -1 && joy.magnitude > 30) {
    actor.inputHeading = u8(joy.heading);
    speed = joy.magnitude > 38 ? 63 : 0;
    moved = true;
  }
  if (!moved && ctx.input.direction !== undefined && ctx.input.direction !== -1) {
    direction = ctx.input.direction & 7;
    actor.inputHeading = direction << 3;
    speed = 63;
    moved = true;
  }
  if (!moved) {
    actor.speed = 0;
    actor.x = (actor.x & 0xff00) | 128;
    actor.y = (actor.y & 0xff00) | 128;
    actor.frame = 0;
    return;
  }
  if (s8(actor.facing) !== direction) {
    actor.frame = 0;
    actor.x = (actor.x & 0xff00) | 128;
    actor.y = (actor.y & 0xff00) | 128;
  }
  actor.facing = u8(direction);
  actor.direction = u8(direction);
  actor.movementHeading = u8(direction << 3);
  if (speed) setSpeed(actor, speed);
}

// h0:4dac (DOS 0:5334): knockback decrements per update, not per tick.
function control(ctx: ActorContext, actor: PlayerActor): void {
  if (!actor.controlled) return;
  if (actor.knockbackFrames) actor.knockbackFrames = u8(actor.knockbackFrames - 1);
  if (!actor.knockbackFrames) input(ctx, actor);
}

// h0:4d54 (DOS 0:52d2): knockback uses a full 0x100 movement tick.
function move(ctx: ActorContext, actor: PlayerActor): void {
  const ticks = ctx.state.frameTicks;
  if (actor.knockbackFrames) ctx.state.frameTicks = 256;
  const delta = moveActor(ctx, actor, 6);
  if (actor.nudgePending) {
    actor.nudgePending = 0;
    nudge(ctx, actor);
  }
  ctx.state.frameTicks = ticks;
  animateWalk(ctx, actor, delta.dx, delta.dy);
}

// h0:50a4 (DOS 0:5604): the AGA keyboard shoots with T, not the DOS browser remapping.
function fire(ctx: ActorContext, actor: PlayerActor): void {
  let pressed = ctx.readButton(0) === 2;
  const key = ctx.input.keyCode ?? ctx.input.key;
  if (!pressed && ctx.input.keyPressed && (key === 84 || key === 116)) {
    pressed = true;
    ctx.input.keyPressed = false;
    ctx.input.keyCode = 0;
  }
  if (!pressed || !ctx.state.ammo || fireProjectile(ctx, actor)) return;
  const shot = ctx.state.spawned;
  if (!shot) throw new Error("AGA h0:50a4 projectile spawn did not produce an actor");
  shot.movementHeading = u8(s8(shot.direction) << 3);
  shot.ownerId = actor.id;
}

// h0:5452 (DOS 0:592a): a thrown laser resolves its starting overlap before flying.
function throwObject(ctx: ActorContext, actor: PlayerActor): void {
  if (ctx.state.sceneIndex === 0x84 && !ctx.state.generatorOverride) {
    ctx.state.useDisabled = 1;
    ctx.storyTransition(0x8a);
    return;
  }
  if (!ctx.state.throwableAvailable) return;
  const shot = spawnAhead(ctx, actor, 20, actor.facing);
  ctx.state.spawned = shot;
  if (!shot) { ctx.emit({type:"sound",id:2}); return; }
  shot.ownerId = actor.id;
  updateBounds(shot);
  const other = findCollision(ctx, shot);
  if (other) { collide(ctx, shot, other.classId + 0x60); return; }
  if (blocked(ctx, shot)) { ctx.objects.remove(shot); ctx.emit({type:"sound",id:2}); return; }
  shot.ownerId = 65535;
  shot.speed = 85;
  (shot as LaserActor).bounces = 0;
  (shot as LaserActor).lifetime = 2;
  ctx.emit({type:"sound",id:1});
}

// h0:510c (DOS 0:5673 differs): AGA use throws; no DOS conversation search here.
function use(ctx: ActorContext, actor: PlayerActor): void {
  if (ctx.state.useDisabled) return;
  let pressed = ctx.readButton(1) === 2;
  if (!pressed && ctx.input.keyPressed && (ctx.input.keyCode ?? ctx.input.key) === 32) {
    pressed = true;
    ctx.input.keyPressed = false;
    ctx.input.keyCode = 0;
  }
  if (pressed) throwObject(ctx, actor);
}

// h0:12e5e (DOS 0:5220): expiration is a signed-word test after wrapping subtraction.
function invulnerability(ctx: ActorContext, actor: PlayerActor): void {
  if (!actor.invulnerabilityTicks) return;
  actor.invulnerabilityTicks = u16(actor.invulnerabilityTicks - ctx.state.frameTicks);
  if (s16(actor.invulnerabilityTicks) > 0) return;
  actor.invulnerabilityTicks = actor.invulnerable = 0;
}

// h0:4ece (DOS 0:544f): collision changes movement direction, not the drawn facing.
function collision(ctx: ActorContext, actor: PlayerActor, message: ActorMessage): number {
  const sender = message.sender;
  if (!sender) throw new Error("AGA player collision requires its sender");
  if (actor.invulnerable && sender.classId === 21) return 0;
  if (!actor.noTurn) {
    if (!sender.speed) {actor.nudgePending = 1;if (!actor.knockbackFrames) actor.knockbackFrames = 2;}
    if (sender.classId !== 6) {
      if (sender.classId === 15 && (sender as TubActor).attackActive) return 0;
      actor.direction = u8(message.direction ?? 0);
      actor.movementHeading = 255;
    }
  }
  ctx.emit({type:"sound",id:57});
  return 65535;
}

// h0:505a (DOS 0:55c0): reverse pushes ask the following movement pass to nudge.
function pushed(ctx: ActorContext, actor: PlayerActor, direction: number): number {
  if (s8(actor.direction) === (s8(direction) ^ 4)) actor.nudgePending = 1;
  actor.direction = u8(direction);
  actor.movementHeading = 255;
  if (!actor.knockbackFrames) {actor.knockbackFrames=2;ctx.emit({type:"sound",id:57});}
  return 65535;
}

// h0:524a (DOS 0:5792): AGA remains classes and the special dgen ending differ from DOS.
function die(ctx: ActorContext, actor: PlayerActor, sender: Actor | null): boolean {
  const classId = sender?.classId ?? 19;
  if (!DEADLY.has(classId)) return true;
  actor.collisionDisabled = 0;
  actor.removed = ctx.state.round;
  const spawn = (id: number) => ctx.objects.spawn(id,{class:`unknown-${id}`,x:actor.x>>>8,y:actor.y>>>8,params:{orientation:0,variant:0}});
  switch (classId) {
    case 6: ctx.emit({type:"sound",id:37}); break;
    case 7: spawnRemains(ctx,actor,2,0,0); break;
    case 14: spawnElectricDeath(ctx,actor); break;
    case 15: spawn(5); break;
    case 22:
      spawn(12);
      ctx.objects.spawn(24,{class:"hed",x:actor.x>>>8,y:actor.y>>>8,params:{orientation:(sender!.direction^4)&7}});
      spawnRemains(ctx,actor,2,0,0);
      ctx.emit({type:"sound",id:37});
      break;
    case 26:
      dgenTouch(ctx);
      return false;
    default:
      if (!sender) throw new Error("AGA player blast death without sender not ported (h0:540a)");
      if (sender.classId === 19) {
        ctx.state.shakeScript=[-4,-2,0,3,0,-2,2,0,128];
        ctx.state.shakeRestoreScript=[-2,1,0,-1,0,128];
      }
      spawnRemains(ctx,actor,2,sender.direction,sender.speed);
      flash(ctx,1,2);
  }
  return true;
}

// h0:5142 (DOS 0:5716): damage, shield pickups, death-state and timer transitions.
function hit(ctx: ActorContext, actor: PlayerActor, sender: Actor | null): number {
  if (actor.invulnerable) return 1;
  if (sender?.classId === 26 && (sender as GeneratorActor).generatorDying) return 1;
  if (ctx.state.invulnerable && sender?.classId !== 26) {
    if (sender?.classId === 19) ctx.state.invulnerabilityTime=0;
    if (sender?.classId === 21 && s8(ctx.state.carriedBombs)<3) {ctx.state.carriedBombs=u8(ctx.state.carriedBombs+1);sender.removed=ctx.state.round;}
    return 1;
  }
  if (sender?.classId === 20) return 1;
  if (!die(ctx,actor,sender)) return 1;
  if (!ctx.state.backgroundDirty && ctx.state.generatorOverride && !ctx.state.roomEffect) {
    ctx.state.roomEffect=1;
    ctx.state.endingTime=0x3200;
  }
  const resilience = u8((ctx.state.roomResilience[ctx.state.sceneIndex] ?? 0) - 17);
  ctx.state.roomResilience[ctx.state.sceneIndex] = Math.max(180,resilience);
  ctx.state.roomAlert=0;
  ctx.state.deathPending=1;
  ctx.state.player=null;
  ctx.timers.set(ctx.state.roomTimer,200);
  ctx.timers.enable(ctx.state.roomTimer,1);
  ctx.timers.freeze(ctx.state.roomTimer);
  return 1;
}

export const playerClass: ActorClass<PlayerActor> = {
  id:0,
  name:"PLY",
  createState: () => ({ walkDistance: 0, knockbackFrames: 0, nudgePending: 0, inputHeading: 0, invulnerabilityTicks: 0, invulnerable: 0, liftedAnimation: 0, controlled: 0, liftedTicks: 0, playerShieldFrame: 0 }),
  // h0:373c (DOS 0:3c2f): player starts controlled and invulnerable for ten ticks.
  init(ctx,base) {
    const actor=base as PlayerActor;
    actor.playerShieldFrame=0;
    actor.walkDistance=actor.knockbackFrames=actor.nudgePending=actor.inputHeading=0;
    actor.liftedAnimation=actor.liftedTicks=0;
    actor.controlled=actor.invulnerable=1;
    actor.invulnerabilityTicks=2560;
    const alternate=ctx.state.useDisabled&&ctx.state.sceneIndex!==57;
    ctx.emit({type:"palette",start:192,colors:alternate?[30,28,28,49,48,46,21,19,19,16,21,40]:[46,32,24,49,49,32,30,23,14,21,26,32]});
    ctx.emit({type:"palette",start:196,colors:alternate?[17,17,17,24,24,24,13,13,13,10,10,10]:[46,14,14,63,21,21,30,8,8,23,7,7]});
  },
  // h0:4cbc (DOS 0:51ee): AGA gates fire, use and invulnerability together with g:526.
  update(ctx,base) {
    const actor=base as PlayerActor,ticks=ctx.state.frameTicks;
    if(ctx.state.slowMotion)ctx.state.frameTicks=ctx.state.slowFrameTicks;
    control(ctx,actor);
    move(ctx,actor);
    if(!ctx.state.abortFrame){fire(ctx,actor);use(ctx,actor);invulnerability(ctx,actor);}
    ctx.state.frameTicks=ticks;
  },
  // h0:4cf0 (DOS 0:5248): receiver/sender are explicit in the native message.
  message(ctx,base,message) {
    const actor=base as PlayerActor;
    switch(message.type){
      case 0:return collision(ctx,actor,message);
      case 2:return Number(teleportActor(ctx,actor,message.x??actor.x,message.y??actor.y));
      case 5: // h0:12e88: hand control to the lift animation.
        actor.liftedAnimation=1;actor.controlled=0;actor.speed=actor.frame=0;actor.liftedTicks=768;return 1;
      case 8:return pushed(ctx,actor,message.direction??0);
      case 9:return hit(ctx,actor,message.sender);
      default:return 0;
    }
  },
  // h0:4f56 -> h0:faf4 (DOS 0:54d4): choose mirrored facing and lift/shield sequence.
  post(ctx,base) {
    const actor=base as PlayerActor;
    let direction=s8(actor.facing);
    actor.spriteMirror=direction>4?1:0;
    if(direction>4)direction=8-direction;
    actor.spriteMirrorWidth[0]=actor.frame?MIRROR_WIDTH[direction]:17;
    actor.spriteOffsetY[0]=3;
    actor.spriteOffsetX[0]=0;
    actor.spriteEnabled[0]=1;
    actor.spriteSets[0]=0;
    if(actor.liftedAnimation){
      const result=animate(ctx,actor,LIFT_SEQUENCE,450,"liftedTicks");
      if(result.wrapped){actor.liftedAnimation=0;actor.controlled=1;}
      actor.spriteMirrorWidth[0]=17;
      actor.spritePaths[0]=[1,direction>>1,result.frame];
    }else if(ctx.state.invulnerable&&!actor.frame){
      // The shield pose uses a separate sequence index, leaving the walking frame at zero.
      const frame=actor.frame;
      actor.frame=actor.playerShieldFrame;
      const result=animate(ctx,actor,SHIELD_SEQUENCE,450,"liftedTicks");
      actor.playerShieldFrame=actor.frame;actor.frame=frame;
      actor.spritePaths[0]=[0,direction,result.frame];
    }else actor.spritePaths[0]=[0,direction,actor.frame];
  },
  // h0:4f5c (DOS 0:54da): draw on the panel composition layer.
  draw(ctx,actor,gfx){drawPart(ctx,actor,gfx,0);},
};
