import type { ActorContext } from "./model.ts";

// h0:b0dc: steps the four g:1e4c palette scripts (46 steps, ended by the g:1afb sentinel) every 8 ticks.
// Their writes never land on AGA: each record's first colour (150..251) reaches h0:44b0 -> h0:155c2 through
// ext.w, and h0:155c2 drops a write whose first + count is 0x100 or more as an unsigned word, so only the
// step counter and its timer change. The timer query itself advances one cooperative PAL tick in the harness.
export function cyclePalette(ctx: ActorContext): void {
  if (ctx.state.paused) return;
  ctx.vblank();
  if (ctx.timers.get(ctx.state.paletteTimer)) return;
  ctx.state.paletteStep++;
  if (ctx.state.paletteStep === 46) ctx.state.paletteStep = 0;
  ctx.timers.set(ctx.state.paletteTimer, 8);
}

// h0:c4e: return true only when a full-palette flash needs its saved palette restored.
export function finishFlash(ctx: ActorContext): boolean {
  const id = ctx.state.flashMessage;
  if (id === 255) return false;
  ctx.vblank();
  if (ctx.timers.get(ctx.state.flashTimer)) return false;
  if (id < 100) {
    ctx.emit({ type: "palette", start: 0, colors: [0,0,0] });
    ctx.emit({ type: "palette", start: 253, colors: [0,0,0] });
  }
  ctx.state.flashMessage = 255;
  return id >= 100;
}
