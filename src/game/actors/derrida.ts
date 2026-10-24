import type { Dialogue } from "../../formats/level.ts";
import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { s8, s16, u8 } from "../core/int.ts";
import { showMessage } from "../core/messages.ts";
import { chasePlayer } from "./cgen.ts";
import { applySurvivorPalette } from "./sur.ts";
import { animate, drawPart, saveRecord } from "./shared.ts";

// Class 27 (AGA only): one of the six pieces of Derrida in his life-support frame (scene 114, spawned by h0:154c).
// The object shares the SUR layout; piece 0 binds the room's dialogue profile through h0:6de2 and speaks once.
export interface DerridaActor extends Actor {
  derridaPiece: number;
  lastPlayerX: number;
  lastPlayerY: number;
  surHunting: number;
  derridaTwitchTime: number;
  surTargetId: number;
  derridaTwitchAnimationTime: number;
  derridaTwitching: number;
  derridaSpoke: number;
  surSitting: number;
  surStanding: number;
  surHealth: number;
  surCanWander: number;
  surReaction: number;
  surBaseAnimation: number;
  surProfile: Dialogue | null;
  surGrabType: number;
  surProtected: number;
  surRecordState: number;
  surProfileFlags: number;
  // The rest of the SUR layout the conversation code reads (./src/game/ui/talk/talk.ts); the cleared pool entry
  // (h0:1996) leaves them zero.
  surAlerted: number;
  surCarrying: number;
  surAttackTime: number;
  surTopic: number;
  surAsked: number;
}

const TWITCH = [1, 0, 1, 0, -1] as const; // g:3f81

// h0:6de2 (DOS 0:9c17 tail): survivor profile binding; record state hides the profile in visited rooms.
function bindProfile(ctx: ActorContext, actor: DerridaActor, argument: number): void {
  const state = ctx.state;
  let recordFlags = argument;
  actor.surTargetId = 0xff;
  if (recordFlags & 1) actor.surProtected = 1;
  const profiles = ctx.room.chunks.flatMap(chunk => chunk.kind === "dialogue" ? [chunk.dialogue] : []);
  const profile = profiles[state.survivorIndex] ?? null;
  actor.surProfile = profile;
  if (!profile) {
    actor.surCanWander = 1;
    actor.surBaseAnimation = 0x2d;
    actor.surSitting = 1;
    const skin = ctx.random.withSeed(10, state.sceneIndex + state.survivorIndex);
    const clothes = ctx.random.withSeed(12, state.sceneIndex + state.survivorIndex);
    applySurvivorPalette(ctx, skin, clothes, actor.spriteScheme);
  } else {
    actor.surHealth = profile.patience;
    actor.surProfileFlags = profile.answerAllowance;
    actor.surBaseAnimation = profile.speed;
    const mode = s8(profile.initialMode);
    if (mode === 0) actor.surHunting = 1;
    else if (mode === 1) actor.surSitting = 1;
    else if (mode === 2) actor.surStanding = 1;
    actor.surCanWander = profile.behavior;
    actor.surReaction = profile.interaction;
    actor.surGrabType = profile.grabMode;
    state.survivorIndex = u8(state.survivorIndex + 1);
  }
  if (!state.visited[state.sceneIndex]) recordFlags = 0;
  actor.surRecordState = u8(s8(recordFlags) >> 1);
  if (!actor.surRecordState) return;
  actor.surHunting = 1;
  actor.surStanding = actor.surSitting = actor.surProfileFlags = 0;
  actor.surProfile = null;
}

// h0:8468: within sight range of the player, piece 0 shows its first topic once.
function speak(ctx: ActorContext, actor: DerridaActor): void {
  if (!chasePlayer(ctx, actor, 0x3c, 4) || actor.derridaSpoke) return;
  actor.derridaSpoke = 1;
  const profile = actor.surProfile;
  // Back in the room after a conversation, the record state has dropped the profile (h0:6de2) and h0:8488 follows
  // the null +be pointer: the text pointer comes from Amiga low memory (address 0x0c, the address-error vector) and
  // the message is whatever bytes the ROM has there. That text is not the game's, so nothing is shown.
  if (!profile) return;
  const start = profile.topics[0]!.textOffset - 1;
  const end = profile.textPool.indexOf("\0", start);
  showMessage(ctx, profile.textPool.slice(start, end === -1 ? undefined : end), 4, 1);
}

export const derridaClass: ActorClass<DerridaActor> = {
  id: 27,
  name: "derrida",
  createState: () => ({
    derridaPiece: 0, lastPlayerX: 0, lastPlayerY: 0, surHunting: 0, derridaTwitchTime: 0, surTargetId: 0,
    derridaTwitchAnimationTime: 0, derridaTwitching: 0, derridaSpoke: 0, surSitting: 0, surStanding: 0, surHealth: 0,
    surCanWander: 0, surReaction: 0, surBaseAnimation: 0, surProfile: null, surGrabType: 0, surProtected: 0,
    surRecordState: 0, surProfileFlags: 0, surAlerted: 0, surCarrying: 0, surAttackTime: 0, surTopic: 0, surAsked: 0,
  }),
  // h0:84ea: front shape set 4, piece index in byte 3, fixed skin/clothes quads at scheme 16.
  init(ctx, actor, spec) {
    const argument = spec.params.unknownArgument;
    if (argument === undefined) throw new Error("AGA Derrida requires its piece byte");
    ctx.state.frontShapeSet = 4; // h0:6de(4)
    if (!argument) bindProfile(ctx, actor, argument);
    actor.surHunting = 1;
    actor.derridaPiece = argument;
    applySurvivorPalette(ctx, 5, 0, 16);
  },
  // h0:8428: every 0xa00 ticks a 1-in-5 twitch; piece 0 also checks the player.
  update(ctx, actor) {
    actor.derridaTwitchTime = s16(actor.derridaTwitchTime - ctx.state.frameTicks);
    if (actor.derridaTwitchTime > 0) return;
    actor.derridaTwitchTime = s16(actor.derridaTwitchTime + 0xa00);
    if (!ctx.random.next(5)) actor.derridaTwitching = 1;
    if (!actor.derridaPiece) speak(ctx, actor);
  },
  // h0:849a/h0:84b6: a collision makes the piece twitch and blocks the mover.
  message(ctx, actor, message) {
    if (u8(message.type)) return 1;
    actor.derridaTwitching = 1;
    ctx.emit({ type: "sound", id: 16 });
    return 0xffff;
  },
  // h0:84d0 -> h0:119d6: g:3f81 is applied twice, to the animation index and then to its value.
  post(ctx, actor) {
    let step = 0;
    if (actor.derridaTwitching) {
      const twitch = animate(ctx, actor, TWITCH, 0x384, "derridaTwitchAnimationTime");
      step = twitch.frame;
      if (twitch.wrapped) actor.derridaTwitching = 0;
    }
    actor.spritePaths[0] = [TWITCH[step]!, actor.derridaPiece];
    actor.spriteOffsetX[0] = -4;
  },
  // h0:84d6: one part, into the front buffer.
  draw(ctx, actor, gfx) {
    drawPart(ctx, actor, gfx, 0);
  },
  // h0:8528: byte 3 = piece.
  save(_ctx, actor) {
    return saveRecord(actor, actor.derridaPiece);
  },
};
