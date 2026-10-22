import type { Game } from "../core/game.ts";
import { s8, u16 } from "../core/int.ts";
import type { AgaAssets } from "../render/assets.ts";
import { Gfx } from "../render/gfx.ts";
import { Screen } from "../../render/screen.ts";
import type { Frame } from "../../formats/shape.ts";
import type { ScreenState } from "./screen.ts";

export interface TitleSprite {
  set: number;
  path: number[];
  x: number;
  baseline: number;
  mirror: number;
  mirrorWidth: number;
  top: number;
}

// h0:b6c -> h0:20f0: record only the sprite projection, never an actor graph or emulated memory.
export function composeScreenObjects(game: Game): void {
  const state = game.state, sprites: TitleSprite[] = [];
  for (const actor of game.objects.slots) {
    if (!actor || actor.removed || actor.drawSuppressed) continue;
    const u = u16(actor.boundsLeft - actor.boundsBottom + 0x8000) >>> 8;
    const v = u16(actor.boundsBottom + actor.boundsRight - 0x8000) >>> 8;
    for (const part of [1, 0, 2]) {
      const path = actor.spritePaths[part];
      if (!actor.spriteEnabled[part] || !path) continue;
      sprites.push({
        set: actor.spriteSets[part] ?? actor.classId, path: [...path],
        x: 2 * (u - state.scrollX) + ((actor.x & 0x80) ? 1 : 0) + (actor.spriteOffsetX[part] ?? 0),
        baseline: v - state.scrollY - s8(actor.height) + 1 + (actor.spriteOffsetY[part] ?? 0),
        mirror: actor.spriteMirror, mirrorWidth: s8(actor.spriteMirrorWidth[part] ?? 0),
        top: actor.classId === 23 && Reflect.get(actor, "sledKind") >= 3 ? 11 : 0,
      });
    }
  }
  state.screen.objectFrames.push(sprites);
}

interface Placed { frame: Frame; x: number; y: number; sprite: TitleSprite }

// h0:1d00/20f0 erase old rectangles from g:de58, draw into the initially cleared g:de5c, then copy dirty
// rectangles to g:de50. Transparent pixels in a newly entered row must stay black, not reveal the city.
export function drawTitleObjects(display: Screen, s: ScreenState, assets: AgaAssets, backdrop: Screen): void {
  const view = new Screen(), gfx = new Gfx(view, assets.shapes);
  view.bottom = s.clip;
  let previous: Placed[] = [];
  const copy = (from: Screen, to: Screen, part: Placed) => {
    const left = Math.max(0, part.x), right = Math.min(320, part.x + part.frame.width + 1);
    const top = Math.max(0, part.y), bottom = Math.min(s.clip, part.y + part.frame.height);
    for (let y = top; y < bottom; y++) to.pixels.set(from.pixels.subarray(y * 320 + left, y * 320 + right), y * 320 + left);
  };
  for (const sprites of s.objectFrames) {
    const next = sprites.map(sprite => {
      const frame = gfx.frame(sprite.set, sprite.path);
      return { frame, x: sprite.x + (sprite.mirror ? sprite.mirrorWidth - frame.x - frame.width : frame.x),
        y: sprite.baseline - frame.height - frame.y, sprite };
    });
    if (next.length === previous.length && next.every((p, i) => p.frame === previous[i]!.frame && p.x === previous[i]!.x && p.y === previous[i]!.y)) continue;
    for (const p of previous) copy(backdrop, view, p);
    for (const p of next) gfx.blit(p.frame, p.x, p.y, { mirror: !!p.sprite.mirror, clip: { left: 0, right: 320, top: p.sprite.top, bottom: 0xa1 } });
    for (const p of previous) copy(view, display, p);
    for (const p of next) copy(view, display, p);
    // h0:bd0 copies the city over the tiny doorway after every composed pass.
    for (let y = 90; y < 95; y++) display.pixels.set(backdrop.pixels.subarray(y * 320 + 120, y * 320 + 130), y * 320 + 120);
    previous = next;
  }
}
