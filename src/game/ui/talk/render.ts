import { drawDelta } from "../../../formats/delta.ts";
import type { Palette } from "../../../formats/palette.ts";
import type { Screen } from "../../../render/screen.ts";
import type { Game } from "../../core/game.ts";
import type { AgaAssets } from "../../render/assets.ts";
import { drawPanel } from "../../render/game.ts";
import { Gfx } from "../../render/gfx.ts";
import { KEYBOARD_HEIGHT, KEYBOARD_WIDTH } from "../terminal/keyboard.ts";

// Pixels the conversation, inventory and terminal prompts drew into the display (state.talk.display), replayed in
// order over the rendered room. Rendering never changes game state.

const MENU_CAPS = 37; // g:dcc0
const INVENTORY = 39; // g:dcc8
const KEYBOARD_X = 0x32, KEYBOARD_Y = 0x32;

// h0:f48e -> h0:d20e: SetAPen, Move(x, y), Draw(x + length - 1, y), clipped to the bitmap; lengths are even.
function line(screen: Screen, x: number, y: number, length: number, color: number): void {
  if (y < 0 || y >= screen.height) return;
  const left = Math.max(0, x), right = Math.min(screen.width - 1, x + (length & ~1) - 1);
  for (let px = left; px <= right; px++) screen.pixels[y * screen.width + px] = color;
}

// h0:f3bc: `rows` lines one below the other.
function fill(screen: Screen, x: number, y: number, length: number, rows: number, color: number): void {
  for (let row = 0; row < rows; row++) line(screen, x, y + row, length, color);
}

function invert(screen: Screen, x: number, y: number, width: number, height: number): void {
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) screen.pixels[row * screen.width + col] = ~screen.pixels[row * screen.width + col]! & 0xff;
  }
}

export function drawTalkDisplay(screen: Screen, game: Game, assets: AgaAssets): void {
  const ops = game.state.talk.display;
  if (!ops.length) return;
  const gfx = new Gfx(screen, assets.shapes);
  let saved: Uint8Array | null = null;
  for (const op of ops) {
    switch (op.op) {
      case "panel":
        drawPanel(gfx, op.top, op.fill);
        break;
      case "wrap":
      case "text":
        if (op.wide) throw new Error("g:3b22 wide text over the play screen is not ported");
        if (op.op === "wrap") gfx.wrapText(op.text, op.x, op.y, true);
        else gfx.text(op.text, op.x, op.y);
        break;
      case "row": {
        // h0:f318: frame lines (colour 7) at the top and 13 rows lower, 12 filled rows, set 37 end caps.
        line(screen, op.x + 1, op.y, op.width - 1, 7);
        line(screen, op.x + 1, op.y + 13, op.width - 1, 7);
        fill(screen, op.x + 1, op.y + 1, op.width, 12, op.color);
        gfx.blit(gfx.frame(MENU_CAPS, [0]), op.x, op.y);
        gfx.blit(gfx.frame(MENU_CAPS, [1]), op.x + op.width - 1, op.y);
        break;
      }
      case "slot": {
        // h0:f3f0: a 20-pixel box 29 rows high, the set 39 cap left and mirrored right.
        line(screen, op.x, op.y, 20, 7);
        line(screen, op.x, op.y + 0x1c, 20, 7);
        fill(screen, op.x + 1, op.y + 1, 20, 27, op.color);
        const cap = gfx.frame(INVENTORY, [0]);
        gfx.blit(cap, op.x, op.y);
        gfx.blit(cap, op.x + 19, op.y, { mirror: true });
        break;
      }
      case "icon": {
        const frame = gfx.frame(INVENTORY, [op.item + 1]);
        gfx.blit(frame, op.x + frame.x + 1, op.y + frame.y);
        break;
      }
      case "keyboard": {
        saved = new Uint8Array(KEYBOARD_WIDTH * KEYBOARD_HEIGHT);
        for (let row = 0; row < KEYBOARD_HEIGHT; row++) {
          const at = (KEYBOARD_Y + row) * screen.width + KEYBOARD_X;
          saved.set(screen.pixels.subarray(at, at + KEYBOARD_WIDTH), row * KEYBOARD_WIDTH);
          screen.pixels.set(assets.keyboard.subarray(row * KEYBOARD_WIDTH, (row + 1) * KEYBOARD_WIDTH), at);
        }
        break;
      }
      case "unkeyboard": {
        if (!saved) throw new Error("keyboard rectangle restored before it was saved");
        for (let row = 0; row < KEYBOARD_HEIGHT; row++) {
          screen.pixels.set(saved.subarray(row * KEYBOARD_WIDTH, (row + 1) * KEYBOARD_WIDTH), (KEYBOARD_Y + row) * screen.width + KEYBOARD_X);
        }
        break;
      }
      case "invert":
        invert(screen, op.column * 16 + 0x39, op.row * 10 + 0x37, 15, 9);
        break;
      case "clear":
        screen.pixels.fill(0);
        break;
      case "vim": {
        const image = assets.vims.get(op.name);
        if (!image) throw new Error(`${op.name}.vim is not loaded`);
        screen.pixels.set(image);
        break;
      }
      case "delta": {
        const entry = assets.deltaSets.get(op.set)?.entries[op.entry];
        if (!entry) throw new Error(`delta ${op.set}:${op.entry} is not loaded`);
        drawDelta(screen, entry, op.x, op.y);
        break;
      }
    }
  }
}

// Colour registers while a terminal shows der.vim (h0:922c), else null (the room's).
export function talkPalette(game: Game, assets: AgaAssets): Palette | null {
  const file = game.state.talk.palette;
  if (!file) return null;
  if (file !== "der.pal") throw new Error(`palette ${file} is not loaded`);
  return assets.palettes.der;
}
