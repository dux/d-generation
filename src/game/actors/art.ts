import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { chase, inRange, moveToward } from "../core/geometry.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import { showMessage } from "../core/messages.ts";
import { animate, drawPart, saveRecord, spawnRemains } from "./shared.ts";
import { flash } from "./cgen.ts";

// Class 11, ART: the room's artefacts. Kinds: 0 laser pickup, 1 and 3 decorations, 2 grenade pack, 4 security key,
// 5 electric eye (opens door group 0 while the player is in its sight), 6 decoration that stops when the room is
// cleared (h0:2476), 7 bomb placed by the inventory (h0:1400c), exploding when its fuse runs out.
// AGA +98 animation timer, +9a kind, +9b parameter, +9c eye triggered, +9d stopped, +9e fuse, +a0 tick timer.
export interface ArtActor extends Actor {
  animationTime: number;
  artKind: number;
  artParameter: number;
  artSensorTriggered: number;
  artFired: number;
  artFuse: number;
  artTickTime: number;
}

const IDLE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 255]; // g:3d60
const BOMB = [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 255]; // g:3d6e
const KIND3 = [...Array(31).fill(0), 1, 2, 3, 4, 3, 2, 1, 255]; // g:3d83
const KIND1 = [1, 2, 3, 4, 2, 3, 1, 4, 3, 2, 1, 4, 3, 255]; // g:3daa
const KIND6 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 255]; // g:3db8
const TAKERS = [0, 19, 20]; // g:1348
const BLAST_SHAKE = [5, -7, 0, 3, -3, -7, 5, -3, 2, 0, 128]; // g:1332

// h0:8784 -> h0:87ac signalGroup(group, action): message 4 to every door and turret of the group; nonzero when one
// changed. The message's sender slot is never written by the original (stale stack), and its receivers ignore it.
export function signalGroup(ctx: ActorContext, group: number, action: number): number {
  let changed = 0;
  ctx.objects.forEach(target => {
    if (target.classId !== 2 && target.classId !== 10) return;
    if ((target as Actor & { switchGroup: number }).switchGroup !== group) return;
    if (ctx.objects.send(target, { type: 4, sender: null, switchAction: u8(action) })) changed = 1;
  });
  return changed;
}

// h0:8728 (DOS 0:7d27) artSense(): the eye fires once while the player is within 0x3c along its direction.
function sense(ctx: ActorContext, a: ArtActor): void {
  const player = ctx.state.player;
  if (!player) return;
  if (moveToward(ctx, a, player, 0x3c, s16(s8(a.artParameter) << 3), 4) === -1) {
    a.artSensorTriggered = 0;
    return;
  }
  if (!a.artSensorTriggered && signalGroup(ctx, 0, 0xff)) ctx.emit({ type: "sound", id: 15 });
  a.artSensorTriggered = 1;
}

// h0:86d2 -> h0:86e6 (DOS 0:7cba) artBlast(bomb): message 9 to doors within 0xf and to objects the bomb sees within 0x50.
function blast(ctx: ActorContext, bomb: ArtActor): void {
  ctx.objects.forEach(target => {
    if (target.classId === 2) {
      if (!inRange(bomb, target, 0xf)) return;
    } else if (chase(ctx, bomb, target, 0x50, 4) === -1) return;
    ctx.objects.send(target, { type: 9, sender: bomb });
  });
}

// h0:865e (DOS 0:7c45) artFuse(): ticks every 0x300 during the last 0x3200; when the fuse wraps past zero the bomb
// becomes remains, hits everything around it and shakes the screen.
function fuse(ctx: ActorContext, a: ArtActor): void {
  if (a.artFuse < 0x3200) {
    a.artTickTime = u16(a.artTickTime - ctx.state.frameTicks);
    if (s16(a.artTickTime) <= 0) {
      a.artTickTime = u16(a.artTickTime + 0x300);
      ctx.emit({ type: "sound", id: 34 });
    }
  }
  a.artFuse = u16(a.artFuse - ctx.state.frameTicks);
  if (a.artFuse <= 0xfa00) return;
  spawnRemains(ctx, a, 2, 0, 0);
  blast(ctx, a);
  ctx.state.shakeScript = BLAST_SHAKE;
  flash(ctx, 0, 0xf);
  ctx.emit({ type: "sound", id: 8 });
}

// h0:8836 (DOS 0:7e44) artTaken(): a player, grenade or laser touching the artefact uses it by kind; returns 0.
function taken(ctx: ActorContext, a: ArtActor, message: ActorMessage): number {
  const sender = message.sender;
  if (!sender) throw new Error("AGA h0:8836 reads the class of the toucher of an artefact; none was given");
  if (!TAKERS.includes(sender.classId)) return 0;
  switch (s8(a.artKind)) {
    case 0: // h0:88f6: the throwable laser.
      if (sender.classId) break;
      ctx.state.throwableAvailable = 1;
      showMessage(ctx, "`Laser!", 4, 3);
      ctx.emit({ type: "sound", id: 20 });
      a.removed = ctx.state.round;
      break;
    case 2: { // h0:8958 (DOS 0:7f39): grenades; init clears the parameter, so a pack is always one grenade.
      if (sender.classId) break;
      const count = u8(a.artParameter + 1);
      ctx.state.ammo = u8(ctx.state.ammo + count);
      a.removed = ctx.state.round;
      showMessage(ctx, `\`${s8(count)} Grenade${count === 1 ? "." : "s!"}`, 3, 3);
      ctx.emit({ type: "sound", id: 20 });
      break;
    }
    case 4: { // h0:8896 (DOS 0:7e9c): a security key raises the key level.
      if (sender.classId) break;
      const level = s8(a.artParameter);
      if (level >= s8(ctx.state.bombsFound)) ctx.state.bombsFound = u8(level + 1);
      showMessage(ctx, `\`Security Key Level ${level + 1}!`, 4, 3);
      ctx.emit({ type: "sound", id: 20 });
      a.removed = ctx.state.round;
      break;
    }
    case 5: // h0:8926 (DOS 0:7efe): only a grenade or laser destroys the eye.
      if (sender.classId !== 20 && sender.classId !== 19) break;
      a.removed = ctx.state.round;
      showMessage(ctx, "`Electric Eye Destroyed.", 3, 2);
      break;
  }
  return 0;
}

// h0:10412 post(): sprite per kind; true when the bomb animation wraps.
function pose(ctx: ActorContext, a: ArtActor): boolean {
  let sequence = IDLE, period = 0x258, child = 0, wrapped = false;
  a.spriteOffsetX[0] = 0;
  a.spriteOffsetY[0] = 4;
  a.spriteEnabled[1] = 0;
  const kind = s8(a.artKind);
  if (kind === 3) { sequence = KIND3; period = 0x118; child = 1; }
  if (kind === 2) child = 2;
  if (kind === 0) child = 7;
  if (kind === 5) child = 3;
  if (kind === 7) {
    if (a.artFuse < 0x3200) a.frame = 0;
    const animation = animate(ctx, a, BOMB, 0x12c);
    wrapped = animation.wrapped;
    a.spritePaths[0] = [6, animation.frame];
  } else if (kind === 6) {
    a.spriteMirror = a.artParameter ? 1 : 0;
    if (a.artParameter) a.spriteMirrorWidth[0] = 0xe;
    a.spritePaths[0] = [5, a.artFired ? 0 : animate(ctx, a, KIND6, 0x190).frame];
    a.spriteOffsetX[0] = 1;
    a.spriteOffsetY[0] = 4;
  } else if (kind === 1) {
    const animation = animate(ctx, a, KIND1, 0x15e);
    a.spritePaths[0] = [4, animation.frame];
    a.spriteOffsetY[0] = 7 - s8(a.frame);
    a.spriteOffsetX[0] = -1;
    a.spritePaths[1] = [4, 0];
    a.spriteEnabled[1] = 1;
    a.spriteOffsetX[1] = 0;
    a.spriteOffsetY[1] = 4;
  } else a.spritePaths[0] = [child, animate(ctx, a, sequence, period).frame];
  return wrapped;
}

export const artClass: ActorClass<ArtActor> = {
  id: 11,
  name: "art",
  createState: () => ({ animationTime: 0, artKind: 0, artParameter: 0, artSensorTriggered: 0, artFired: 0, artFuse: 0, artTickTime: 0 }),
  // h0:89e8 -> h0:9508 -> h0:1276e (DOS 0:7fce) init(record, object): byte 3 = kind | parameter << 3; every
  // artefact in scene index 0x67 has parameter 6.
  init(ctx, a, spec) {
    a.artKind = (spec.params.kind ?? 0) & 7;
    a.artParameter = (spec.params.parameter ?? 0) & 7;
    if (ctx.state.sceneIndex === 0x67) a.artParameter = 6;
    switch (a.artKind) {
      case 3: case 5: a.height = 9; break;
      case 6: a.height = 0x16; a.firstLayer = 1; break;
      case 7: a.artFuse = 0x8c00; break;
      case 1: a.height = 0x10; break;
      case 2: a.artParameter = 0; break;
      default: a.frame = ctx.random.next(3);
    }
    a.collisionDisabled = 1;
  },
  // h0:863c (DOS 0:7c28): the eye senses, the bomb burns its fuse.
  update(ctx, a) {
    if (a.artKind === 5) sense(ctx, a);
    if (a.artKind === 7) fuse(ctx, a);
  },
  // h0:87f8 (DOS 0:7df8) message(kind, msg): 6 is a touch; everything else returns 1.
  message(ctx, a, message) {
    return s8(message.type) === 6 ? taken(ctx, a, message) : 1;
  },
  // h0:89c2 (DOS 0:7f9f): a bomb ticks each time its animation wraps.
  post(ctx, a) {
    if (pose(ctx, a)) ctx.emit({ type: "sound", id: 34 });
  },
  // h0:89d2 (DOS 0:7fb1): part 1 behind part 0.
  draw(ctx, a, gfx) {
    drawPart(ctx, a, gfx, 1);
    drawPart(ctx, a, gfx, 0);
  },
  // h0:89fe (DOS 0:8058) save(object, record): byte 3 = parameter << 3 | kind, then h0:41dc.
  save(_ctx, a) {
    return saveRecord(a, (s8(a.artParameter) << 3) | s8(a.artKind));
  },
};
