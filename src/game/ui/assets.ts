import type { DeltaSet } from "../../formats/delta.ts";
import { readDeltaSet, readImage, readPalettes, readSprites, type Read } from "../../formats/pack.ts";
import type { ShapeNode } from "../../formats/shape.ts";
import { GAME_FONT } from "../render/gfx.ts";
import { PAD_MENU_HEIGHT, PAD_MENU_WIDTH } from "./padmenu-render.ts";

// Pictures of the title, attract, terminal, bombed and ending screens from ./assets (converted by
// ./tools/extract-assets.ts). read() takes paths relative to the repository root.

// The vims the game asks for as "%s/%s.vim" (h0:cc28).
const VIMS = ["genoq", "eye", "logo", "cred", "uk1", "uk2", "uk3", "der"];
// Each vim's "%s.pal" plus title.pal (g:59c), DGEN.PAL (h0:ada2), bombed.pal (h0:1dd2).
const PALETTES = ["genoq.pal", "eye.pal", "logo.pal", "cred.pal", "uk1.pal", "uk2.pal", "uk3.pal", "der.pal", "title.pal", "dgen.pal", "bombed.pal"];
// 0x22: title cards and the bombed picture (g:4b8 entries); 0x3d: scene 0x66 over genoq (h0:1250).
const DELTA_SETS = [0x22, 0x3d];

export interface UiAssets {
  vims: Map<string, Uint8Array>; // lower-case name -> 320x200 chunky pixels
  palettes: Map<string, Uint8Array>; // lower-case file name -> raw 6-bit RGB bytes
  deltaSets: Map<number, DeltaSet>;
  font: ShapeNode[]; // g:dcbc glyphs, shape set 36 of b1.aga, frame = code - 32
  padMenu: Uint8Array; // 271x26 chunky (assets/images/cd32-padmenu.png)
}

export function uiVim(assets: UiAssets, name: string): Uint8Array {
  const image = assets.vims.get(name.toLowerCase());
  if (!image) throw new Error(`no image ${name}.vim in the UI assets`);
  return image;
}

export function uiPalette(assets: UiAssets, file: string): Uint8Array {
  const bytes = assets.palettes.get(file.toLowerCase());
  if (!bytes) throw new Error(`no palette ${file} in the UI assets`);
  return bytes;
}

export async function loadUiAssets(read: Read): Promise<UiAssets> {
  const vims = new Map<string, Uint8Array>();
  const deltaSets = new Map<number, DeltaSet>();
  const [, files, , sets, padMenu] = await Promise.all([
    Promise.all(VIMS.map(async (name) => vims.set(name, (await readImage(read, name)).pixels))),
    readPalettes(read),
    Promise.all(DELTA_SETS.map(async (n) => deltaSets.set(n, await readDeltaSet(read, n)))),
    readSprites(read, "b1"),
    readImage(read, "cd32-padmenu"),
  ]);
  const palettes = new Map(PALETTES.map((name) => {
    const bytes = files.get(name);
    if (!bytes) throw new Error(`no ${name} in assets/palettes.json`);
    return [name, bytes] as const;
  }));
  if (padMenu.width !== PAD_MENU_WIDTH || padMenu.height !== PAD_MENU_HEIGHT) throw new Error("cd32-padmenu.png has the wrong size");
  const font = sets.find((set) => set.id === GAME_FONT.set)?.root;
  if (!font) throw new Error(`b1 has no shape set ${GAME_FONT.set}`);
  return { vims, palettes, deltaSets, font, padMenu: padMenu.pixels };
}
