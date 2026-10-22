// Runs every lockstep scenario in ./tools/scenarios against a fresh capture of the original.
// Usage: bun run scenarios [name-substring ...]
import { availableParallelism } from "node:os";
import { join } from "node:path";

const DIR = join(import.meta.dir, "scenarios");
const manifest: Record<string, { frames: number; from?: number }> = await Bun.file(join(DIR, "index.json")).json();
const filters = Bun.argv.slice(2);
const names = Object.keys(manifest).filter((name) => !filters.length || filters.some((f) => name.includes(f)));

async function run(name: string): Promise<boolean> {
  const { frames, from } = manifest[name]!;
  const args = ["tools/lockstep-aga.ts", String(frames), ...(from === undefined ? [] : ["--from", String(from)]), "--events", join(DIR, `${name}.json`)];
  const proc = Bun.spawn(["bun", ...args], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  const ok = (await proc.exited) === 0 && out.includes("No divergence");
  const result = out.split("\n").filter((line) => /No divergence|LOCKSTEP FAILED|Furthest clean|Error/.test(line)).slice(0, 2).join(" | ");
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${result}`);
  return ok;
}

const queue = [...names];
const failed: string[] = [];
const workers = Array.from({ length: Math.max(1, Math.floor(availableParallelism() / 2)) }, async () => {
  for (let name = queue.shift(); name; name = queue.shift()) if (!(await run(name))) failed.push(name);
});
await Promise.all(workers);
console.log(`${names.length - failed.length}/${names.length} scenarios without divergence`);
if (failed.length) {
  console.log(`failed: ${failed.join(", ")}`);
  process.exitCode = 1;
}
