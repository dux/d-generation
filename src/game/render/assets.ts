import { decodeVim, parseAgaShapeFile, parseAmigaEffects, unlzw, VIM_WIDTH, type AmigaSample } from "../../formats/aga.ts";
import { decodeKeyboard } from "../ui/terminal/keyboard.ts";
import { parseDeltaSet, type DeltaSet } from "../../formats/delta.ts";
import { parsePalette, type Palette } from "../../formats/palette.ts";
import type { ShapeNode } from "../../formats/shape.ts";

// Graphics and sound of the AGA release, decoded from ./amiga/aga (paths below are relative to it).

// Sprite banks by the names the executable loads them under (h0:278). B1, INVEN, ANM, DOOR and DOOR2 stay
// resident (g:55c); the player bank is one of PLY/SHPLY (g:172, h0:6a0) and the object bank group one of
// SUR+SHEAD+CGEN+CHEAD, DGEN, DER or SURS+SHEAD+CGEN+CHEAD (g:1fa, h0:6de), swapped in by context.
const BANKS = ["B1", "INVEN", "ANM", "DOOR", "DOOR2", "PLY", "SHPLY", "SUR", "SURS", "SHEAD", "CGEN", "CHEAD", "DGEN", "DER"];
// Set ids that two banks provide (PLY/SHPLY: 0, SUR/SURS: 9) resolve to the first bank listed here.
const DEFAULT_BANKS = ["PLY", "SUR"];

const DELTA_SETS = [1, 2, 3, 20, 22, 23, 24, 25, 27, 30, 31, 32, 33, 34, 53, 54, 55, 60, 61, 62, 63];

// Exact file names on the disk for the names the game asks for ("%s/%s.vim", "%s.pal", case-insensitive there).
const VIM_FILES: Record<string, string> = {
  scene58: "SCENE58.VIM", scene114: "SCENE114.VIM", scene139: "SCENE139.VIM", scene145: "SCENE145.VIM",
  genoq: "genoq.vim", logo: "logo.vim", cred: "CRED.VIM", der: "der.vim", eye: "eye.vim",
  uk1: "uk1.vim", uk2: "uk2.vim", uk3: "uk3.vim",
};
const SCENE_PALETTES = [58, 114, 139, 145];

export interface AgaAssets {
  banks: Map<string, Map<number, ShapeNode[]>>; // bank name -> shape set id -> tree
  shapes: Map<number, ShapeNode[]>; // shape set id -> tree, duplicates resolved to DEFAULT_BANKS
  deltaSets: Map<number, DeltaSet>; // DLTSET<n>.DAT
  palettes: {
    dgen: Palette; // DGEN.PAL, the base palette (g:dafa)
    blue: Palette; // BLUE/GREEN/RED.PAL: 48 colours for 32..79 (g:db06, g:db02, g:dafe)
    green: Palette;
    red: Palette;
    title: Palette;
    genoq: Palette;
    der: Palette; // DER.PAL, under der.vim on the scene-18 terminal
    bombed: Palette; // BOMBED.PAL (g:db0a), the registers after h0:1dd2
    scenes: Map<number, Palette>; // SCENE<n>.PAL: 48 colours, SCENE58.PAL 256
  };
  backdrop: Uint8Array; // BACK1.DAT, 320x100 chunky, shown through delta colour 0xfc
  keyboard: Uint8Array; // CD32 keyboard picture, 219x69 chunky, from hunk 9 of the executable
  sounds: AmigaSample[]; // amiga.eff
  vims: Map<string, Uint8Array>; // decoded 320x200 images loaded so far, by game name
  vim(name: string): Promise<Uint8Array>;
}

export async function loadAgaAssets(read: (path: string) => Promise<Uint8Array>): Promise<AgaAssets> {
  const banks = new Map<string, Map<number, ShapeNode[]>>();
  await Promise.all(
    BANKS.map(async (name) => {
      const sets = parseAgaShapeFile(await read(`aga/${name.toLowerCase()}.aga`));
      banks.set(name, new Map(sets.map((set) => [set.id, set.root])));
    }),
  );
  const shapes = new Map<number, ShapeNode[]>();
  for (const name of [...DEFAULT_BANKS, ...BANKS]) {
    for (const [id, root] of banks.get(name)!) if (!shapes.has(id)) shapes.set(id, root);
  }

  const deltaSets = new Map<number, DeltaSet>();
  await Promise.all(DELTA_SETS.map(async (n) => deltaSets.set(n, parseDeltaSet(await read(`DATA/DLTSET${n}.DAT`)))));

  const palette = async (file: string) => parsePalette(await read(`DATA/${file}`));
  const scenes = new Map<number, Palette>();
  await Promise.all(SCENE_PALETTES.map(async (n) => scenes.set(n, await palette(`SCENE${n}.PAL`))));
  const palettes = {
    dgen: await palette("DGEN.PAL"),
    blue: await palette("BLUE.PAL"),
    green: await palette("GREEN.PAL"),
    red: await palette("RED.PAL"),
    title: await palette("TITLE.PAL"),
    genoq: await palette("GENOQ.PAL"),
    der: await palette("DER.PAL"),
    bombed: await palette("BOMBED.PAL"),
    scenes,
  };

  // h0:cbc8: BACK1.DAT is LZW compressed, 320x100 chunky.
  const backdrop = unlzw(await read("DATA/BACK1.DAT"));
  if (backdrop.length !== VIM_WIDTH * 100) throw new Error(`BACK1.DAT holds ${backdrop.length} bytes`);

  const vims = new Map<string, Uint8Array>();
  const assets: AgaAssets = {
    banks,
    shapes,
    deltaSets,
    palettes,
    backdrop,
    keyboard: decodeKeyboard(await read("dgen")),
    sounds: parseAmigaEffects(await read("amiga.eff")),
    vims,
    async vim(name: string) {
      const key = name.toLowerCase();
      let image = vims.get(key);
      if (!image) {
        const file = VIM_FILES[key];
        if (!file) throw new Error(`no image ${name}.vim on the disk`);
        image = decodeVim(await read(`DATA/${file}`));
        vims.set(key, image);
      }
      return image;
    },
  };
  // The terminal draws der.vim synchronously (./src/game/ui/talk/render.ts), so it is decoded up front.
  await assets.vim("der");
  return assets;
}
