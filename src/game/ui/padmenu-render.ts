import type { Screen } from "../../render/screen.ts";
import type { GameState } from "../core/model.ts";

// The CD32 pad menu picture (h0:14792: g:df34's planes at h9:3e60): assets/images/cd32-padmenu.png, taken from
// the executable by ./tools/extract-assets.ts.
export const PAD_MENU_WIDTH = 271, PAD_MENU_HEIGHT = 26;
const WIDTH = PAD_MENU_WIDTH, HEIGHT = PAD_MENU_HEIGHT;

// h0:151a4 saves the underlying display; h0:153ec/15452 invert the selected rectangle with minterm 0x50.
export function drawPadMenu(screen: Screen, state: GameState, pixels: Uint8Array): void {
  let saved: Uint8Array | null = null;
  for (const op of state.padDisplay) {
    if (op.op === "menu") {
      saved = screen.pixels.slice();
      for (let y = 0; y < HEIGHT; y++) screen.pixels.set(pixels.subarray(y * WIDTH, (y + 1) * WIDTH), (50 + y) * screen.width + 30);
    } else if (op.op === "invert") {
      for (let y = 54; y < 72; y++) for (let x = 34 + 44 * op.item; x < 77 + 44 * op.item; x++) screen.pixels[y * screen.width + x] ^= 0xff;
    } else if (saved) {
      for (let y = 50; y < 76; y++) {
        const at = y * screen.width + 30;
        screen.pixels.set(saved.subarray(at, at + WIDTH), at);
      }
      saved = null;
    }
  }
}
