import type { Game } from "../../core/game.ts";
import { clearMessage } from "../../core/messages.ts";
import { s16, u16 } from "../../core/int.ts";
import { BOX_COLOR, lineColor, measureLines, styleColor, styleFill } from "./text.ts";

// h0:dfda clearPanel(fill): the bevelled panel from the panel top g:4d2 down, drawn into the display.
export function drawPanel(game: Game, fill: number): void {
  game.state.talk.display.push({ op: "panel", top: s16(game.state.panelTop), fill });
}

// h0:de2a drawText(pos, text, 1): every wrapped line goes through h0:dcb4, which applies the "|" colour codes.
export function drawWrapped(game: Game, x: number, y: number, text: string, wide = 0): void {
  const state = game.state;
  state.talk.display.push({ op: "wrap", x, y, text, wide });
  state.textColor = lineColor(text, state.textColor);
}

// h0:dcb4 drawLine(pos, text).
export function drawLine(game: Game, x: number, y: number, text: string, wide = 0): void {
  const state = game.state;
  state.talk.display.push({ op: "text", x, y, text, wide });
  state.textColor = lineColor(text, state.textColor);
}

// h0:e1a8(top, 0) restoreDisplay: the view (g:87fa) is copied back over the display from `top` to the clip
// g:8c68 and the rest is cleared, which removes everything the prompts drew and the panel message pixels.
export function restoreDisplay(game: Game): void {
  game.state.talk.display = [];
  game.state.panelText = "";
}

// h0:bc62 startDelay(ticks): the g:dc2a timer counts `ticks` down.
export function startDelay(game: Game, ticks: number): void {
  const timers = game.timers, slot = game.state.delayTimer;
  timers.thaw(slot);
  timers.set(slot, ticks);
  timers.enable(slot, 1);
  timers.freeze(slot);
}

// The h0:1462a(g:dc2a) loops after a menu move: poll until the delay ran out.
export function finishDelay(game: Game): void {
  while (game.pollTimer(game.state.delayTimer)) { /* one tick per poll */ }
}

// h0:b89e (DOS 0:d0ab) messageBox(text, style, lines, timed, restore): the text on a panel of `lines` 11-pixel
// rows above the bottom (0 measures it, at least 2; -1 is the whole screen). Timed boxes wait 320 counts per row
// and are confirmed by anything but Esc; the others wait for a key and are confirmed by Enter. Returns 1 when
// confirmed. The panel stays drawn unless `restore` is set.
export function messageBox(game: Game, text: string, style: number, lines: number, timed: number, restore: number): number {
  const state = game.state;
  const savedTop = state.panelTop;
  clearMessage(game.context); // h0:b788
  state.textColor = styleColor(style);
  lines = s16(lines);
  if (!lines) {
    lines = measureLines(text, 0x0b, state.screen.wideLines);
    if (lines === 1) lines = 2;
  }
  const x = 0x0b;
  let y: number;
  if (lines === -1) {
    state.panelTop = 0;
    y = 4;
  } else {
    const top = s16(0xbe - lines * 11);
    state.panelTop = u16(top);
    state.textColor = BOX_COLOR;
    y = top + 5;
  }
  drawPanel(game, styleFill(style));
  state.textColor = styleColor(style);
  drawWrapped(game, x, y, text);
  let confirmed: number;
  if (timed) confirmed = game.wait(u16(lines * 320), true) !== 0x1b ? 1 : 0; // h0:bc98 -> h0:304c(ticks, 1)
  else confirmed = game.waitKey(1) === 0x0d ? 1 : 0; // h0:bcb0 -> h0:357c(1)
  if (state.messageShown) {
    state.clipBottom = 0xb5;
    state.messageShown = 0;
  }
  if (restore) restoreDisplay(game);
  game.sound(0x13);
  state.panelTop = savedTop;
  state.forceRedraw = 1;
  return confirmed;
}
