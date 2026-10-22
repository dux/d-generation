import { parseFloor } from "../formats/level.ts";
import { Game, type GameOptions } from "./core/game.ts";
import { checkConfig } from "./ui/save.ts";

export { Game } from "./core/game.ts";
export type { GameOptions, GameSnapshot } from "./core/game.ts";
export { GameInterrupt } from "./core/game.ts";
export type { Actor, ActorContext, ActorMessage, FrameInput, GameEvent, GameState, MusicTrack } from "./core/model.ts";
export type { NonVolatileStore } from "./ui/save.ts";
export { MemoryNonVolatile } from "./ui/save.ts";
export { Gfx } from "./render/gfx.ts";
export { renderGame, renderPalette } from "./render/game.ts";

// Disk data enters through the host reader; no engine or emulated-memory dependency. Without `scene` the game
// starts at program entry: call game.boot() (it runs the intro) before the first game.frame().
export async function createGame(read: (path: string) => Promise<Uint8Array>, options: GameOptions = {}): Promise<Game> {
  const decoder = new TextDecoder();
  const floors = await Promise.all(Array.from({ length: 10 }, async (_, i) =>
    parseFloor(decoder.decode(await read(`levels/floor${String(i + 1).padStart(2, "0")}.json5`)))));
  const sequences = new Map(await Promise.all([50, 52].map(async sequence =>
    [sequence, await read(`amiga/aga/DATA/DEMO${sequence}.SEQ`)] as const)));
  // h0:2730 -> h0:30ec -> h0:c9b2: a wrong DGEN.CFG ends the program before the title.
  checkConfig(await read("amiga/aga/DATA/DGEN.CFG"));
  return new Game(floors, sequences, options);
}
