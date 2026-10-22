import type { Game } from "../../core/game.ts";
import { s8, s16, u16 } from "../../core/int.ts";
import { drawLine, drawPanel, restoreDisplay, startDelay } from "../talk/box.ts";
import { lineEnd, PROMPT_COLOR } from "../talk/text.ts";

// g:6092: the 13 x 6 characters of the CD32 on-screen keyboard (backspace and Enter in the last row).
const KEYS = "1234567890-=\\ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,#;[]<>()\"\b\r";
const COLUMNS = 13, ROWS = 6;
const GAME_CONTROLLER = 0x10000000, RED = 1 << 22;
const TEXT_X = 10, TEXT_Y = 0xb4, LAST_X = 0x131;
const CURSOR = "_"; // g:1ef4 with h0:bbc0's character
const ERASE = "]"; // g:1ef6, drawn by h0:bc2e

// h0:14d1a(1): ReadJoyPort(1) until a CD32 game controller answers; the original spins without a tick.
function readPad(game: Game): number {
  const joy = game.state.input.joy >>> 0;
  if ((joy & 0xf0000000) >>> 0 !== GAME_CONTROLLER) throw new Error("AGA on-screen keyboard h0:14d1a without a CD32 game controller would spin forever");
  return joy;
}

// h0:14d1a(mode) (bc9e) CD32 keyboard: 0 saves the 219x69 display rectangle at (0x32, 0x32) and shows the keyboard
// there (cursor at 0,0), 2 puts the rectangle back. 1 reads one key: the pad moves the cursor (with wrap) every
// Delay(5), the highlight blinks, RED takes the key under the cursor as it was before that poll's move.
function keyboard(game: Game, mode: number): number {
  const state = game.state, talk = state.talk, display = talk.display;
  if (mode === 0) {
    display.push({ op: "keyboard" });
    talk.keyColumn = talk.keyRow = 0;
    return 0;
  }
  if (mode === 2) {
    display.push({ op: "unkeyboard" });
    return 0;
  }
  let lit = 0;
  // h0:14f34 / h0:14fbe / h0:15048: highlight on, off, and toggle (minterm 0x50 inverts the cell).
  const light = (column: number, row: number) => {
    if (lit) return;
    lit = 1;
    display.push({ op: "invert", column, row });
  };
  const unlight = (column: number, row: number) => {
    if (lit !== 1) return;
    lit = 0;
    display.push({ op: "invert", column, row });
  };
  light(talk.keyColumn, talk.keyRow);
  state.input.padBusy = 1;
  for (;;) {
    const joy = readPad(game);
    const column = talk.keyColumn, row = talk.keyRow;
    if (joy & 1) {
      talk.keyColumn = s8(talk.keyColumn + 1);
      if (talk.keyColumn > COLUMNS - 1) {
        talk.keyRow = s8(talk.keyRow + 1);
        talk.keyColumn = 0;
        if (talk.keyRow > ROWS - 1) talk.keyRow = 0;
      }
    }
    if (joy & 2) {
      talk.keyColumn = s8(talk.keyColumn - 1);
      if (talk.keyColumn < 0) {
        talk.keyColumn = COLUMNS - 1;
        talk.keyRow = s8(talk.keyRow - 1);
        if (talk.keyRow < 0) talk.keyRow = ROWS - 1;
      }
    }
    if (joy & 4) {
      talk.keyRow = s8(talk.keyRow + 1);
      if (talk.keyRow > ROWS - 1) talk.keyRow = 0;
    }
    if (joy & 8) {
      talk.keyRow = s8(talk.keyRow - 1);
      if (talk.keyRow < 0) talk.keyRow = ROWS - 1;
    }
    if (joy & RED) {
      unlight(column, row);
      // The release poll at h0:14e6a has no timer either; the harness ticks once per poll there.
      do game.vblank(); while (readPad(game) & RED);
      state.input.padBusy = 0;
      return KEYS.charCodeAt(row * COLUMNS + column);
    }
    if (talk.keyColumn !== column || talk.keyRow !== row) {
      unlight(column, row);
      light(talk.keyColumn, talk.keyRow);
    }
    game.vblank(5); // dos.library Delay(5) at h0:14ed8
    lit ^= 1;
    display.push({ op: "invert", column: talk.keyColumn, row: talk.keyRow });
  }
}

// h0:b9d6 (DOS 0:d1bd) inputLine(prompt, max, fill, cursor, lines): a panel of `lines` rows with the prompt, typed
// through the on-screen keyboard. Ctrl-X (0x18) clears, backspace deletes, Enter ends; letters, digits and
// punctuation up to 0x7a (not 0x5b..0x60) are taken while the line ends left of x 0x131 and holds fewer than
// `max` characters. Returns the line.
export function inputLine(game: Game, prompt: string, max: number, fill: number, _cursor: number, lines: number): string {
  const state = game.state, talk = state.talk;
  const wide = state.screen.wideLines;
  const frameTime = game.pollTimer(state.frameTimer); // h0:bcaa
  startDelay(game, 0x0b);
  talk.cursorBlink = 0;
  const savedTop = state.panelTop;
  const top = s16(0xbe - lines * 11);
  state.panelTop = u16(top);
  state.textColor = PROMPT_COLOR;
  let text = "", cursorX = TEXT_X;
  const showPrompt = () => {
    drawPanel(game, fill);
    drawLine(game, TEXT_X, top + 5, prompt, wide);
  };
  drawPanel(game, fill);
  state.textCursor = 1;
  state.textColor = 0x85;
  drawLine(game, TEXT_X, top + 5, prompt, wide);
  while (game.pendingKey()) game.consumeKey();
  state.input.textEntry = 1;
  keyboard(game, 0);
  for (;;) {
    const key = keyboard(game, 1);
    if (key === 0x1b) { text = ""; break; }
    if (key === 0x0d) break;
    if (key === 0x18) {
      text = "";
      showPrompt();
    } else if (key === 8) {
      if (text) text = text.slice(0, -1);
      talk.cursorBlink = 0;
    } else if (key >= 0x20 && key <= 0x7a && (key <= 0x5a || key >= 0x61) && cursorX <= LAST_X && text.length !== max) {
      text += String.fromCharCode(key);
    }
    // h0:bc2e erases the old cursor (colour 0xff, g:3ba2 clear), then the line, the new end and h0:bbc0's cursor.
    const color = state.textColor;
    state.textColor = 0xff;
    state.textCursor = 0;
    drawLine(game, cursorX, TEXT_Y, ERASE, wide);
    state.textCursor = 1;
    state.textColor = color;
    drawLine(game, TEXT_X, TEXT_Y, text, wide);
    cursorX = lineEnd(text, TEXT_X, wide);
    state.textColor = 0xff;
    state.textCursor = 0;
    drawLine(game, cursorX, TEXT_Y, ERASE, wide);
    state.textCursor = 1;
    state.textColor = color;
    drawLine(game, cursorX, TEXT_Y, CURSOR, wide);
  }
  keyboard(game, 2);
  state.input.textEntry = 0;
  restoreDisplay(game); // h0:e1a8(g:4d2, 0)
  game.timers.set(state.frameTimer, frameTime);
  state.panelTop = savedTop;
  state.forceRedraw = 1;
  state.textCursor = 0;
  return text;
}
