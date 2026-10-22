import type { Game } from "../core/game.ts";
import { pushKey } from "../core/input.ts";

// lowlevel.library ReadJoyPort(1) bits the menu reads.
const RIGHT = 1 << 0, LEFT = 1 << 1;
const REVERSE = 1 << 18, FORWARD = 1 << 19, RED = 1 << 22;
const GAME_CONTROLLER = 0x10000000;
const ITEMS = 6;
// g:60e0 / g:60e6 (cheats armed): the key each item queues; item 5 rotates the pad directions instead.
const KEYS = [0x13, 0x9f, 0x93, 0x01, 0x12, 0x00];
const CHEAT_KEYS = [0x13, 0x9f, 0x93, 0xae, 0x12, 0x00];

// One ReadJoyPort poll of the menu's busy loops. They read the port without waiting, so on the Amiga only the
// interrupts move time on: the port counts each poll as a PAL vblank (the harness ticks at the same calls).
function poll(game: Game): number {
  game.vblank();
  return game.state.input.joy >>> 0;
}

// h0:151a4 (via h0:372a) padMenu(): the CD32 pad menu, opened by Ctrl+B or the pad's REVERSE button. The VBlank
// pad reader is held off (g:46d8) while the menu picture (BitMap g:df34, 271 x 26) covers (0x1e, 0x32) of the
// display, its old pixels saved in g:df08. Left/right move the blinking highlight over six items (g:de68), RED
// queues the item's key (h0:14ad0) or, for item 5, swaps the pad direction table (g:46d9), REVERSE leaves, and
// holding FORWARD with the pad in the 0xac0008 state arms the cheats (g:82c). Returns 0, the key h0:31c0 then
// handles.
export function padMenu(game: Game): number {
  const state = game.state, input = state.input, display = state.padDisplay;
  let lit = false; // $23(a7): the highlight is drawn
  const invert = (item: number) => display.push({ op: "invert", item }); // BltBitMap minterm 0x50
  const highlight = (item: number) => { if (!lit) { lit = true; invert(item); } }; // h0:153ec
  const unhighlight = (item: number) => { if (lit) { lit = false; invert(item); } }; // h0:15452
  const close = () => {
    display.push({ op: "restore" }); // h0:152a2: g:df08 back over the menu
    input.padBusy = 0;
  };
  input.padBusy = 1;
  display.push({ op: "menu" });
  while (poll(game) & REVERSE) { /* h0:1520c: the button that opened the menu is released first */ }
  state.padItem = 0;
  highlight(0);
  for (;;) {
    let joy: number;
    do joy = poll(game); while (((joy & 0xf0000000) >>> 0) !== GAME_CONTROLLER); // h0:15232
    const item = state.padItem;
    if (joy & RIGHT) state.padItem = item + 1 > ITEMS - 1 ? 0 : item + 1;
    if (joy & LEFT) state.padItem = state.padItem - 1 < 0 ? ITEMS - 1 : state.padItem - 1;
    if (joy & RED) {
      unhighlight(item);
      while (poll(game) & RED) { /* h0:15290 */ }
      close();
      if (item === ITEMS - 1) input.padRotated ^= 1;
      pushKey(input, (state.cheatArmed ? CHEAT_KEYS : KEYS)[item]!);
      return 0;
    }
    if (joy & REVERSE) {
      unhighlight(item);
      while (poll(game) & REVERSE) { /* h0:1532c */ }
      close();
      return 0;
    }
    if (joy & FORWARD) {
      // h0:1537e: the fresh port value decides both the cheat test and the loop.
      do {
        joy = poll(game);
        if (((joy & 0xfe000f) >>> 0) === 0xac0008) state.cheatArmed = 1;
      } while (joy & FORWARD);
    }
    if (state.padItem !== item) {
      unhighlight(item);
      highlight(state.padItem);
    }
    game.vblank(5); // h0:153ce dos.library Delay(5)
    lit = !lit; // h0:154b8 blink
    invert(state.padItem);
  }
}
