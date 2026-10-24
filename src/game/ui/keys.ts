import type { Game } from "../core/game.ts";
import { showMessage, updateMessages, clearMessage } from "../core/messages.ts";
import { s16, u8 } from "../core/int.ts";
import { useItem } from "./talk/inventory.ts";
import { talk } from "./talk/talk.ts";
import { inputLine } from "./terminal/input.ts";
import { restoreGame, saveGame } from "./save.ts";
import { showStats } from "./stats.ts";

const PAUSED = "`|3Game Paused"; // g:886
const SAVED = "`Game Saved."; // g:84c
const SAVE_LOCKED = "`Previous Save Locked - Game Save Aborted."; // g:85a

// h0:31c0 (DOS 0:b805) handleKeys(): one pending key per main-loop pass. Returns 1 when the player quits.
export function handleKeys(game: Game): number {
  const state = game.state;
  if (!game.pendingKey()) return 0;
  let key = game.consumeKey();
  if (key === 2) key = game.padMenu(); // h0:372a -> h0:151a4
  state.playfieldKeyPending = 0;
  if (key >= 0x61 && key <= 0x7a) key -= 0x20;
  else if (key === 0x91) {
    // h0:31fc: the arming key reads three more keys; all three are consumed either way.
    state.cheatArmed = 1;
    if (game.consumeKeyBlocking() !== 0x92) state.cheatArmed = 0;
    if (game.consumeKeyBlocking() !== 0x92) state.cheatArmed = 0;
    if (game.consumeKeyBlocking() !== 0xa0) state.cheatArmed = 0;
  } else if (state.cheatArmed) cheat(game, key);
  // h0:33a2: the ordinary cases are tested one after another, not as an exclusive switch.
  if (key === 0x55) useItem(game); // h0:3706 -> h0:1400c
  if (key === 0x12) {
    state.roomChange = 1;
    game.restartCheckpoint();
    game.onLevelRestart?.();
  }
  if (key === 0x13) {
    if (state.muted) {
      state.muted = 0;
      game.sound(0x30);
    } else {
      game.sound(0);
      state.muted = 1;
      game.stopAudio(); // h0:8544
      game.sound(0); // h0:370c
    }
  } else {
    if (state.demoPlayback) {
      state.menuRequested = 1;
      return 0;
    }
    if (key === 0x9f) showMessage(game.context, saveGame(game.world, game.storage) ? SAVED : SAVE_LOCKED, 3, 2);
    else if (key === 0x93) {
      if (restoreGame(game.world, game.storage, () => game.resetGame())) {
        state.frontShapeSet = 0xff;
        state.roomChange = 1;
        state.exitReached = state.useDisabled = state.backgroundDirty = state.endingId = state.generatorOverride = 0;
        const checkpoint = game.world.state.checkpointPlayer!;
        state.bomberActive = checkpoint.floorSecurityState; // g:862c
        state.bomberMinutes = checkpoint.floorSecurityCode; // g:862d
        game.restartCheckpoint();
        state.restoredPending = 1;
      } else game.restorePanel(); // h0:3700(g:4d2, 0)
    }
  }
  if (key & 0x80) {
    if (key === 0xa5) state.keyToggle ^= 1;
    return 0;
  }
  switch (key) {
    case 0x1b:
      game.sound(0);
      showMessage(game.context, PAUSED, 1, 2);
      updateMessages(game.context, slot => game.pollTimer(slot));
      game.waitKey(0);
      clearMessage(game.context); // h0:36d0 -> h0:b788
      game.sound(0x30);
      return 0;
    case 1:
      // h0:34d4: debug life loss, refused in the generator room setup, while use is disabled and in scene 0x79.
      if (!state.roomEffect && state.generatorOverride) return 0;
      if (state.useDisabled || state.sceneIndex === 0x79) return 0;
      state.roomChange = 1;
      game.world.restorePlayerState(state);
      state.lives = u8(state.lives - 1);
      return 0;
    case 0x53:
      if (!state.useDisabled) showStats(game);
      return 0;
    case 0x16:
      game.showVersion(); // h0:36aa
      return 0;
    case 0x0a:
      // h0:36e8 -> h0:e6a2: clears the write-only flag g:db10 and returns; nothing else observable.
      return 0;
    case 0x0d:
      state.messageText = "";
      state.talking = 1;
      while (talk(game)) { /* h0:36f4 -> h0:135ac until it returns 0 */ }
      state.talking = 0;
      return 0;
    case 0x11:
      game.sound(0);
      return 1;
    default:
      state.playfieldKey = u8(key);
      state.playfieldKeyPending = 1;
      return 0;
  }
}

// h0:323a..339e: cheats while g:82c is armed; the key then continues through the ordinary cases.
function cheat(game: Game, key: number): void {
  const state = game.state, world = game.world.state;
  const entry = world.roomEntryPlayer, checkpoint = world.checkpointPlayer;
  if (key === 0x94) {
    state.generatorOverride = state.exitReached = state.roomEffect = 1;
    state.endingTime = 0x75800;
  } else if (key === 7) {
    state.ammo = u8(state.ammo + 10);
    if (entry) entry.ammo = u8(entry.ammo + 10);
    if (checkpoint) {
      checkpoint.ammo = u8(checkpoint.ammo + 10);
      checkpoint.throwableAvailable = 1;
    }
    if (entry) entry.throwableAvailable = 1;
    state.throwableAvailable = 1;
    state.portableLaserCount = state.slowMotionCount = state.shieldCount = state.carriedBombs = 9;
  } else if (key === 9) {
    state.lives = u8(state.lives + 10);
    if (entry) entry.lives = u8(entry.lives + 10);
    state.rescuedCount = u8(state.rescuedCount + 1);
  } else if (key === 0x0b) {
    state.bombsFound = 10;
    if (entry) entry.bombsFound = 10;
    if (checkpoint) checkpoint.bombsFound = 10;
  } else if (key === 0xae) warp(game);
}

// h0:3300..339e cheat 0xae: "Scene?" and "Side?" through the input line h0:b9d6 (h0:3712), each read with sscanf
// "%d" into a 16-bit int (h0:3724). A scene below 151 that the map holds (h0:3650) becomes the next room, entered
// from that side (g:8a27). A line that does not parse leaves the stack word uninitialized on the Amiga: the port
// does not warp for an unreadable scene and keeps the current side for an unreadable side.
function warp(game: Game): void {
  const scene = scanInt(inputLine(game, "Scene?  ", 0x50, 0, 8, 3)); // g:832
  const side = scanInt(inputLine(game, "Side?  ", 0x50, 0, 8, 3)); // g:840
  if (scene === null) return;
  const index = s16(scene - 1);
  if (index >= 0x96 || index < 0) return; // h0:3650 compares the word with grid bytes 0..255
  const position = game.world.gridPosition(index + 1);
  if (!position) return;
  const state = game.state, world = game.world.position;
  world.row = position.row;
  world.column = position.column;
  world.scene = index + 1;
  state.sceneIndex = index;
  if (side !== null) world.entrySlot = u8(side);
  state.roomChange = 1;
  state.spawnX = 0; // g:85da
  state.frontShapeSet = 0; // g:4b4
}

// SAS/C sscanf(text, "%d", &short): leading white space, an optional sign and decimal digits, wrapped to 16 bits.
function scanInt(text: string): number | null {
  const match = /^\s*([+-]?\d+)/.exec(text);
  return match ? s16(Number.parseInt(match[1]!, 10)) : null;
}
