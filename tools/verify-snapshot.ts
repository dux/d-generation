// Checks Game.snapshot()/restore(): a game restored from a snapshot (into a fresh game and into the game that took
// it) must replay the following main-loop passes exactly like the original run, state and events.
// Usage: bun tools/verify-snapshot.ts [--at 400] [--frames 600] [--new]
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createGame, type Game, type GameEvent, type GameSnapshot } from "../src/game/index.ts";

const { values: args } = parseArgs({
  options: { at: { type: "string", default: "400" }, frames: { type: "string", default: "600" }, new: { type: "boolean", default: false } },
});
const at = Number(args.at), frames = Number(args.frames);
const root = resolve(import.meta.dir, "..");
const read = async (path: string) => new Uint8Array(await readFile(resolve(root, path)));
const options = { demo: !args.new };

interface Step { snapshot: GameSnapshot; events: GameEvent[] }

function run(game: Game, count: number): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) {
    game.frame();
    steps.push({ snapshot: game.snapshot(), events: game.events.splice(0) });
  }
  return steps;
}

function compare(label: string, expected: Step[], actual: Step[]): boolean {
  for (let i = 0; i < expected.length; i++) {
    if (!Bun.deepEquals(expected[i]!.snapshot, actual[i]!.snapshot, true)) {
      console.log(`${label}: state differs ${i + 1} passes after the snapshot`);
      for (const key of Object.keys(expected[i]!.snapshot.state) as (keyof GameSnapshot["state"])[]) {
        if (!Bun.deepEquals(expected[i]!.snapshot.state[key], actual[i]!.snapshot.state[key], true)) console.log(`  state.${key}`);
      }
      for (const key of Object.keys(expected[i]!.snapshot) as (keyof GameSnapshot)[]) {
        if (key !== "state" && !Bun.deepEquals(expected[i]!.snapshot[key], actual[i]!.snapshot[key], true)) console.log(`  ${key}`);
      }
      return false;
    }
    if (!Bun.deepEquals(expected[i]!.events, actual[i]!.events, true)) {
      console.log(`${label}: events differ ${i + 1} passes after the snapshot`);
      return false;
    }
  }
  console.log(`${label}: ${expected.length} passes identical`);
  return true;
}

const game = await createGame(read, options);
game.boot();
for (let i = 0; i < at; i++) game.frame();
game.events.length = 0;
const snapshot = game.snapshot();
const scenes = new Set<number>();
const expected = run(game, frames);
for (const step of expected) scenes.add(step.snapshot.room.scene);
console.log(`snapshot after pass ${at} (scene ${snapshot.room.scene}, clock ${snapshot.timers.clock}); scenes after it: ${[...scenes].join(", ")}`);

const fresh = await createGame(read, options);
fresh.restore(snapshot);
let ok = compare("fresh game", expected, run(fresh, frames));
game.restore(snapshot);
ok = compare("same game", expected, run(game, frames)) && ok;
// The snapshot is plain data: a structured clone (IndexedDB, postMessage) restores the same way.
const cloned = await createGame(read, options);
cloned.restore(structuredClone(snapshot));
ok = compare("cloned snapshot", expected, run(cloned, frames)) && ok;
process.exit(ok ? 0 : 1);
