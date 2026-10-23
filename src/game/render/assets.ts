import type { DeltaSet } from "../../formats/delta.ts";
import { readDeltaSet, readImage, readPalettes, readSamples, readSprites, type Read } from "../../formats/pack.ts";
import { parsePalette, type Palette } from "../../formats/palette.ts";
import type { ShapeNode } from "../../formats/shape.ts";
import type { AmigaSample } from "../../formats/sound.ts";
import { KEYBOARD_HEIGHT, KEYBOARD_WIDTH } from "../ui/terminal/keyboard.ts";

// Graphics and sound of the AGA release from ./assets (converted by ./tools/extract-assets.ts). read() takes paths
// relative to the repository root.

// Sprite banks by the names the executable loads them under (h0:278). B1, INVEN, ANM, DOOR and DOOR2 stay
// resident (g:55c); the player bank is one of PLY/SHPLY (g:172, h0:6a0) and the object bank group one of
// SUR+SHEAD+CGEN+CHEAD, DGEN, DER or SURS+SHEAD+CGEN+CHEAD (g:1fa, h0:6de), swapped in by context.
const BANKS = ["B1", "INVEN", "ANM", "DOOR", "DOOR2", "PLY", "SHPLY", "SUR", "SURS", "SHEAD", "CGEN", "CHEAD", "DGEN", "DER"];
// Set ids that two banks provide (PLY/SHPLY: 0, SUR/SURS: 9) resolve to the first bank listed here.
const DEFAULT_BANKS = ["PLY", "SUR"];

const DELTA_SETS = [1, 2, 3, 20, 22, 23, 24, 25, 27, 30, 31, 32, 33, 34, 53, 54, 55, 60, 61, 62, 63];

// Pictures the game asks for as "%s/%s.vim" (h0:cc28), by game name.
const VIMS = ["scene58", "scene114", "scene139", "scene145", "genoq", "logo", "cred", "der", "eye", "uk1", "uk2", "uk3"];
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

async function picture(read: Read, name: string, width: number, height: number): Promise<Uint8Array> {
  const image = await readImage(read, name);
  if (image.width !== width || image.height !== height) throw new Error(`${name}.png is ${image.width}x${image.height}, expected ${width}x${height}`);
  return image.pixels;
}

export async function loadAgaAssets(read: Read): Promise<AgaAssets> {
  const banks = new Map<string, Map<number, ShapeNode[]>>();
  const deltaSets = new Map<number, DeltaSet>();
  const [files, , , backdrop, keyboard, sounds] = await Promise.all([
    readPalettes(read),
    Promise.all(BANKS.map(async (name) => {
      const sets = await readSprites(read, name.toLowerCase());
      banks.set(name, new Map(sets.map((set) => [set.id, set.root])));
    })),
    Promise.all(DELTA_SETS.map(async (n) => deltaSets.set(n, await readDeltaSet(read, n)))),
    picture(read, "backdrop", 320, 100),
    picture(read, "cd32-keyboard", KEYBOARD_WIDTH, KEYBOARD_HEIGHT),
    readSamples(read),
  ]);
  const shapes = new Map<number, ShapeNode[]>();
  for (const name of [...DEFAULT_BANKS, ...BANKS]) {
    for (const [id, root] of banks.get(name)!) if (!shapes.has(id)) shapes.set(id, root);
  }

  const palette = (file: string) => {
    const bytes = files.get(file.toLowerCase());
    if (!bytes) throw new Error(`no ${file} in assets/palettes.json`);
    return parsePalette(bytes);
  };
  const palettes = {
    dgen: palette("DGEN.PAL"),
    blue: palette("BLUE.PAL"),
    green: palette("GREEN.PAL"),
    red: palette("RED.PAL"),
    title: palette("TITLE.PAL"),
    genoq: palette("GENOQ.PAL"),
    der: palette("DER.PAL"),
    bombed: palette("BOMBED.PAL"),
    scenes: new Map(SCENE_PALETTES.map((n) => [n, palette(`SCENE${n}.PAL`)])),
  };

  const vims = new Map<string, Uint8Array>();
  const assets: AgaAssets = {
    banks,
    shapes,
    deltaSets,
    palettes,
    backdrop,
    keyboard,
    sounds,
    vims,
    async vim(name: string) {
      const key = name.toLowerCase();
      let image = vims.get(key);
      if (!image) {
        if (!VIMS.includes(key)) throw new Error(`no image ${name}.vim on the disk`);
        image = await picture(read, key, 320, 200);
        vims.set(key, image);
      }
      return image;
    },
  };
  // The terminal draws der.vim synchronously (./src/game/ui/talk/render.ts), so it is decoded up front.
  await assets.vim("der");
  return assets;
}
