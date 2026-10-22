import { createGame, type Game } from "../../src/game/index.ts";
import { decodeObject, type ObjectSpec } from "../../src/formats/level.ts";
import type { Actor } from "../../src/game/core/model.ts";
import type { PlayerCheckpoint, WorldPosition } from "../../src/game/core/world.ts";
import type { Layouts } from "./compare.ts";
import type { FieldLayout } from "./layout/types.ts";
import { world } from "./layout/world.ts";
import { GLOBAL_BASE, POOL_BASE, POOL_STRIDE, VBLANK_DIVIDER, type TruthFrame } from "./truth.ts";

function assign(object: object, path: string, value: unknown): void {
  const parts = path.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) {
    let child = Reflect.get(target, part);
    if (child === null || child === undefined) {
      child = {};
      Reflect.set(target, part, child);
    }
    target = child as object;
  }
  Reflect.set(target, parts.at(-1)!, value);
}

function hydrate(game: Game, truth: TruthFrame, base: number, target: object, fields: readonly FieldLayout[]): void {
  const profiles = game.room.chunks.flatMap(chunk => chunk.kind === "dialogue" ? [chunk.dialogue] : []);
  for (const field of fields) {
    let value: unknown = truth.value(base, field);
    if (field.kind === "actor-slot" && value !== null) {
      const entry = value as number;
      let actor = game.objects.poolEntry(entry);
      if (!actor) {
        // A dangling pointer to a released entry: materialise the entry, then release it again.
        actor = game.objects.allocate(truth.read(POOL_BASE + entry * POOL_STRIDE + 2, 1), entry);
        game.objects.remove(actor);
        actor.classId = truth.read(POOL_BASE + entry * POOL_STRIDE + 2, 1);
      }
      value = actor;
    }
    if (field.kind === "profile-index" && value !== null) {
      const profile = profiles[value as number];
      if (!profile) throw new Error(`capture profile ${value} absent in native scene ${game.room.scene}`);
      value = profile;
    }
    assign(target, field.name, value);
  }
}

// h0:1c38/234a: up to twenty saved rooms, thirty compact four-byte object records each.
export function savedRoomRecords(truth: TruthFrame): Map<number, ObjectSpec[]> {
  const rooms = new Map<number, ObjectSpec[]>();
  const count = truth.read(GLOBAL_BASE + 0x4b4, 1);
  if (count > 20) throw new Error(`invalid saved-room count ${count}`);
  for (let room = 0; room < count; room++) {
    const scene = truth.read(GLOBAL_BASE + 0x9c61 + room, 1) + 1;
    const records: ObjectSpec[] = [];
    for (let record = 0; record < 30; record++) {
      const at = GLOBAL_BASE + 0x9301 + room * 120 + record * 4;
      const bytes = Uint8Array.from({ length: 4 }, (_, byte) => truth.read(at + byte, 1));
      if (!((bytes[0]! & 0x0f) | (bytes[0]! & 0x80))) break;
      records.push(decodeObject(bytes));
    }
    rooms.set(scene, records);
  }
  return rooms;
}

// Tool-only restoration. No truth representation, offset, or capture reader enters game code.
export async function importGame(read: (path: string) => Promise<Uint8Array>, truth: TruthFrame, layouts: Layouts): Promise<Game> {
  const scene = truth.read(GLOBAL_BASE + 0x4e4, 2) + 1;
  const game = await createGame(read, { scene, demo: true, restore: true });
  game.objects.clear();
  for (let slot = 0; slot < truth.record.slots.length; slot++) {
    const address = truth.record.slots[slot]!;
    if (!address) continue;
    const poolIndex = (address - POOL_BASE) / POOL_STRIDE;
    if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex >= 30) throw new Error(`object outside AGA pool: 0x${address.toString(16)}`);
    game.objects.allocate(truth.read(address + 2, 1), poolIndex, slot);
  }
  hydrate(game, truth, GLOBAL_BASE, game.state, layouts.globals);
  game.timers.state.vblankDivider = truth.read(VBLANK_DIVIDER, 2, true);
  game.state.messageText = truth.text(GLOBAL_BASE + 0xdb1e, 255);
  // The 50 Hz pacing clock is host time, not original memory: it starts from the harness tick count.
  game.timers.state.clock = truth.record.ticks;
  for (let slot = 0; slot < truth.record.slots.length; slot++) {
    const actor = game.objects.slots[slot];
    if (!actor) continue;
    const address = truth.record.slots[slot]!;
    const fields = layouts.classes.get(actor.classId);
    if (!fields) throw new Error(`capture class ${actor.classId} has no layout`);
    hydrate(game, truth, address, actor, layouts.actor);
    hydrate(game, truth, address, actor, fields);
  }
  game.world.state.position = {} as WorldPosition;
  game.world.state.checkpointPosition = {} as WorldPosition;
  game.world.state.roomEntryPlayer = {} as PlayerCheckpoint;
  game.world.state.checkpointPlayer = {} as PlayerCheckpoint;
  hydrate(game, truth, GLOBAL_BASE, game.world.state, world);
  game.world.state.visited = game.state.visited;
  // Resident directory g:dcfc identifies the loaded pack independently of current scene.
  const firstScene = truth.read(GLOBAL_BASE + 0xdcfc, 2);
  const floor = game.world.floors.find(candidate => candidate.rooms[0]?.scene === firstScene);
  if (!floor) throw new Error(`resident AGA pack starting at scene ${firstScene} is missing`);
  game.world.state.currentFloor = floor.floor;
  for (let i = 0; i < 130; i++) {
    const at = GLOBAL_BASE + 0x8ede + i * 8;
    Object.assign(game.runtimeRoom.cells[i]!, {
      walls: truth.read(at, 1), floorLines: truth.read(at + 1, 1), wallVariants: truth.read(at + 2, 2),
      tiles: truth.read(at + 4, 1), padding: truth.read(at + 5, 1), tileVariants: truth.read(at + 6, 2),
    });
  }
  for (let i = 0; i < game.state.occupancy.length; i++) {
    const mask = truth.read(GLOBAL_BASE + 0x19b4 + (i & 7), 1);
    game.state.occupancy[i] = truth.read(GLOBAL_BASE + 0x8a30 + (i >> 3), 1) & mask ? 1 : 0;
  }
  game.state.occupancyScene = game.room.scene;
  game.savedRooms.clear();
  for (const [room, records] of savedRoomRecords(truth)) game.savedRooms.set(room, records);
  game.objects.restore({
    ...game.objects.snapshot(),
    roomSaveBuffers: Array.from({ length: 20 }, (_, room) =>
      Uint8Array.from({ length: 120 }, (_, byte) => truth.read(GLOBAL_BASE + 0x9301 + room * 120 + byte, 1))),
  });
  game.demo.restore({
    directions: Array.from({ length: 500 }, (_, i) => {
      const at = GLOBAL_BASE + 0x9e2e + i * 6;
      return { time: truth.read(at, 4), direction: truth.read(at + 4, 1), magnitude: truth.read(at + 5, 1) };
    }),
    buttons: Array.from({ length: 900 }, (_, i) => {
      const at = GLOBAL_BASE + 0xa9ec + i * 6;
      return { time: truth.read(at, 4), code: truth.read(at + 4, 1) };
    }),
  });
  game.events.length = 0;
  return game;
}
