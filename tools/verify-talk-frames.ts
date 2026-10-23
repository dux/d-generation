#!/usr/bin/env bun
// Import game state and colour registers at --from, then compare displayed pixels and evolving palettes at later ticks.
// Usage: bun tools/verify-talk-frames.ts --events file --from N --ticks N,N [--out tmp/talk2-pixels]
import { mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Game } from "../src/game/core/game.ts";
import { renderGame, renderPalette } from "../src/game/render/game.ts";
import { loadAgaAssets } from "../src/game/render/assets.ts";
import { roomImage } from "../src/game/render/room.ts";
import { Screen } from "../src/render/screen.ts";
import { compareFrame } from "./lockstep/compare.ts";
import { importGame } from "./lockstep/import.ts";
import { InputTimeline, parseEvents } from "./lockstep/input.ts";
import { loadLayouts } from "./lockstep/layouts.ts";
import { readTruth } from "./lockstep/truth.ts";
import { compareScreen, readCapture, tickLabel, writeDiff, type Picture } from "./verify-ui-frames.ts";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const eventsPath = value("--events");
const from = Number(value("--from") ?? 0);
const ticks = (value("--ticks") ?? "").split(",").filter(Boolean).map(Number).sort((a, b) => a - b);
if (!eventsPath || !ticks.length || ![from, ...ticks].every(n => Number.isSafeInteger(n) && n >= 0)) {
  throw new Error("give --events file --from N --ticks N,N");
}
const events = parseEvents(await readFile(eventsPath, "utf8"));
const lastPoke = Math.max(-1, ...events.filter(event => event.poke).map(event => event.frame!));
if (from < lastPoke) throw new Error(`import must follow last poke ${lastPoke}`);
const out = resolve(root, value("--out") ?? `tmp/talk2-pixels-${basename(eventsPath, ".json")}`);
await mkdir(out, { recursive: true });
async function run(command: string[]): Promise<void> {
  const status = await Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" }).exited;
  if (status) throw new Error(`${command[0]} exited ${status}`);
}
const python = ["uv", "run", "--with", "unicorn", "--with", "capstone", "python"];
const truthPath = resolve(out, "boundary.jsonl.gz");
await run([...python, "tools/m68k/snapshot.py", String(from), "--compact", truthPath, "--events", eventsPath]);
await run([...python, "tools/m68k/capture_display.py", "--frames", String(from), "--ticks", ticks.join(","), "--events", eventsPath, "--out", out]);
const read = async (path: string) => new Uint8Array(await readFile(resolve(root, path)));
const layouts = await loadLayouts();
const assets = await loadAgaAssets(read);
const input = new InputTimeline(events);
const natives = new Map<number, Picture>();
const screen = new Screen();
let game: Game | undefined;
for await (const truth of readTruth(truthPath)) {
  input.at(truth.record.frame);
  if (truth.record.frame !== from) continue;
  game = await importGame(read, truth, layouts);
  compareFrame(game, truth, layouts);
  input.atTick(truth.record.ticks);
}
if (!game) throw new Error(`missing boundary ${from}`);
const initial = readCapture(`f${String(from).padStart(5, "0")}`, out);
if (!initial) throw new Error(`missing display state at boundary ${from}`);
game.paletteWrites.clear();
for (let i = 0; i < initial.palette.length; i++) game.paletteWrites.set(i, initial.palette[i]!);
if (ticks[0]! <= game.timers.state.clock) throw new Error("capture ticks must follow imported boundary");
const image = roomImage(game.room.scene);
if (image) await assets.vim(image);
const stop = Symbol("captured");
// Render every tick like the browser host, so a prompt opened inside a pass covers the view of that pass.
game.onTick = () => {
  const clock = game!.timers.state.clock;
  const due = input.atTick(clock);
  if (due) game!.deliver(due);
  renderGame(screen, game!, assets);
  if (!ticks.includes(clock)) return;
  natives.set(clock, { pixels: screen.pixels.slice(), palette: renderPalette(game!, assets).slice() });
  const ops = game!.state.talk.display;
  const text = ops.flatMap(op => op.op === "text" || op.op === "wrap" ? [op.text] : []).slice(-4);
  console.log(`Native tick ${clock}: room ${game!.room.scene}, ${ops.length} display operations, text ${JSON.stringify(text)}`);
  if (clock === ticks.at(-1)) throw stop;
};
try {
  for (let frame = from; ; frame++) {
    const step = input.at(frame);
    game.deliver(step);
    game.frame({ joy: step.joy });
  }
} catch (error) { if (error !== stop) throw error; }
let failed = 0;
for (const tick of ticks) {
  const native = natives.get(tick), truth = readCapture(tickLabel(tick), out);
  if (!native || !truth) throw new Error(`missing tick ${tick}`);
  const diff = compareScreen(native, truth);
  writeDiff(resolve(out, `${tickLabel(tick)}.png`), native, truth, diff.mismatch);
  const rows = new Map<number, number>();
  for (let i = 0; i < diff.mismatch.length; i++) {
    if (!diff.mismatch[i]) continue;
    const y = Math.floor(i / truth.width);
    rows.set(y, (rows.get(y) ?? 0) + 1);
  }
  if (rows.size) console.log(`Differing pixels by row: ${JSON.stringify([...rows])}`);
  console.log(`Tick ${tick}: ${diff.pixels} pixel differences, ${diff.colors} palette differences${diff.firstPixel ? `; first ${JSON.stringify(diff.firstPixel)}` : ""}${diff.firstColor ? `; first color ${JSON.stringify(diff.firstColor)}` : ""}`);
  if (diff.pixels || diff.colors) failed++;
}
console.log(`${ticks.length - failed}/${ticks.length} displayed pictures identical; PNGs: ${out}`);
process.exitCode = failed ? 1 : 0;
