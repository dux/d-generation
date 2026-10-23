import { s32, u8 } from "../core/int.ts";
import type { PlayerCheckpoint, World, WorldPosition } from "../core/world.ts";

// nonvolatile.library as the game uses it: one 40-byte item "1" of application "DGEN" (g:2b0e..2b24).
export interface NonVolatileStore {
  // GetNVInfo nvi_FreeStorage in bytes (h0:150ea compares it with 0x3c).
  freeStorage(): number;
  // GetCopyNV: a copy of the item, or null when it does not exist.
  get(app: string, item: string): Uint8Array | null;
  // StoreNV: 0 on success, otherwise an NVERR code.
  store(app: string, item: string, data: Uint8Array): number;
  // DeleteNV: the result is ignored by h0:150ce.
  delete(app: string, item: string): void;
}

export const SAVE_APP = "DGEN";
export const SAVE_ITEM = "1";
export const SAVE_SIZE = 0x28;

// In-memory store with the free space of an empty NVRAM (used headless and when the host has no storage).
export class MemoryNonVolatile implements NonVolatileStore {
  readonly items = new Map<string, Uint8Array>();
  constructor(private readonly free = 1024) {}
  freeStorage(): number { return this.free; }
  get(app: string, item: string): Uint8Array | null { return this.items.get(`${app}/${item}`)?.slice() ?? null; }
  store(app: string, item: string, data: Uint8Array): number { this.items.set(`${app}/${item}`, data.slice()); return 0; }
  delete(app: string, item: string): void { this.items.delete(`${app}/${item}`); }
}

const POSITION = ["row", "column", "scene", "exitDirection", "spawnDirection", "entrySlot"] as const;
// h0:e6a/e7e: the 30 player bytes at g:8610, in memory order (longs big-endian).
const PLAYER: readonly (readonly [keyof PlayerCheckpoint, number])[] = [
  ["lives", 1], ["rescuedCount", 1], ["buildingFloor", 1], ["ammo", 1], ["throwableAvailable", 1], ["bombsFound", 1],
  ["spawnX", 1], ["spawnY", 1], ["spawnDirection", 1], ["portableLaserCount", 1], ["slowMotionCount", 1],
  ["shieldCount", 1], ["carriedBombs", 1], ["inventoryAvailability", 1], ["slowMotion", 1], ["playerPadding", 1],
  ["slowMotionTime", 4], ["invulnerable", 1], ["shieldPadding", 1], ["invulnerabilityTime", 4], ["paused", 1],
  ["specialItemCollected", 1], ["floorSecurityState", 1], ["floorSecurityCode", 1],
];

// h0:c7f8 copy loops: 6 bytes of g:8a28, then 30 bytes of g:8610. Bytes 36..39 are never written: on the Amiga
// they are whatever the stack held; the port stores zeros there.
export function encodeSave(position: WorldPosition, player: PlayerCheckpoint): Uint8Array {
  const bytes = new Uint8Array(SAVE_SIZE);
  POSITION.forEach((name, i) => { bytes[i] = name === "scene" ? u8(position.scene - 1) : u8(position[name]); });
  let at = 6;
  for (const [name, width] of PLAYER) {
    const value = player[name];
    for (let i = width - 1; i >= 0; i--) bytes[at + width - 1 - i] = (value >>> (i * 8)) & 255;
    at += width;
  }
  return bytes;
}

export function decodeSave(bytes: Uint8Array): { position: WorldPosition; player: PlayerCheckpoint } {
  if (bytes.length < 36) throw new Error(`AGA save image has ${bytes.length} bytes, expected ${SAVE_SIZE}`);
  const position = { row: 0, column: 0, scene: 0, exitDirection: 0, spawnDirection: 0, entrySlot: 0 };
  POSITION.forEach((name, i) => { position[name] = name === "scene" ? bytes[i] + 1 : bytes[i]; });
  const player = {} as PlayerCheckpoint;
  let at = 6;
  for (const [name, width] of PLAYER) {
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 256 + bytes[at + i];
    player[name] = width === 4 ? s32(value) : value;
    at += width;
  }
  return { position, player };
}

// h0:c7f8 (via h0:36dc) saveGame(): DeleteNV, then GetNVInfo free storage >= 60 and StoreNV of the 40-byte
// image (h0:d018 -> h0:150ea, length (0x28 + 9) / 10 tens). Returns 1 when stored; then h0:bdaa(scene + 1)
// makes the current scene's floor pack resident.
export function saveGame(world: World, store: NonVolatileStore): number {
  const position = world.state.checkpointPosition, player = world.state.checkpointPlayer;
  if (!position || !player) throw new Error("AGA save before the first checkpoint");
  const image = encodeSave(position, player);
  store.delete(SAVE_APP, SAVE_ITEM);
  if (store.freeStorage() < 0x3c) return 0;
  if (store.store(SAVE_APP, SAVE_ITEM, image) !== 0) return 0;
  world.loadFloorOf(world.position.scene);
  return 1;
}

// h0:c85c (via h0:3718) restoreGame(): GetCopyNV of the 40 bytes; on success h0:d006 -> h0:2060 resets the game
// first, then the bytes go back into g:8a28 and g:8610. Scene 0x84 forces checkpoint byte g:8616 (spawnY) to
// 0x68; scene 0x46 also loads the pack of scene 0x4a first.
export function restoreGame(world: World, store: NonVolatileStore, resetGame: () => void): number {
  const image = store.get(SAVE_APP, SAVE_ITEM);
  if (!image) return 0;
  resetGame();
  const { position, player } = decodeSave(image);
  world.state.checkpointPosition = position;
  world.state.checkpointPlayer = player;
  const index = position.scene - 1;
  if (index === 0x84) player.spawnY = 0x68;
  if (index === 0x46) world.loadFloorOf(0x4a);
  world.loadFloorOf(position.scene);
  return 1;
}

export interface GameConfig { words: number[] }

// h0:c9b2 (via h0:30ec) loadConfig(): DATA/DGEN.CFG (assets/config.json), 12 bytes into g:d980 unswapped. Word 0
// values 0, 1, 2 and 4 and a word 3 other than 8 end the game with fatal 0x12 (h0:508: "Hardware configuration
// has changed!").
export function checkConfig(words: readonly number[]): GameConfig {
  if (words.length < 6) throw new Error("Bad or missing file DATA/DGEN.CFG");
  if ([0, 1, 2, 4].includes(words[0]!) || words[3] !== 8) {
    throw new Error("Hardware configuration has changed!\nInstall/Reinstall D/Generation.");
  }
  return { words: [...words] };
}
