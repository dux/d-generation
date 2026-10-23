import type { Game } from "../core/game.ts";
import { COLUMNS, KEYS, ROWS } from "../ui/terminal/input.ts";

// The CD32 build types text only through its on-screen keyboard (h0:b9d6 -> h0:14d1a), steered with the pad.
// For a keyboard player the host plays the pad: each typed character moves the keyboard cursor to that key, one
// step per poll of the game, then holds RED until the game has read it. The game only ever sees pad input.

const GAME_CONTROLLER = 0x10000000;
const RIGHT = 1, LEFT = 2, DOWN = 4, UP = 8, RED = 1 << 22;
const PRESS_TICKS = 6; // the keyboard polls the pad every 5 vblanks (Delay(5) at h0:14ed8)

export class PadTypist {
  private readonly queue: number[] = [];
  private pressed = 0;

  // Characters the on-screen keyboard has (Enter is "\r", backspace "\b"); others are ignored.
  type(char: number): void {
    if (KEYS.includes(String.fromCharCode(char))) this.queue.push(char);
  }

  // The ReadJoyPort(1) word for this vblank, or null when not typing.
  joy(game: Game): number | null {
    if (!game.state.input.textEntry) {
      this.queue.length = 0;
      this.pressed = 0;
      return null;
    }
    const char = this.queue[0];
    if (char === undefined) return null;
    if (this.pressed) {
      if (++this.pressed <= PRESS_TICKS) return GAME_CONTROLLER | RED;
      this.pressed = 0;
      this.queue.shift();
      return GAME_CONTROLLER;
    }
    const target = KEYS.indexOf(String.fromCharCode(char));
    const row = Math.floor(target / COLUMNS), column = target % COLUMNS;
    const { keyRow, keyColumn } = game.state.talk;
    if (keyRow !== row) {
      // Up and down wrap around the six rows; take the shorter way.
      return GAME_CONTROLLER | ((row - keyRow + ROWS) % ROWS <= ROWS / 2 ? DOWN : UP);
    }
    // Left and right wrap into the next row at the ends, so stay inside the row.
    if (keyColumn !== column) return GAME_CONTROLLER | (column > keyColumn ? RIGHT : LEFT);
    this.pressed = 1;
    return GAME_CONTROLLER | RED;
  }
}
