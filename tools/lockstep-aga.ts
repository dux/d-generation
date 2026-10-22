#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGame } from "../src/game/index.ts";
import type { Game } from "../src/game/core/game.ts";
import { compareFrame, describeFields } from "./lockstep/compare.ts";
import { importGame } from "./lockstep/import.ts";
import { InputTimeline, parseEvents } from "./lockstep/input.ts";
import { loadLayouts } from "./lockstep/layouts.ts";
import { readTruth } from "./lockstep/truth.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
interface Options { frames: number; from?: number; identity?: number[]; events?: string; truth?: string }

function options(args: readonly string[]): Options {
  const result: Options = { frames: 3000 };
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--events", "--truth", "--from", "--identity"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--events") result.events = resolve(value);
      else if (arg === "--truth") result.truth = resolve(value);
      else if (arg === "--from" && /^\d+$/.test(value)) result.from = Number(value);
      else if (arg === "--identity" && /^\d+(,\d+)*$/.test(value)) result.identity = [...new Set(value.split(",").map(Number))].sort((a, b) => a - b);
      else throw new Error(`invalid ${arg} value: ${value}`);
    } else if (!positional && /^\d+$/.test(arg)) {
      result.frames = Number(arg);
      positional = true;
    } else throw new Error("usage: bun tools/lockstep-aga.ts [frames] [--from frame] [--identity 0,500,1500,2500] [--events file] [--truth compact.jsonl.gz]");
  }
  if (![result.frames, result.from ?? 0, ...(result.identity ?? [])].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("frame numbers must be nonnegative safe integers");
  if (result.identity && result.from !== undefined) throw new Error("--identity and --from are separate modes");
  return result;
}

let cleanFrame = -1;
let comparingFrame = 0;
async function main(): Promise<void> {
  const args = options(process.argv.slice(2));
  const events = args.events ? parseEvents(await readFile(args.events, "utf8")) : [];
  // A boundary capture already contains the pokes of its frame; later pokes would change only the original.
  const lastPoke = Math.max(-1, ...events.filter(event => event.poke).map(event => event.frame!));
  if (lastPoke >= 0 && !args.identity && (args.from ?? -1) < lastPoke) throw new Error(`poke events reach frame ${lastPoke}; use --from ${lastPoke} or later`);
  const end = args.identity ? Math.max(...args.identity) : (args.from ?? 0) + args.frames;
  const truthPath = args.truth ?? resolve(root, "tmp", `lockstep-aga-${process.pid}.jsonl.gz`);
  if (!args.truth) {
    const command = ["uv", "run", "--with", "unicorn", "--with", "capstone", "python", "tools/m68k/snapshot.py", String(end), "--compact", truthPath];
    if (args.events) command.push("--events", args.events);
    console.log(`Capturing ${end + 1} AGA boundaries to ${truthPath}`);
    const capture = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
    const status = await capture.exited;
    if (status !== 0) throw new Error(`AGA truth harness exited with status ${status}`);
  }
  const layouts = await loadLayouts();
  describeFields(layouts);
  if (!layouts.globals.length || !layouts.actor.length) throw new Error("comparison layouts must not be empty");
  console.log("Alignment: frame 0 = first h0:7b2 attract boundary, raw scene 75 (room 76).");
  console.log(args.identity ? "Capture import identity; no simulation steps." : args.from !== undefined ? `Importing boundary ${args.from}; subsequent Game.frame calls receive only input, never truth.` : "Independent native bootstrap; truth never seeds Game state.");
  const read = async (path: string) => new Uint8Array(await readFile(resolve(root, path)));
  const input = new InputTimeline(events);
  // Tick-timed events (inside waits) reach the native game from its tick hook, like the harness tick().
  const attach = (target: Game) => {
    target.onTick = () => {
      const due = input.atTick(target.timers.state.clock);
      if (due) target.deliver(due);
    };
    return target;
  };
  let game: Game | undefined;
  if (args.from === undefined && !args.identity) {
    game = attach(await createGame(read, { demo: true }));
    game.boot();
  }
  const identities = new Set(args.identity);
  for await (const truth of readTruth(truthPath)) {
    comparingFrame = truth.record.frame;
    if (comparingFrame === 0) {
      if (truth.record.scene_index !== 75) throw new Error(`truth frame 0 scene ${truth.record.scene_index}, expected raw scene 75`);
      if (JSON.stringify(truth.record.events ?? []) !== JSON.stringify(events)) throw new Error("truth capture events differ from requested native events");
    }
    if (args.identity) {
      if (identities.has(comparingFrame)) {
        const restored = await importGame(read, truth, layouts);
        compareFrame(restored, truth, layouts);
        console.log(`Import identity PASS: frame ${comparingFrame}, room ${restored.room.scene}, ${restored.objects.slots.filter(Boolean).length} live objects.`);
        identities.delete(comparingFrame);
      }
      if (!identities.size) return;
      continue;
    }
    if (comparingFrame < (args.from ?? 0)) { input.at(comparingFrame); continue; }
    // Boundary events are already in the capture of their frame (the harness delivers them at h0:7b2).
    const step = input.at(comparingFrame);
    if (game) game.deliver(step);
    else {
      game = attach(await importGame(read, truth, layouts));
      input.atTick(truth.record.ticks); // already in the imported capture
    }
    compareFrame(game, truth, layouts);
    cleanFrame = comparingFrame;
    if (comparingFrame === end) {
      console.log(`No divergence from frame ${args.from ?? 0} through ${cleanFrame} (${args.frames} passes, ${truth.record.ticks} cooperative ticks).`);
      return;
    }
    try { game.frame({ joy: step.joy }); }
    catch (error) { throw new Error(`native frame ${comparingFrame} execution failed before boundary ${comparingFrame + 1}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
  throw new Error(`truth capture ended before requested boundary ${end}`);
}

try { await main(); }
catch (error) {
  console.error(`LOCKSTEP FAILED: ${error instanceof Error ? error.message : String(error)}`);
  console.error(cleanFrame < 0 ? `Furthest clean frame: none (boundary ${comparingFrame} has not matched).` : `Furthest clean frame: ${cleanFrame}.`);
  process.exitCode = 1;
}
