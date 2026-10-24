import type { Game } from "../core/game.ts";
import { ATTRACT_DEMOS } from "../core/attract.ts";
import {
  applyPalette, blitDelta, clearScreen, clearView, copyRect, drawText, fadeIn, fadeInPrepare, fadeOut, fillRect,
  loadDeltaSet, loadPalette, loadVim, restoreView, setColor15White, showVim, type PaletteTable,
} from "./screen.ts";

// g:5ac, g:5d6, g:6d2: the copyright card and the two story pages.
const COPYRIGHT = "Copyright 1993 Robert Cook and Mindscape";
export const STORY_1 = "You had been at your apartment in Paris when the call came in. Hours later, after flying the length of Asia, over the Himalayas and the radioactive deserts of Kazakhstan, you arrive in Singapore carrying an urgent package for the scientist Derrida...";
export const STORY_2 = "Genoq brought in Derrida to head the special operations lab, the supersecret research wing charged with designing the next generation biomedicines.  The message you received from Derrida was panicked and desperate.  Perhaps there had been some accident, and the labs are now contaminated with a lethal virus or even worse...";
// g:873a / g:8734: right edge and height of the view, the extent of the full-screen h0:3164 copies.
const VIEW_RIGHT = 319;
const VIEW_HEIGHT = 200;
// g:873c: the bottom clip the title draws with.
const TITLE_CLIP = 199;
const STORY_COLOR = 0x91;

// h0:28ea (DOS 0:38b0) title(): the first run plays the story (g:53e clear), later runs the attract cards; both end
// in the demo setup of h0:2e1c. A key or button on any card starts a new game through h0:2ffe.
export function title(game: Game): void {
  const state = game.state, s = state.screen;
  s.bombed = null;
  state.visited.fill(false);
  state.roomResilience.fill(0);
  state.savedClip = state.clipBottom;
  setClip(game, TITLE_CLIP);
  clearScreen(s);
  restoreView(s);
  clearView(s);
  s.mode = "screen";
  let skip = state.storyShown ? (state.attractIndex === 0 ? credits(game) : -1) : story(game);
  if (skip < 0 && state.attractIndex === 1) skip = ukCards(game);
  if (skip >= 0) startGame(game, skip);
  else setupDemo(game);
}

// g:8c68 is both the room clip and the bottom row of the title's copies and plots.
function setClip(game: Game, clip: number): void {
  game.state.clipBottom = clip;
  game.state.screen.clip = clip;
}

// h0:3170 + h0:31ac: fade the table to black and wait for it.
function fade(game: Game, palette: PaletteTable): void {
  game.vblank(fadeOut(game.state.screen, palette));
}

// A card wait (h0:2ef0 / h0:304c with input): returns the h0:2ffe mode on a skip, else -1.
function hold(game: Game, ticks: number, skipMode: number): number {
  return game.wait(ticks, true) ? skipMode : -1;
}

// h0:2938..2ce2: story path. Returns the h0:2ffe mode of a skip, or -1 when it ran to the end.
function story(game: Game): number {
  const state = game.state, s = state.screen;
  let skip: number;
  game.loadMusic("dgen"); // h0:3158 -> h0:c566
  state.storyShown = 1;
  loadVim(s, "genoq", "de58");
  // h0:294c copies the genoq palette (g:e0b4) to g:ecba (read by no title path); h0:295e drains queued keys.
  while (game.pendingKey()) game.consumeKey();
  loadDeltaSet(s, 0x22);
  state.frontShapeSet = 0xff;
  showVim(s, "eye", 0);
  if ((skip = hold(game, 0xc8, 1)) >= 0) return skip;
  fade(game, "vim");
  game.startMusic(); // h0:77ec(g:dcf4)
  state.musicClock = game.seconds(); // h0:3104(0) -> g:d99a
  if ((skip = hold(game, 0x50, 0)) >= 0) return skip;
  clearScreen(s);
  if ((skip = hold(game, 0x1e, 0)) >= 0) return skip;
  loadPalette(s, "title.pal", "title");
  setClip(game, TITLE_CLIP);
  game.vblank(showVim(s, "Logo", 1));
  if ((skip = hold(game, 1, 0)) >= 0) return skip;
  fillRect(s, 0, 0, VIEW_RIGHT, VIEW_HEIGHT);
  if ((skip = hold(game, 0x15e, 1)) >= 0) return skip;
  fade(game, "vim");
  clearScreen(s);
  blitDelta(s, 0x22, 1, 0, 0);
  if ((skip = hold(game, 0x28, 0)) >= 0) return skip;
  fillRect(s, 0, 0x50, VIEW_RIGHT, 0x1e);
  fadeInPrepare(s, "title");
  game.vblank(fadeIn(s));
  if ((skip = hold(game, 0x15e, 2)) >= 0) return skip;
  fade(game, "title");
  clearScreen(s);
  blitDelta(s, 0x22, 2, 0, 0);
  if ((skip = hold(game, 0x28, 0)) >= 0) return skip;
  fillRect(s, 0, 0x28, VIEW_RIGHT, 0x5a);
  s.wideLines = 1;
  drawText(s, 0x28, 0xb4, COPYRIGHT);
  fillRect(s, 0, 0xb4, VIEW_RIGHT, 9);
  fadeInPrepare(s, "title");
  game.vblank(fadeIn(s));
  setColor15White(s);
  if ((skip = hold(game, 0x190, 2)) >= 0) return skip;
  fade(game, "title");
  copyRect(s, 0, 0, VIEW_RIGHT, VIEW_HEIGHT);
  restoreView(s);
  applyPalette(s, "title");
  if (titleAnimation(game)) return 2;
  blitDelta(s, 0x22, 3, 0x27, 0x96, "de50");
  if ((skip = hold(game, 0x190, 2)) >= 0) return skip;
  fade(game, "title");
  clearScreen(s);
  applyPalette(s, "title");
  setColor15White(s);
  s.textColor = state.textColor = STORY_COLOR;
  drawText(s, 0x0a, 0x41, STORY_1);
  if ((skip = hold(game, 0x32, 0)) >= 0) return skip;
  fillRect(s, 0, 0x28, VIEW_RIGHT, 0x64);
  if ((skip = hold(game, 0x3e8, 0)) >= 0) return skip;
  clearScreen(s);
  drawText(s, 0x0a, 0x37, STORY_2);
  s.wideLines = 0;
  state.textCursor = 0;
  if ((skip = hold(game, 0x32, 0)) >= 0) return skip;
  fillRect(s, 0, 0x28, VIEW_RIGHT, 0x64);
  if ((skip = hold(game, 0x4b0, 0)) >= 0) return skip;
  clearScreen(s);
  // h0:2ef0(0xb, 0x64): one-count waits (keys ignored) until the module has played out.
  while (game.musicPlaying()) game.wait(1, true);
  game.loadEffects(); // h0:311c -> h0:c6f8
  return -1;
}

// h0:b6c titleAnimation(): wait for 33 seconds of the music clock, then run partial main-loop passes over the
// sled record 87 80 80 05 (h0:14ca(5)) until it clears g:6583. A button or key at any point returns true.
function titleAnimation(game: Game): boolean {
  const state = game.state;
  do {
    if (game.wait(1, true)) return true;
  } while (game.seconds() < state.musicClock + 0x21);
  state.movementScale = 0;
  game.resetRoomObjects(); // h0:1730
  setClip(game, state.clipBottom);
  state.titleAnimation = 1;
  game.spawnSled(5);
  while (state.titleAnimation) {
    if (game.readButton(0) === 2 || game.readButton(1) === 2 || game.pendingKey()) {
      state.screen.objectsVisible = false;
      return true;
    }
    game.titlePass();
    copyRect(state.screen, 0x78, 0x5a, 10, 5);
  }
  state.screen.objectsVisible = false;
  return false;
}

// h0:2ce4..2d32: the credits card (attract index 0).
function credits(game: Game): number {
  const s = game.state.screen;
  let skip: number;
  clearScreen(s);
  showVim(s, "cred", 0);
  if ((skip = hold(game, 0x514, 1)) >= 0) return skip;
  fade(game, "vim");
  clearScreen(s);
  return hold(game, 0x32, 0);
}

const UK_CARDS = ["uk1", "uk2", "uk3"] as const;

// h0:2d36..2e18: the three UK cards (attract index 1); h0:ad8a between them is the same clear as h0:3182.
function ukCards(game: Game): number {
  const s = game.state.screen;
  let skip: number;
  clearScreen(s);
  for (const [i, card] of UK_CARDS.entries()) {
    game.vblank(showVim(s, card, i === 0 ? 0 : 1));
    if ((skip = hold(game, 0x258, 1)) >= 0) return skip;
    fade(game, "vim");
    clearScreen(s);
    if ((skip = hold(game, 0x32, 0)) >= 0) return skip;
  }
  return -1;
}

// Browser (GameOptions.newGameCards): the UK cards once per game, between the second and third room, with the
// attract timing; a key or button moves on to the next card. The black gap between cards ignores input, so one
// press skips one card. The room change that follows redraws the view.
export function storyCards(game: Game): void {
  const s = game.state.screen;
  s.mode = "screen";
  clearScreen(s);
  while (game.pendingKey()) game.consumeKey(); // presses made while walking out do not skip the first card
  for (const [i, card] of UK_CARDS.entries()) {
    game.vblank(showVim(s, card, i === 0 ? 0 : 1));
    game.wait(0x258, true);
    fade(game, "vim");
    clearScreen(s);
    game.wait(0x32, false);
  }
  s.mode = "room";
}

// h0:2e1c..2ec6: the next demo record of g:586 becomes the playback room.
function setupDemo(game: Game): void {
  const state = game.state, s = state.screen;
  const demo = ATTRACT_DEMOS[state.attractIndex]!;
  state.demoPending = 1;
  state.demoPlayback = 0;
  game.loadDemo(demo.sequence); // h0:314c -> h0:c8ce
  state.sceneIndex = demo.scene - 1;
  game.setGridPosition(demo.scene);
  state.lives = 5;
  state.rescuedCount = 0;
  state.spawnX = demo.x;
  state.spawnY = demo.y;
  state.spawnDirection = demo.direction;
  state.roomChange = 1;
  state.attractIndex = (state.attractIndex + 1) % ATTRACT_DEMOS.length;
  restoreView(s);
  fillRect(s, 0, 0, VIEW_RIGHT, VIEW_HEIGHT);
  applyPalette(s, "dgen");
  game.resetPalette();
  setClip(game, state.savedClip);
  s.mode = "room";
}

// h0:2ffe (DOS 0:3a1c) startGame(mode): a skipped card fades (1: the vim palette, 2: title.pal), then a new game
// starts with the effects loaded.
export function startGame(game: Game, mode: number): void {
  const state = game.state, s = state.screen;
  if (mode) fade(game, mode === 1 ? "vim" : "title");
  state.textCursor = 0;
  s.wideLines = 0;
  state.menuRequested = 0;
  game.newGame();
  restoreView(s);
  game.stopMusic(); // h0:3116 -> h0:16738
  applyPalette(s, "dgen");
  game.resetPalette();
  game.loadEffects();
  setClip(game, state.savedClip);
  s.mode = "room";
}
