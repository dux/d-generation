// The native game's disk reads in the browser: floors from the bundled ./levels, the rest fetched from ./amiga
// (served from the repository root in dev, copied next to the bundle by the build).
export const FLOOR_FILES = import.meta.glob<string>("../../../levels/floor*.json5", { query: "?raw", import: "default" });

export async function readGameFile(path: string): Promise<Uint8Array> {
  const floor = FLOOR_FILES[`../../../${path}`];
  if (floor) return new TextEncoder().encode(await floor());
  const res = await fetch(`/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
