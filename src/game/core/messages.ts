import type { ActorContext } from "./model.ts";
import { u16 } from "./int.ts";
import { textColorAfter } from "../ui/screen.ts";

// g:1e8b font byte and g:1e80[g:1e91[style]] text colour per message style.
const FONTS = [29, 131, 131, 131, 0, 139] as const;
const COLORS = [96, 96, 108, 133, 133, 84] as const;
const VIEW_BOTTOM = 181; // h0:1730/b788 restore the view clip to 0xb5.

// h0:b802: the first timer slot counts the panel message down; the text sits 4 rows into the panel.
export function initMessages(ctx: ActorContext): void {
  const state = ctx.state;
  state.messageTimer = ctx.timers.allocate();
  ctx.timers.enable(state.messageTimer, 1);
  state.messageShown = 0;
  state.messageText = "";
  state.messageX = 10;
  state.messageY = u16(state.panelTop + 4);
}

// h0:b7aa (via h0:36ee): queue a panel message for the next h0:b746 pass; time is in 55-tick units.
export function showMessage(ctx: ActorContext, text: string, time: number, style: number): void {
  const state = ctx.state;
  const font = FONTS[style], color = COLORS[style];
  if (font === undefined || color === undefined) throw new Error(`AGA message style ${style} outside g:1e8b`);
  state.messageText = text.slice(0, 255);
  state.messageFont = font;
  state.textColor = color;
  state.forceRedraw = 1;
  state.messageTime = u16(time * 55);
}

// h0:b746 (via h0:371e): display a queued message, then clear the panel once its timer runs out.
export function updateMessages(ctx: ActorContext, pollTimer: (slot: number) => number): void {
  const state = ctx.state;
  if (state.messageText) {
    displayMessage(ctx, pollTimer);
    state.messageText = "";
    state.clipBottom = state.panelTop;
  }
  if (state.messageShown && pollTimer(state.messageTimer) === 0) clearMessage(ctx);
}

// h0:b6a8: the text blit is timed against the frame timer, which is restored after drawing.
function displayMessage(ctx: ActorContext, pollTimer: (slot: number) => number): void {
  const state = ctx.state;
  const frameTime = pollTimer(state.frameTimer);
  state.panelText = state.messageText;
  state.textColor = textColorAfter(state.messageText, state.textColor); // h0:dcb4 "|" codes
  ctx.emit({ type: "message", text: state.messageText });
  if (state.messageTime) {
    state.messageShown = 1;
    ctx.timers.set(state.messageTimer, state.messageTime);
    ctx.timers.freeze(state.messageTimer);
  } else state.messageShown = 0;
  ctx.timers.set(state.frameTimer, frameTime);
}

// h0:b788: erase the panel text and restore the full view clip.
export function clearMessage(ctx: ActorContext): void {
  const state = ctx.state;
  if (!state.messageShown) return;
  state.clipBottom = VIEW_BOTTOM;
  state.forceRedraw = 1;
  state.messageShown = 0;
  state.panelText = "";
}
