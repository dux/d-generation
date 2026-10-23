// The native game's disk reads in the browser: floors from the bundled ./levels, the rest fetched from ./amiga
// relative to the page (`base`, the page's document.baseURI), so the game runs from any folder of a host.
export const FLOOR_FILES = import.meta.glob<string>("../../../levels/floor*.json5", { query: "?raw", import: "default" });

export function gameFileReader(base: string): (path: string) => Promise<Uint8Array> {
  return async (path) => {
    const floor = FLOOR_FILES[`../../../${path}`];
    if (floor) return new TextEncoder().encode(await floor());
    const res = await fetch(new URL(path, base));
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
