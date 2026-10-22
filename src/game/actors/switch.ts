import type { ObjectSpec } from "../../formats/level.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "../core/model.ts";
import { boxesOverlap } from "../core/geometry.ts";
import { animate, drawPart, saveRecord } from "./shared.ts";
import { showMessage } from "../core/messages.ts";

export interface SwitchActor extends Actor { switchGroup: number;
switchSecondaryGroup: number;
switchAction: number;
switchChanged: number;
switchOverlapping: number;
switchOverlapActor: Actor | null;
switchCooldown: number;
switchOneShot: number;
animationTime: number; }

const PRESSERS = [0, 21, 6, 15, 9, 20, 19]; // g:18fb
const PRESS_FRAMES = [1, 0, 1, 0, 1, 0, 1, 0, -1]; // g:3dda
const OFFSETS = [-4, 16, -4, 10, -6, 12, -6, 14, -5, 16, -5, 10, 0, 0, 1, 0]; // g:3de3

// h0:9dae/h0:9dc0 (DOS 0:7920/7932): signal every matching door and turret, in slot order.
export function signalSwitchGroup(ctx: ActorContext, actor: SwitchActor): number {
  let changed = 0;
  for (const target of ctx.objects.slots) {
    if (!target || (target.classId !== 2 && target.classId !== 10)) continue;
    const group = (target as Actor & { switchGroup: number }).switchGroup;
    if (group === 7 || (group !== actor.switchGroup && (actor.switchOneShot || group !== actor.switchSecondaryGroup))) continue;
    if (ctx.objects.send(target, { type: 4, sender: actor, switchAction: actor.switchAction })) changed = 1;
  }
  return changed;
}

// h0:9c5c (DOS 0:77dd): physical presses, security keys and the scene-121 countdown switch.
function press(ctx: ActorContext, actor: SwitchActor, message: ActorMessage): number {
  const sender = message.sender;
  if (!sender || !boxesOverlap(sender, actor) || !PRESSERS.includes(sender.classId) || actor.switchCooldown) return 0xffff;
  // h0:9e50 (DOS 0:79c9): the presser must approach from the switch's front.
  if (((sender.direction - actor.direction) & 7) < 5) return 0xffff;
  if (sender.classId !== 19 && sender.classId !== 20) actor.switchCooldown = 0xf00;
  if (!actor.switchOneShot) {
    if (signalSwitchGroup(ctx, actor)) {
      ctx.emit({ type: "sound", id: 22 });
      actor.switchChanged = 1;
    }
    return 0xffff;
  }
  if (sender.classId !== 0) return 0xffff;
  if (actor.switchSecondaryGroup >= ctx.state.bombsFound) {
    showMessage(ctx, `\`Level ${actor.switchSecondaryGroup + 1} Security Key Required`, 4, 2);
    return 0xffff;
  }
  if (ctx.state.sceneIndex === 121) {
    const animation = ctx.objects.slots.find(target => target?.classId === 25) as
      (Actor & { anmTriggered: number; anmTime: number }) | undefined;
    if (!animation) return 0xffff;
    ctx.emit({ type: "sound", id: 36 });
    animation.anmTriggered = 1;
    animation.anmTime = ctx.objects.slots.some(target => target?.classId === 26) ? 0x7800 : 0xa00;
    return 0xffff;
  }
  if (signalSwitchGroup(ctx, actor) && ctx.state.sceneIndex !== 133) {
    ctx.emit({ type: "sound", id: 22 });
    showMessage(ctx, "`Security Door Opened!", 4, 3);
  }
  return 0xffff;
}

export const switchClass: ActorClass = {
  id: 4,
  name: "SWITCH",
  // h0:9e92/h0:12ccc (DOS 0:7a0d/7aba): unpack switch groups and action.
  init(ctx, base, spec) {
    const actor = base as SwitchActor;
    actor.switchGroup = spec.params.group ?? 0;
    actor.switchSecondaryGroup = ctx.state.sceneIndex === 108 ? 9 : (spec.params.secondGroupOrFloor ?? 0);
    actor.switchChanged = actor.switchOverlapping = actor.switchCooldown = actor.switchOneShot = actor.animationTime = 0;
    actor.switchOverlapActor = null;
    const action = spec.params.action ?? 0;
    actor.switchAction = action === 0 ? 1 : action === 2 ? 255 : 0;
    if (action === 3) actor.switchOneShot = 1;
    if (ctx.state.sceneIndex === 133) {
      actor.switchOneShot = 1;
      actor.switchAction = 255;
    }
    actor.x &= 0xff00;
    actor.y &= 0xff00;
    actor.height = 10;
  },
  // h0:9be8/9bf2/9c0e (DOS 0:7741/7748/7764): decrement cooldown and release overlap latch.
  update(ctx, base) {
    const actor = base as SwitchActor;
    const time = (actor.switchCooldown - ctx.state.frameTicks) & 0xffff;
    actor.switchCooldown = time & 0x8000 ? 0 : time;
    if (actor.switchOverlapping && (!actor.switchOverlapActor || !boxesOverlap(actor, actor.switchOverlapActor))) actor.switchOverlapping = 0;
  },
  // h0:9c2e (DOS 0:778a): touch and use messages press the switch.
  message(ctx, base, message) {
    return message.type === 0 || message.type === 6 ? press(ctx, base as SwitchActor, message) : 0;
  },
  // h0:9e78/h0:10730 (DOS 0:79f0): animate a successful press and select the wall-facing sprite.
  post(ctx, base) {
    const actor = base as SwitchActor;
    const direction = (actor.facing >> 1) + (actor.switchSecondaryGroup === 7 ? 4 : 0);
    actor.spriteOffsetX[0] = OFFSETS[direction * 2 + 1];
    actor.spriteOffsetY[0] = OFFSETS[direction * 2];
    let frame = actor.switchOneShot ? 2 : 0;
    if (actor.switchChanged) {
      const result = animate(ctx, actor, PRESS_FRAMES, 0x190);
      frame = result.frame;
      if (result.wrapped) actor.switchChanged = actor.frame = 0;
    }
    actor.spritePaths[0] = [frame, direction];
  },
  // h0:9e7e (DOS 0:79f6): group seven is an invisible switch.
  draw(ctx, base, gfx) {
    if ((base as SwitchActor).switchGroup !== 7) drawPart(ctx, base, gfx);
  },
  // h0:9ec8/h0:41dc (DOS 0:7a42/4642): byte 3 = group | second group<<3 | action<<6 (-1 -> 2, 0 -> 1 or one-shot 3).
  save(_ctx, base): ObjectSpec {
    const actor = base as SwitchActor;
    const action = actor.switchAction === 255 ? 0x80 : actor.switchAction === 0 ? (actor.switchOneShot ? 0xc0 : 0x40) : 0;
    return saveRecord(actor, action | actor.switchGroup | (actor.switchSecondaryGroup << 3));
  },
};
