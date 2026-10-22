import { drawDelta } from "../../formats/delta.ts";
import type { Palette } from "../../formats/palette.ts";
import type { Screen } from "../../render/screen.ts";
import type { Game } from "../core/game.ts";
import type { Actor } from "../core/model.ts";
import type { AgaAssets } from "./assets.ts";
import { Gfx } from "./gfx.ts";
import { drawObject, drawObjects } from "./objects.ts";
import { drawRoom, roomPalette, type Scheme } from "./room.ts";
import { drawTalkDisplay, talkPalette } from "../ui/talk/render.ts";

// SUR sprite parts use set 109 = set 9 of the SURS bank (sur.ts spriteSets).
const SUR_SET = 109;

// `world` is the view as copied to the display after the draw pass `worldKey` names (room, objects, clear below
// the clip).
interface RenderCache { assets: AgaAssets; gfx: Gfx; scheme: Scheme; world: Uint8Array | null; worldKey: WorldKey | null }
interface WorldKey { talk: object; scene: number; draws: number; bombed: object | null }
const caches = new WeakMap<Game, RenderCache>();

function cache(screen: Screen, game: Game, assets: AgaAssets): RenderCache {
  let entry = caches.get(game);
  if (!entry || entry.assets !== assets || entry.gfx.screen !== screen) {
    const shapes = new Map(assets.shapes);
    const surs = assets.banks.get("SURS")?.get(9);
    if (!surs) throw new Error("SURS bank set 9 is not loaded");
    shapes.set(SUR_SET, surs);
    entry = { assets, gfx: new Gfx(screen, shapes), scheme: entry?.scheme ?? 0, world: null, worldKey: null };
    caches.set(game, entry);
  }
  return entry;
}

// h0:dfda clearPanel(fill): the bevelled panel from `top` to the last row, drawn straight into the display
// bitmap (g:de50): fill, a two-pixel 0x15 frame (four rows at the bottom), then a light (0xa2) top/left and dark
// (0xb1) bottom/right inner edge.
export function drawPanel(gfx: Gfx, top: number, fill: number): void {
  const bottom = gfx.screen.height, right = gfx.screen.width - 1;
  const inner = bottom - top - 6;
  gfx.bar(0, top, right + 1, bottom - top, fill);
  gfx.bar(0, top, right + 1, 2, 0x15);
  gfx.bar(0, bottom - 4, right + 1, 4, 0x15);
  gfx.bar(0, top + 2, 2, inner, 0x15);
  gfx.bar(right - 1, top + 2, 2, inner, 0x15);
  gfx.bar(2, top + 2, right - 3, 1, 0xa2);
  gfx.bar(2, bottom - 4, right - 3, 1, 0xb1);
  gfx.bar(2, top + 2, 1, inner, 0xa2);
  gfx.bar(right - 2, top + 2, 1, inner, 0xb1);
}

// One displayed frame from game state. The original keeps three bitmaps: the room (g:87fe), the view it
// composes objects into (g:87fa, copied to the display by dirty rectangles in h0:aea8) and the display
// (g:de50). The copies stop at the view clip g:8c68 (h0:d58e); below it the display holds the panel, which
// h0:b6a8 draws directly into it, or zeros after h0:e1a8 clears it. Load assets.vim(roomImage(scene)) first
// for image rooms. Rendering never changes game state.
// The view reaches the display only through h0:20f0 -> h0:aea8 near the end of each pass (counted by
// game.drawPasses) and h0:1dd2's whole-view copy, so ticks inside a pass, including prompts that block in an
// actor update (terminals, message boxes) and the message polls after the draw, show the last copied view. The
// first render after a copy (or a room, bombed or state change) keeps that view and later renders reuse it until
// the next one. Hosts render every cooperative tick, and the frame sync wait of every pass ticks before its update.
export function renderGame(screen: Screen, game: Game, assets: AgaAssets): void {
  const entry = cache(screen, game, assets);
  const state = game.state, gfx = entry.gfx;
  const key = entry.worldKey;
  if (entry.world && key && key.talk === state.talk && key.scene === game.room.scene && key.draws === game.drawPasses
    && key.bombed === state.screen.bombed) {
    screen.pixels.set(entry.world);
  } else {
    screen.clear();
    entry.scheme = drawRoom(screen, game.room, assets, game.room.scene, entry.scheme);
    const bombed = state.screen.bombed;
    if (bombed) {
      // h0:1dd2 plotted the explosion into the view g:87fa, under every object drawn since.
      const explosion = assets.deltaSets.get(bombed.set)?.entries[bombed.entry];
      if (!explosion) throw new Error(`delta ${bombed.set}:${bombed.entry} is not in the AGA assets`);
      screen.bottom = Math.min(bombed.clip, screen.height - 1);
      drawDelta(screen, explosion, bombed.x, bombed.y);
    }
    screen.bottom = state.clipBottom;
    drawObjects(game.objects, gfx);
    screen.bottom = screen.height - 1;
    // h0:1dd2's h0:1628 copied the whole view, room picture included, over the display below the clip.
    if (!bombed) screen.pixels.fill(0, state.clipBottom * screen.width);
    if (entry.world?.length === screen.pixels.length) entry.world.set(screen.pixels);
    else entry.world = screen.pixels.slice();
    entry.worldKey = { talk: state.talk, scene: game.room.scene, draws: game.drawPasses, bombed: state.screen.bombed };
  }
  const text = state.panelText;
  if (text) {
    // h0:b6a8: a "`" line is centred on x 0x9e by its h0:de2a width.
    drawPanel(gfx, state.panelTop, state.messageFont);
    const x = text.charCodeAt(0) === 96 ? 0x9e - (gfx.wrapText(text, 0, 0, false).width >> 1) : state.messageX;
    gfx.text(text, x, state.messageY);
  }
  // Conversation menu, inventory, message boxes, CD32 keyboard and terminal pictures (./src/game/ui/talk).
  drawTalkDisplay(screen, game, assets);
}

// Draws objects again over the last renderGame picture, in the given order (doors with a save slot excepted, as
// in the object pass). ./tools/verify-aga-frames.ts replays the original's draw order of equal-y objects with it.
export function redrawObjects(screen: Screen, game: Game, assets: AgaAssets, order: readonly Actor[]): void {
  const gfx = cache(screen, game, assets).gfx;
  screen.bottom = game.state.clipBottom;
  for (const actor of order) drawObject(game.objects, actor, gfx);
  screen.bottom = screen.height - 1;
}

// Colour registers for the last renderGame call: a terminal picture's own palette, else bombed.pal after h0:1dd2
// or the room scheme over DGEN.PAL, then the game's palette writes.
export function renderPalette(game: Game, assets: AgaAssets): Uint8Array {
  const talk = talkPalette(game, assets);
  if (talk) return talk;
  const scheme = caches.get(game)?.scheme ?? 0;
  const base: Palette = game.state.screen.bombed ? assets.palettes.bombed : roomPalette(assets, game.room.scene, scheme);
  return game.palette(base);
}
