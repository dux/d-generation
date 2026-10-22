import type { Dialogue, Reply } from "../../../formats/level.ts";
import type { Game } from "../../core/game.ts";
import { sightActor } from "../../core/geometry.ts";
import { s8, s16, u8, u16 } from "../../core/int.ts";
import { clearMessage, showMessage } from "../../core/messages.ts";
import type { Actor } from "../../core/model.ts";
import { heldDirection } from "../../core/input.ts";
import { nag } from "../../actors/sur.ts";
import { drawLine, finishDelay, messageBox, restoreDisplay, startDelay } from "./box.ts";

// SUR (class 9) and the class-27 Derrida piece share the conversation fields of the SUR layout.
export interface Talker extends Actor {
  surAlerted: number; // +a2
  surHunting: number; // +a1
  surCarrying: number; // +c2
  surAttackTime: number; // +c8
  surProfile: Dialogue | null; // +be
  surRecordState: number; // +ce: conversation flag bits
  surProfileFlags: number; // +cf: questions the survivor still answers
  surTopic: number; // +cc
  surAsked: number; // +d0
}

// g:1322: the four horsemen, picked by g:d978 when the title last ran (also the scene-82 entrance codes).
export const HORSEMEN = ["war", "death", "pestilence", "famine"] as const;
// g:3f94 (= g:3f64 + 0x30, which the option tests index by the raw digit character): flag bit per digit.
const FLAG_BITS = [2, 4, 8, 16, 32, 64, 128, 0, 0, 1, 1, 2, 0, 1, 4, 9];
const NOT_IN_ROOM = "`You must be in the same room to talk."; // g:4374
const NO_ONE = "`There is no one to speak with."; // g:439c
const NOT_SAFE = "We can talk as soon as I'm safe, okay?"; // g:431c
const MORE = "..."; // g:43bc
// g:4318..g:431b: selected row text colour and fill, normal row fill and text colour.
const SELECTED_COLOR = 52, SELECTED_TEXT = 161, ROW_COLOR = 32, ROW_TEXT = 128;
const MENU_X = 3, MENU_WIDTH = 0xe6, ROW_HEIGHT = 13;

function flagBit(code: number): number {
  const bit = FLAG_BITS[s8(code - 0x30)];
  if (bit === undefined) throw new Error(`AGA conversation flag code ${String.fromCharCode(code)} outside g:3f94`);
  return bit;
}

// The relocated profile (h0:11b88) points at pool text by one-based disk offsets; it stops at the first empty
// topic and leaves zero response offsets unset, so those pointers would be stale.
function poolText(profile: Dialogue, offset: number, what: string): string {
  if (!offset) throw new Error(`AGA ${what} has no relocated text pointer (h0:11b88 leaves it stale)`);
  const end = profile.textPool.indexOf("\0", offset - 1);
  return profile.textPool.slice(offset - 1, end === -1 ? undefined : end);
}

function topicText(profile: Dialogue, topic: number): string {
  const first = profile.topics.findIndex(entry => !entry.textOffset);
  if (topic < 0 || (first !== -1 && topic >= first)) throw new Error(`AGA conversation topic ${topic} was not relocated (h0:11b88)`);
  return poolText(profile, profile.topics[topic]!.textOffset, `topic ${topic}`);
}

// Topic +10 + slot * 4: the reply record of an option, null for an unset slot.
function option(profile: Dialogue, topic: number, slot: number): Reply | null {
  const index = profile.topics[topic]?.replies[slot];
  if (index === undefined) throw new Error(`AGA conversation option ${topic}/${slot} outside the profile`);
  if (!index) return null;
  const reply = profile.replies[index - 1];
  if (!reply) throw new Error(`AGA conversation reply ${index} outside the profile`);
  return reply;
}

function talkerProfile(game: Game): { talker: Talker; profile: Dialogue } {
  const talker = game.state.talk.talker as Talker | null;
  const profile = talker?.surProfile;
  if (!talker || !profile) throw new Error("AGA conversation without a talker profile (g:de08)");
  return { talker, profile };
}

// h0:13862 findTalker(range) with h0:230e/h0:1388e: the last SUR or profiled class-27 object in slot order that
// sees the player within `range`; one with a profile ends the search. g:de0c tells whether any was in the room.
function findTalker(game: Game, range: number): Talker | null {
  const state = game.state, talk = state.talk;
  talk.present = 0;
  let found: Talker | null = null;
  state.currentObject = state.player;
  if (!state.player) return null;
  for (const actor of game.objects.slots) {
    if (!actor || actor.removed) continue;
    const candidate = actor as Talker;
    if (actor.classId !== 9 && !(actor.classId === 27 && candidate.surProfile)) continue;
    talk.present = 1;
    if (sightActor(game.context, actor, state.player, range, 4) === -1) continue;
    found = candidate;
    if (candidate.surProfile) break;
  }
  return found;
}

// h0:123e4 buildMenu(topic): the option slots of a topic whose "#d" / "~d" conditions pass against the flag bits
// (+ce): "#d" hides the option while the bit is set, "~d" while it is clear.
function buildMenu(game: Game, topic: number): number {
  const talk = game.state.talk, { talker, profile } = talkerProfile(game);
  talk.count = 0;
  for (let slot = 0; slot < 5; slot++) {
    const reply = option(profile, topic, slot);
    if (!reply) continue;
    const text = poolText(profile, reply.textOffset, `option ${topic}/${slot}`);
    let hidden = false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 0x23) { if (flagBit(text.charCodeAt(++i)) & talker.surRecordState) hidden = true; }
      else if (code === 0x7e) { if (!(flagBit(text.charCodeAt(++i)) & talker.surRecordState)) hidden = true; }
    }
    if (!hidden) talk.rows[talk.count++] = slot;
  }
  talk.rows[talk.count] = 0xff;
  return talk.count;
}

// g:d92e[index]; index -1 reads the depth word g:d92c in front of the stack.
function stackAt(game: Game, index: number): number {
  const talk = game.state.talk;
  if (index === -1) return s16(talk.depth);
  const value = talk.stack[index];
  if (value === undefined) throw new Error(`AGA conversation stack read g:d92e[${index}]`);
  return value;
}

// h0:125f4 popMenus(): drop topics with fewer than two visible options; an empty stack shows topic 1.
function popMenus(game: Game): void {
  const talk = game.state.talk, { talker } = talkerProfile(game);
  while (s16(talk.depth) >= 0) {
    if (buildMenu(game, stackAt(game, s16(talk.depth) - 1)) >= 2) break;
    talk.depth = u16(talk.depth - 1);
    // At depth -1 this reads g:d92a, which the negative-depth reset below overwrites at once.
    if (s16(talk.depth) >= 0) talker.surTopic = u16(stackAt(game, s16(talk.depth) - 1));
  }
  if (s16(talk.depth) < 0) talker.surTopic = talk.depth = 0;
  if (!talk.count && !talker.surTopic) {
    talker.surTopic = 1;
    buildMenu(game, 1);
  }
}

// h0:12660 responseCount(topic, slot): leading non-zero next topics of an option.
function responseCount(game: Game, topic: number, slot: number): number {
  const reply = option(talkerProfile(game).profile, topic, slot);
  if (!reply) throw new Error(`AGA conversation option ${topic}/${slot} is unset`);
  let count = 0;
  while (count < 6 && reply.nextTopics[count]) count++;
  return count;
}

// h0:13d84 drawRow(topic, row, x, top, width, fill, column, color): an h0:f318 bar 13 rows apart, the option
// text after its condition prefixes, then "..." when it has several answers and none is picked, or the picked
// answer 5 pixels further on. The concatenated "@" codes stand for that 5-pixel step in one h0:dcb4 line.
function drawRow(game: Game, topic: number, row: number, top: number, fill: number, column: number, color: number): void {
  const state = game.state, talk = state.talk, { profile } = talkerProfile(game);
  const y = s16(top + row * ROW_HEIGHT), slot = talk.rows[row]!;
  const reply = option(profile, topic, slot);
  if (!reply) throw new Error(`AGA conversation row ${row} has no option`);
  talk.display.push({ op: "row", x: MENU_X, y, width: MENU_WIDTH, color: fill });
  let text = poolText(profile, reply.textOffset, `option ${topic}/${slot}`);
  while (text[0] === "~" || text[0] === "#") text = text.slice(2);
  state.textColor = color;
  if (s8(column) === -1) {
    if (responseCount(game, topic, slot) > 1) text += MORE;
  } else text += `@@@@@${poolText(profile, reply.responses[column]!, `answer ${topic}/${slot}/${column}`)}`;
  drawLine(game, MENU_X + 8, y + 2, text);
}

// h0:138d2 (DOS 0:a9bc) menuSelect(topic): the visible options as rows above the bottom; up/down pick a row,
// left/right one of its answers, Enter takes the answer's next topic, Esc returns 0. The original polls with no
// timer between inputs; the harness ticks once per pass at h0:139f6.
function menuSelect(game: Game, topic: number): number {
  const state = game.state, talk = state.talk, input = state.input;
  const count = talk.count;
  const top = u16(0xc7 - count * ROW_HEIGHT);
  let row = 0, previous = 0, redraw = 0, column = -1, result = 0;
  const savedClip = state.clipBottom;
  state.clipBottom = 199;
  const frameTime = game.pollTimer(state.frameTimer);
  for (let r = 0; r < count; r++) drawRow(game, topic, r, top & 0xff, ROW_COLOR, -1, ROW_TEXT); // h0:13d00
  drawRow(game, topic, 0, top, SELECTED_COLOR, -1, SELECTED_TEXT);
  let responses = responseCount(game, topic, talk.rows[0]!);
  state.waitSteps = 0;
  while (game.readButton(0) < 3 || game.readButton(1) < 3) game.waitStep();
  while (game.pendingKey()) game.consumeKey();
  input.textEntry = 1;
  for (;;) {
    game.vblank();
    if (state.demoRecording || state.demoPlayback) throw new Error("AGA conversation menu during demo playback (h0:13a02) not ported");
    // h0:e48c; without demo playback h0:f292 reports magnitude 0, so only held direction keys move the cursor.
    const direction = heldDirection(input);
    if (direction !== -1) startDelay(game, 10);
    const key = game.pendingKey() ? u8(game.consumeKey()) : 0;
    if (key === 0x1b || game.readButton(0) === 2) break;
    if (key === 0x0d || game.readButton(1) === 2) {
      if (column === -1) {
        if (responses > 1) break;
        column = 0;
      }
      const reply = option(talkerProfile(game).profile, topic, talk.rows[row]!)!;
      result = reply.nextTopics[column]!;
      game.sound(0x13);
      break;
    }
    if (direction === -1) continue;
    if (direction === 2 && responses > 1 && column < responses - 1) { column++; redraw = 1; }
    if (direction === 6 && responses > 1 && column > 0) { column--; redraw = 1; }
    if (direction === 0 && row) { row--; game.sound(0x18); }
    if (direction === 4 && row !== count - 1) { row++; game.sound(0x18); }
    if (redraw) {
      game.sound(0x18);
      drawRow(game, topic, row, top, SELECTED_COLOR, column, SELECTED_TEXT);
      finishDelay(game);
      redraw = 0;
      continue;
    }
    if (row === previous) continue;
    responses = responseCount(game, topic, talk.rows[row]!);
    column = -1;
    drawRow(game, topic, previous, top, ROW_COLOR, -1, ROW_TEXT);
    drawRow(game, topic, row, top, SELECTED_COLOR, column, SELECTED_TEXT);
    previous = row;
    finishDelay(game);
  }
  state.waitSteps = 0;
  while (game.readButton(0) === 1 || game.readButton(1) === 1) game.waitStep();
  input.textEntry = 0;
  state.clipBottom = savedClip;
  restoreDisplay(game); // h0:e1a8(top, 0)
  game.timers.set(state.frameTimer, frameTime);
  state.forceRedraw = 1;
  return result;
}

// h0:126f4: in scene 35 a survivor still on the far side of the room's diagonal is not safe yet.
function unsafe(game: Game): boolean {
  if (game.state.sceneIndex !== 0x22) return false;
  const talker = game.state.talk.talker!;
  return ((u16(((talker.x >>> 8) - (talker.y >>> 8) + 0x100) << 7) >>> 8) > 0x66);
}

// h0:124b6 itemCodes(text): "_kd" adds digit d to item count k; returns the index after the last code.
function itemCodes(game: Game, text: string): number {
  const state = game.state;
  let skip = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0x5f) continue;
    const counter = s8(text.charCodeAt(++i) - 0x30), amount = text.charCodeAt(++i) - 0x30;
    skip = i + 1;
    if (counter === 0) state.portableLaserCount = u8(state.portableLaserCount + amount);
    else if (counter === 1) state.slowMotionCount = u8(state.slowMotionCount + amount);
    else if (counter === 2) state.shieldCount = u8(state.shieldCount + amount);
    else if (counter === 3) state.carriedBombs = u8(state.carriedBombs + amount);
  }
  return skip;
}

// h0:12530 flagCodes(text): "~d" sets and "#d" clears a flag bit, "&d" spends d more questions (at least 1
// stays); returns the index after the last code.
function flagCodes(talker: Talker, text: string): number {
  let skip = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x7e) talker.surRecordState = u8(talker.surRecordState | flagBit(text.charCodeAt(++i)));
    else if (code === 0x23) talker.surRecordState = u8(talker.surRecordState & ~flagBit(text.charCodeAt(++i)));
    else if (code === 0x26) {
      const left = s8(talker.surProfileFlags - (text.charCodeAt(++i) - 0x30));
      talker.surProfileFlags = u8(left < 1 ? 1 : left);
    } else continue;
    skip = i + 1;
  }
  return skip;
}

// h0:137c0 showReply(text): "^d" switches the box style; each part is a timed box. Returns 0 when one was
// cancelled with Esc.
function showReply(game: Game, text: string): number {
  let style = 1;
  if (text[0] === "^") {
    style = text.charCodeAt(1) - 0x30;
    text = text.slice(2);
  }
  for (;;) {
    const next = text.indexOf("^"); // h0:13830
    const part = next === -1 ? text : text.slice(0, next);
    if (!messageBox(game, part, style, 0, 1, 1)) return 0;
    if (next === -1) return 1;
    style = text.charCodeAt(next + 1) - 0x30;
    text = text.slice(next + 2);
  }
}

// h0:135ac (DOS 0:a3ee) talk(): one menu of the conversation with the survivor in sight; 1 while it goes on.
// Key 0x0d calls it until it returns 0 (h0:31c0 via h0:36f4).
export function talk(game: Game): number {
  const state = game.state, talk = state.talk, ctx = game.context;
  if (!state.player) return 0;
  const talker = findTalker(game, 0x5a);
  talk.talker = talker;
  if (!talker) {
    showMessage(ctx, talk.present ? NOT_IN_ROOM : NO_ONE, 3, 2); // h0:b7aa / h0:14474
    return 0;
  }
  if (state.sceneIndex !== 0x84 && (talker.surAlerted || (!talker.surHunting && !talker.surCarrying))) return 0;
  if (!talker.surProfile || !talker.surProfileFlags) {
    nag(ctx, talker); // h0:14450
    return 0;
  }
  clearMessage(ctx); // h0:b788
  buildMenu(game, talker.surTopic);
  if (!talk.count) {
    if (!talker.surTopic) return 0;
    talk.depth = u16(talk.depth - 1);
    // At depth -1 this reads g:d92a; popMenus then resets topic and depth to 0 before anything uses it.
    if (s16(talk.depth) >= 0) talker.surTopic = u16(stackAt(game, s16(talk.depth) - 1));
    popMenus(game);
    if (!talk.count) {
      game.wait(0x14, false); // h0:14456
      nag(ctx, talker);
      return 0;
    }
  }
  const choice = menuSelect(game, talker.surTopic);
  if (unsafe(game)) {
    messageBox(game, NOT_SAFE, 1, 0, 1, 1);
    talker.surTopic = 0;
    return 0;
  }
  if (!choice) return 0;
  game.wait(0x1e, false);
  talker.surTopic = choice;
  const depth = s16(talk.depth);
  if (depth < 0 || depth >= talk.stack.length) throw new Error(`AGA conversation stack push at depth ${depth} (g:d92e)`);
  talk.stack[depth] = choice;
  talk.depth = u16(depth + 1);
  if (state.sceneIndex === 0x53 && talker.surTopic === 2) {
    const horseman = HORSEMEN[s8(state.attractVariant)];
    if (!horseman) throw new Error(`AGA g:1322 has no horseman ${s8(state.attractVariant)}`);
    messageBox(game, `I am John of Maryland.  I am the bringer of ${horseman}.`, 1, 0, 1, 1); // g:4344
    return 1;
  }
  const { profile } = talkerProfile(game);
  const text = topicText(profile, choice);
  const skip = Math.max(itemCodes(game, text), flagCodes(talker, text));
  talker.surProfileFlags = u8(talker.surProfileFlags - 1);
  talker.surAsked = (talker.surAsked | (choice < 32 ? 1 << choice : 0)) >>> 0;
  return showReply(game, text.slice(skip));
}
