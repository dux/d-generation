import { decodeVim, parseAgaShapeFile } from "../../formats/aga.ts";
import { parseDeltaSet, type DeltaSet } from "../../formats/delta.ts";
import type { ShapeNode } from "../../formats/shape.ts";
import { GAME_FONT } from "../render/gfx.ts";
import { decodePadMenu } from "./padmenu-render.ts";

// Pictures of the title, attract, terminal, bombed and ending screens, decoded from ./amiga/aga.
// read() takes paths relative to the repository root.

const DATA = "amiga/aga/DATA";
// Disk names of the vims the game asks for as "%s/%s.vim" (h0:cc28; the Amiga file system ignores case).
const VIMS: Record<string, string> = {
  genoq: "genoq.vim", eye: "eye.vim", logo: "logo.vim", cred: "CRED.VIM", uk1: "uk1.vim", uk2: "uk2.vim", uk3: "uk3.vim",
  der: "der.vim",
};
// Disk names of the palette files: each vim's "%s.pal" plus title.pal (g:59c), DGEN.PAL (h0:ada2), bombed.pal (h0:1dd2).
const PALETTES: Record<string, string> = {
  "genoq.pal": "GENOQ.PAL", "eye.pal": "EYE.PAL", "logo.pal": "logo.pal", "cred.pal": "CRED.PAL", "uk1.pal": "UK1.PAL",
  "uk2.pal": "UK2.PAL", "uk3.pal": "UK3.PAL", "der.pal": "DER.PAL", "title.pal": "TITLE.PAL", "dgen.pal": "DGEN.PAL",
  "bombed.pal": "BOMBED.PAL",
};
// 0x22: title cards and the bombed picture (g:4b8 entries); 0x3d: scene 0x66 over genoq (h0:1250).
const DELTA_SETS = [0x22, 0x3d];

export interface UiAssets {
  vims: Map<string, Uint8Array>; // lower-case name -> 320x200 chunky pixels
  palettes: Map<string, Uint8Array>; // lower-case file name -> raw 6-bit RGB bytes
  deltaSets: Map<number, DeltaSet>;
  font: ShapeNode[]; // g:dcbc glyphs, shape set 36 of b1.aga, frame = code - 32
  padMenu: Uint8Array; // h9:3e60, 271x26 chunky
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

export async function loadUiAssets(read: (path: string) => Promise<Uint8Array>): Promise<UiAssets> {
  const vims = new Map<string, Uint8Array>();
  const palettes = new Map<string, Uint8Array>();
  const deltaSets = new Map<number, DeltaSet>();
  const [, , , sets, executable] = await Promise.all([
    Promise.all(Object.entries(VIMS).map(async ([name, file]) => vims.set(name, decodeVim(await read(`${DATA}/${file}`))))),
    Promise.all(Object.entries(PALETTES).map(async ([name, file]) => palettes.set(name, await read(`${DATA}/${file}`)))),
    Promise.all(DELTA_SETS.map(async (n) => deltaSets.set(n, parseDeltaSet(await read(`${DATA}/DLTSET${n}.DAT`))))),
    read("amiga/aga/aga/b1.aga").then(parseAgaShapeFile),
    read("amiga/aga/dgen"),
  ]);
  const font = sets.find((set) => set.id === GAME_FONT.set)?.root;
  if (!font) throw new Error(`b1.aga has no shape set ${GAME_FONT.set}`);
  return { vims, palettes, deltaSets, font, padMenu: decodePadMenu(executable) };
}
