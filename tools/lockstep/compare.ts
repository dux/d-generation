import type { Actor } from "../../src/game/core/model.ts";
import type { ObjectSpec, Room } from "../../src/formats/level.ts";
import { savedRoomRecords } from "./import.ts";
import type { FieldLayout } from "./layout/types.ts";
import { GLOBAL_BASE, SLOT_COUNT, VBLANK_DIVIDER, type TruthFrame } from "./truth.ts";
import { world } from "./layout/world.ts";
import type { RuntimeRoom } from "../../src/game/core/model.ts";

export interface ComparedGame {
  readonly state: object;
  readonly objects: { readonly slots: readonly (Actor | null)[] };
  readonly room: Room;
  readonly world: { readonly state: object };
  readonly runtimeRoom: RuntimeRoom;
  readonly savedRooms: ReadonlyMap<number, readonly ObjectSpec[]>;
}

export interface Layouts {
  readonly globals: readonly FieldLayout[];
  readonly actor: readonly FieldLayout[];
  readonly classes: ReadonlyMap<number, readonly FieldLayout[]>;
}

function property(object: unknown, path: string): unknown {
  let value = object;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !(part in value)) {
      throw new Error(`native field ${path} is missing`);
    }
    value = Reflect.get(value, part);
  }
  return value;
}

function actualValue(object: object, field: FieldLayout, slots: readonly (Actor | null)[], room: Room): unknown {
  const value = property(object, field.name);
  if (field.kind === "profile-index") {
    if (value === null) return null;
    let index = 0;
    for (const chunk of room.chunks) {
      if (chunk.kind !== "dialogue") continue;
      if (chunk.dialogue === value) return index;
      index++;
    }
    throw new Error(`native ${field.name} refers outside current room dialogue profiles`);
  }
  if (field.kind !== "actor-slot") return value;
  if (value === null) return null;
  if (typeof value !== "object" || !("poolIndex" in value)) throw new Error(`native ${field.name} is not an actor reference`);
  return value.poolIndex;
}

function show(value: unknown): string {
  if (typeof value === "number") return `${value} (0x${(value >>> 0).toString(16)})`;
  return String(value);
}

function compareFields(truth: TruthFrame, base: number, object: object, fields: readonly FieldLayout[], label: string, slots: readonly (Actor | null)[], room: Room, errors?: string[]): void {
  for (const field of fields) {
    const expected = truth.value(base, field);
    let actual: unknown;
    try {
      actual = actualValue(object, field, slots, room);
    } catch (error) {
      throw new Error(`frame ${truth.record.frame}: ${label}.${field.name}: expected ${show(expected)}, actual unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
    if (actual !== expected) {
      const message = `frame ${truth.record.frame}: ${label}.${field.name} @0x${(base + field.offset).toString(16)} width=${field.width}: expected ${show(expected)}, actual ${show(actual)}`;
      if (!errors) throw new Error(message);
      errors.push(message);
    }
  }
}

// errors: collect every scalar field difference instead of stopping at the first (diagnostics only).
export function compareFrame(game: ComparedGame, truth: TruthFrame, layouts: Layouts, errors?: string[]): void {
  const slots = game.objects.slots;
  if (slots.length !== SLOT_COUNT) throw new Error(`frame ${truth.record.frame}: native object slot count ${slots.length}, expected ${SLOT_COUNT}`);
  compareFields(truth, GLOBAL_BASE, game.state, layouts.globals, "global", slots, game.room, errors);
  compareFields(truth, GLOBAL_BASE, game.world.state, world, "world", slots, game.room, errors);
  compareFields(truth, VBLANK_DIVIDER, game.state, [{ name: "timers.state.vblankDivider", offset: 0, width: 2, signed: true }], "h10", slots, game.room, errors);
  const cellFields: readonly FieldLayout[] = [
    { name: "walls", offset: 0, width: 1 },
    { name: "floorLines", offset: 1, width: 1 },
    { name: "wallVariants", offset: 2, width: 2 },
    { name: "tiles", offset: 4, width: 1 },
    { name: "padding", offset: 5, width: 1 },
    { name: "tileVariants", offset: 6, width: 2 },
  ];
  for (let cell = 0; cell < 130; cell++) {
    compareFields(truth, GLOBAL_BASE + 0x8ede + cell * 8, game.runtimeRoom.cells[cell]!, cellFields, `room cell ${cell}`, slots, game.room, errors);
  }
  const message = truth.text(GLOBAL_BASE + 0xdb1e, 255);
  if (message !== property(game.state, "messageText")) throw new Error(`frame ${truth.record.frame}: global.messageText @0x3cdb1e: expected ${JSON.stringify(message)}, actual ${JSON.stringify(property(game.state, "messageText"))}`);
  const saved = savedRoomRecords(truth);
  const scenes = (rooms: ReadonlyMap<number, unknown>) => [...rooms.keys()].sort((a, b) => a - b).join(",");
  if (scenes(saved) !== scenes(game.savedRooms)) throw new Error(`frame ${truth.record.frame}: saved rooms: expected [${scenes(saved)}], actual [${scenes(game.savedRooms)}]`);
  for (const [scene, records] of saved) {
    const expected = JSON.stringify(records), actual = JSON.stringify(game.savedRooms.get(scene));
    if (expected !== actual) throw new Error(`frame ${truth.record.frame}: saved room ${scene}: expected ${expected}, actual ${actual}`);
  }
  const occupancy = property(game.state, "occupancy") as Uint8Array;
  for (let i = 0; i < occupancy.length; i++) {
    const mask = truth.read(GLOBAL_BASE + 0x19b4 + (i & 7), 1);
    const expected = truth.read(GLOBAL_BASE + 0x8a30 + (i >> 3), 1) & mask ? 1 : 0;
    if (occupancy[i] !== expected) throw new Error(`frame ${truth.record.frame}: occupancy.${i}: expected ${expected}, actual ${occupancy[i]}`);
  }
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const address = truth.record.slots[slot]!;
    const native = slots[slot];
    if (!address !== !native) {
      throw new Error(`frame ${truth.record.frame}: object slot ${slot} occupancy: expected ${address ? "occupied" : "empty"}, actual ${native ? "occupied" : "empty"}`);
    }
    if (!address || !native) continue;
    const classId = truth.read(address + 2, 1);
    if (native.classId !== classId) throw new Error(`frame ${truth.record.frame}: object slot ${slot}.classId: expected ${classId}, actual ${native.classId}`);
    const fields = layouts.classes.get(classId);
    if (!fields) throw new Error(`frame ${truth.record.frame}: object slot ${slot}: class ${classId} has no mapped class layout`);
    compareFields(truth, address, native, layouts.actor, `object slot ${slot} class ${classId}`, slots, game.room, errors);
    compareFields(truth, address, native, fields, `object slot ${slot} class ${classId}`, slots, game.room, errors);
  }
}

export function describeFields(layouts: Layouts): void {
  const describe = (fields: readonly FieldLayout[]) => fields.map(field => `${field.name}@${field.offset.toString(16)}:${field.signed ? "s" : "u"}${field.width * 8}${field.kind && field.kind !== "scalar" ? `/${field.kind}` : ""}`).join(", ");
  console.log(`Compared globals (${layouts.globals.length}): ${describe(layouts.globals)}`);
  console.log(`Compared common actor fields (${layouts.actor.length}): ${describe(layouts.actor)}`);
  for (const [id, fields] of [...layouts.classes].sort(([a], [b]) => a - b)) {
    console.log(`Compared class ${id} fields (${fields.length} plus common): ${describe(fields)}`);
  }
}
