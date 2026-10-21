import { parseDeltaSet, type DeltaSet } from "./formats/delta.ts";
import { parsePalette, type Palette } from "./formats/palette.ts";
import { deltaSetFor, parseScene, type Scene } from "./formats/scene.ts";
import { parseShapeFile, type ShapeSet } from "./formats/shape.ts";
import type { RoomAssets } from "./render/room.ts";

// Reads a file relative to the DOS game folder (dgener/), e.g. "VGA/PLY.VGA".
export type ReadFile = (path: string) => Promise<Uint8Array>;

export const SHAPE_NAMES = [
  "ANM", "ART", "BAR", "CGEN", "CUB", "DEC", "DGEN", "DOOR", "ELC", "EXP", "GRE", "HED", "INVEN",
  "LASER", "LEG", "LIFT", "ORB", "PAN", "PLY", "SHEAD", "SHPLY", "SLI", "SPECIAL", "SPK", "SQU",
  "SQUASH", "SUR", "SWITCH", "TEL", "TEXTSHP", "TILE", "TRK", "TUB", "TWALL", "VCUB", "VEN", "WALL", "WMSK",
];

export const DELTA_SET_NUMBERS = [0, 1, 2, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32, 33, 40, 50, 51, 60, 99];

export const PALETTE_NAMES = ["DGEN", "TITLE", "RED", "GREEN", "BLUE"] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

// Scheme palette per room scheme value (GAME.EXE 0:149a).
export const SCHEME_PALETTES: Record<0 | 1 | 3, PaletteName> = { 0: "BLUE", 1: "GREEN", 3: "RED" };

export class GameData {
  private cache = new Map<string, Promise<unknown>>();

  constructor(private read: ReadFile) {}

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (!hit) this.cache.set(key, (hit = load()));
    return hit;
  }

  shapes(name: string): Promise<ShapeSet[]> {
    return this.memo(`shape:${name}`, async () => parseShapeFile(await this.read(`VGA/${name}.VGA`)));
  }

  palette(name: PaletteName): Promise<Palette> {
    return this.memo(`pal:${name}`, async () => parsePalette(await this.read(`DATA/${name}.PAL`)));
  }

  deltaSet(n: number): Promise<DeltaSet> {
    return this.memo(`dlt:${n}`, async () => parseDeltaSet(await this.read(`DATA/DLTSET${n}.DAT`)));
  }

  scene(n: number): Promise<Scene> {
    return this.memo(`scene:${n}`, async () => parseScene(await this.read(`DATA/SCENE${n}.DLT`)));
  }

  backdrop(): Promise<Uint8Array> {
    return this.memo("back", () => this.read("DATA/BACK1.DAT"));
  }

  async roomAssets(sceneNumber: number): Promise<RoomAssets> {
    const [tile, wall, tallWall, deltas, backdrop] = await Promise.all([
      this.shapes("TILE"),
      this.shapes("WALL"),
      this.shapes("TWALL"),
      this.deltaSet(deltaSetFor(sceneNumber)),
      this.backdrop(),
    ]);
    return { tile: tile[0].root, wall: wall[0].root, tallWall: tallWall[0].root, deltas, backdrop };
  }
}
