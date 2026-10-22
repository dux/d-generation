import type { Game } from "../../core/game.ts";
import { s8, u8 } from "../../core/int.ts";
import { showMessage } from "../../core/messages.ts";
import { signalGroup } from "../../actors/art.ts";
import type { CubActor } from "../../actors/cub.ts";
import { messageBox, restoreDisplay } from "../talk/box.ts";
import { HORSEMEN } from "../talk/talk.ts";
import { inputLine } from "./input.ts";

const USER = "user name:  "; // g:17b8
const PASSCODE = "passcode:  "; // g:17cc
const ENTRANCE = "Enter today's entrance code:  "; // g:180c
const OPENED = "Door opened."; // g:17e0, g:182c
const NAME_REFUSED = "Name/Passcode not Recognized."; // g:17ee
const CODE_REFUSED = "Passcode not Recognized."; // g:183a
const EXIT_CONTROL = "EXIT CONTROL SYSTEM\n\nPasscode 'REGENERATION' has been entered.  Exit door is now open.  Please proceed to the exit chamber and strap on jet pack.\n"; // g:1854
const MAIL_1 = "\n\n26 Jun 16:05  mn00352911\nFrom:  Derrida /e0_0523 \nTo:  Monique Resvi /4_5523, Katrina Chu /4_1226\n\n\nI have been waiting for a very important package since yesterday.  The moment it is delivered, you must notify me!\n\n\njd"; // g:157a
const MAIL_2 = "\n\n26 Jun 17:13  mn00353051\nFrom:  Derrida /e0_0523 \nTo:  Monique Resvi /4_5523, Katrina Chu /4_1226 \n\n\nMonique, when the package comes, you must tell me immediately!  It cannot wait!  We are having difficulties with one of our prototypes.  I will send\tan assistant down to your desk presently.  You must remain there until he arrives.\n\nJ. Derrida"; // g:1658
const WELCOME = "\n\nWelcome to Genoq Biolabs.\n\nGenoq staff would normally be conducting tours of the facility today.  However, we regret to say that Genoq Biolabs is currently under siege from highly-lethal organic weapons.\n\nWe suggest that you head toward the nearest exit as quickly as possible.  \n\nPlease visit us again soon, and have a \nnice day.\n\nGenoq, C.I.E.\nA Delaware Corporation"; // g:1406
// h0:908a: delta set per terminal picture scene (number).
const PICTURE_SETS: ReadonlyMap<number, number> = new Map([[77, 0x1e], [29, 0x1f], [44, 0x20], [36, 0x3f]]);

// h0:110f6 lowerCase + h0:e886 matches(a, b): equal strings, or "_" in `a` where `b` has "s" or ends.
function matches(typed: string, expected: string): boolean {
  const a = typed.replace(/[A-Z]/g, c => c.toLowerCase());
  for (let i = 0; ; i = u8(i + 1)) {
    const c = a.charCodeAt(i) || 0, d = expected.charCodeAt(i) || 0;
    if (!c && !d) return true;
    if (c === 0x5f && (d === 0x73 || !d)) return true;
    if (c !== d) return false;
  }
}

// h0:9250: user name and passcode; "seth" / "ostrich" opens door group 0. An empty answer ends it silently.
function credentials(game: Game): void {
  const name = inputLine(game, USER, 0x50, 0, 8, 3);
  if (!name) return;
  const user = matches(name, "seth");
  const code = inputLine(game, PASSCODE, 0x50, 0, 8, 3);
  if (!code) return;
  if (matches(code, "ostrich") && user) {
    signalGroup(game.context, 0, 0); // h0:8784
    showMessage(game.context, OPENED, 4, 4);
  } else showMessage(game.context, NAME_REFUSED, 4, 4);
}

// h0:92f0: today's entrance code is the horseman picked when the title last ran (g:d978).
function entranceCode(game: Game): void {
  const code = inputLine(game, ENTRANCE, 0x50, 0, 8, 3);
  if (!code) return;
  const horseman = HORSEMEN[s8(game.state.attractVariant)];
  if (!horseman) throw new Error(`AGA g:1322 has no horseman ${s8(game.state.attractVariant)}`);
  if (matches(code, horseman)) {
    signalGroup(game.context, 0, 0); // h0:8784
    showMessage(game.context, OPENED, 4, 4);
  } else showMessage(game.context, CODE_REFUSED, 4, 4);
}

// h0:91c6: two full-screen e-mails after an unskippable 10-count pause each.
function mails(game: Game): void {
  game.wait(10, false);
  messageBox(game, MAIL_1, 4, -1, 0, 0);
  game.wait(10, false);
  messageBox(game, MAIL_2, 4, -1, 0, 1);
}

// h0:9200: unless the terminal is already spent (+a2), it leaves the room for good: use is disabled, the room
// is saved (h0:234a) and marked visited, and h0:7c94 carries the player to scene 58.
function escape(game: Game): void {
  const state = game.state, terminal = state.receiver as CubActor | null;
  if (!terminal) throw new Error("AGA h0:9200 without a receiving terminal (g:85b4)");
  if (terminal.cubSpecial) return;
  state.useDisabled = 1;
  game.savedRooms.set(game.room.scene, game.objects.save());
  state.visited[state.sceneIndex] = true;
  game.storyTransition(0x3a); // h0:7c94
}

// h0:908a picture(): with the display as drawing target and the clip opened, a full-screen picture (entry 0 of the
// scene's delta set, or der.vim in scene 18 under its palette), an unskippable 10-count pause and a key; scene 77
// adds the welcome text. h0:b232 then copies the view back over the display, and DGEN.PAL returns (g:47e8).
function picture(game: Game, scene: number): void {
  const state = game.state, display = state.talk.display;
  const savedClip = state.clipBottom;
  state.clipBottom = 200;
  display.push({ op: "clear" }); // h0:ad9c clears g:de5c, which points at the display
  if (scene === 18) {
    // h0:922c: g:53ee, then der.vim and its palette (no tick passes in between).
    state.talk.palette = "der.pal";
    display.push({ op: "vim", name: "der" });
  } else {
    const set = PICTURE_SETS.get(scene);
    if (set === undefined) throw new Error(`AGA terminal picture h0:908a in scene ${scene} uses the room's delta set; no such terminal is authored`);
    display.push({ op: "delta", set, entry: 0, x: 0, y: 0 });
  }
  game.wait(10, false);
  game.waitKey(1);
  if (scene === 77) {
    game.wait(10, false); // h0:91a8
    messageBox(game, WELCOME, 4, -1, 0, 0);
  }
  restoreDisplay(game);
  if (scene === 18) {
    state.talk.palette = null;
    game.resetPalette();
  }
  state.clipBottom = savedClip;
}

// h0:908a (via h0:8f70) terminal(): the player used a terminal (CUB kind 6); one handler per scene number.
export function terminal(game: Game): void {
  const scene = u8(game.state.sceneIndex) + 1;
  if (scene === 23) credentials(game);
  else if (scene === 82) entranceCode(game);
  else if (scene === 121) messageBox(game, EXIT_CONTROL, 4, 0, 0, 1); // h0:9356
  else if (scene === 8) mails(game);
  else if (scene === 69) escape(game);
  else picture(game, scene);
}
