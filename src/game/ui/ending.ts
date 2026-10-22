import type { Game } from "../core/game.ts";
import { applyPalette, blitDelta, clearScreen, clearView, drawText, fillRect, loadDeltaSet, loadPalette, setColor15White } from "./screen.ts";
import { title } from "./title.ts";

// g:bfe, g:cf8, g:d7e: the escape ending (id 0) over three pages.
const ESCAPED = [
  "You successfully escaped from the building and notified the Singapore authorities in time to shoot down the jet sent to destroy the building.  The workers whom you helped to safety have been rescued from the building and returned to their families.",
  "The international community has recognized you for your heroism, and the families of the survivors give you their undying gratitude.",
  "Unfortunately, you are now unemployed.",
] as const;
// g:da6, g:f42, g:10ca, g:11e2: endings 1 to 4, one page each, with their y (jump table at h0:757a).
const ENDINGS: readonly (readonly [number, string])[] = [
  [0x14, "27 June 2021                International Network News\n\nSingapore.  A single survivor of yesterday's Genoq Biomedical Tower explosion claims that Genoq has been conducting illegal biological warfare experiments...\n\n...The survivor, a courier for Genoq Corporation, states that the attack on the building did not come from a corporate rival, but from Genoq itself in a desperate attempt to cover up the debacle."],
  [0x1e, "27 June 2021                International Network News\n\nSingapore.  A massive explosion rocked the entire downtown area last night as the Genoq Biomedical Tower exploded in a huge fireball.\n\n...A Genoq spokesperson stated that the explosion was not an accident, but an attack by one of Genoq's rivals, possibly another genetics multinational...\n\nA search of the rubble revealed no survivors."],
  [0x32, "The Genoq jet attacked the building, killing you and the Genoq workers, and successfully wiping out any evidence of biological weapons.  D/Generation escaped before the attack, and is now free in the real world.  It is impossible to say where it will show up and in what form..."],
  [0x32, "D/Generation reached the only jet pack before you, and escaped the building before the air attack.  You and the Genoq workers were destroyed in the blast."],
];
const ENDING_COLOR = 7; // g:1e8a

// h0:7542 (DOS 0:3d4c) ending(id): text pages on a cleared screen, a key, then a fresh game state and the title.
// Ids of 5 and above show no text.
export function ending(game: Game, id: number): void {
  const state = game.state, s = state.screen;
  clearScreen(s);
  s.bombed = null;
  s.mode = "screen";
  state.endingAlt = 0;
  applyPalette(s, "base");
  game.resetPalette();
  setColor15White(s);
  s.textColor = state.textColor = ENDING_COLOR;
  if (id === 0) {
    drawText(s, 5, 0x3c, ESCAPED[0]);
    game.loadMusic("dgen2"); // h0:c63c
    game.startMusic(); // h0:77ec(g:dcf4)
    game.wait(0x44c, true); // h0:2ef0(0, 0x44c): a key only shortens the page
    clearScreen(s);
    drawText(s, 5, 0x46, ESCAPED[1]);
    game.wait(0x258, true);
    clearScreen(s);
    drawText(s, 5, 0x50, ESCAPED[2]);
  } else if (id < 5) {
    const [y, text] = ENDINGS[id - 1]!;
    drawText(s, 5, y, text);
  }
  game.waitKey(0);
  state.titleRequested = 1;
  state.attractIndex = 0;
  state.storyShown = 0;
  game.sound(0);
  game.loadObjectBank(1); // h0:7804(1) -> h0:1238c
  game.resetGame();
  title(game);
}

// h0:1dd2 bombed(): the explosion picture (entry g:4b8[0] of the loaded delta set, which is 0x3d: every caller is
// in scene 103, whose h0:1250 loads it) at 0x65,0x2b under bombed.pal, a 0x28 wait, then the palette flash
// scripts g:348/g:36e, the shake, the debris records of g:3a1 and a 300-count room timer.
export function bombed(game: Game): void {
  const state = game.state, s = state.screen;
  loadPalette(s, "bombed.pal", "bombed");
  loadDeltaSet(s, 0x3d);
  blitDelta(s, 0x3d, 0, 0x65, 0x2b);
  game.flashScript(0);
  game.wait(0x28, false);
  clearView(s);
  fillRect(s, 0x65, 0x2b, 0x64, 0x64);
  s.bombed = { set: 0x3d, entry: 0, x: 0x65, y: 0x2b, clip: s.clip };
  applyPalette(s, "bombed");
  game.resetPalette(); // h0:77fe(g:db0a) replaces the flash colours
  game.sound(7);
  game.startShake();
  game.spawnDebris();
  game.timers.set(state.roomTimer, 0x12c);
  game.timers.enable(state.roomTimer, 1);
  game.timers.freeze(state.roomTimer);
}
