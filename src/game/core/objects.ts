import { decodeObject, encodeObject, type ObjectSpec } from "../../formats/level.ts";
import { s8, u8, u16 } from "./int.ts";
import type { Actor, ActorClass, ActorContext, ActorMessage } from "./model.ts";
import { updateBounds } from "./geometry.ts";
import type { DoorActor } from "../actors/door.ts";
import type { GeneratorActor } from "../actors/cgen.ts";
import type { VentActor } from "../actors/ven.ts";
import type { ArtActor } from "../actors/art.ts";
import { showMessage } from "./messages.ts";

export const SLOT_COUNT = 30;
export const CLASS_NAMES = ["player", "sur-marker", "door", "tel", "switch", "squ", "orb", "cub", "entry", "sur", "trk", "art", "dec", "ven", "pan", "tub", "elc", "exp", "lift", "bomb", "laser", "bar", "cgen", "sli", "hed", "anm", "dgen", "unknown-27"] as const;
const FIRST_LAYER = [0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CLASS_FLAGS = [18, 9, 24, 16, 12, 12, 22, 15, 12, 15, 15, 10, 15, 15, 10, 20, 22, 28, 9, 6, 6, 9, 20, 12, 5, 10, 20, 10];
const POST_NULL = new Set([8]);
const SAVE_EXCLUDED = new Set([0, 8, 16, 17, 19, 20]);

export interface ObjectSlots {
  slots: (Actor | null)[];
  pool: (Actor | null)[];
  storage: (Actor | null)[];
  roomSaveBuffers: Uint8Array[];
}

// g:426: descriptors retain the original 28-class index, including absent ports.
export interface ClassDescriptor {
  readonly id: number;
  readonly name: string;
  readonly handlers: ActorClass | null;
}

export function classId(spec: ObjectSpec): number {
  const id = CLASS_NAMES.indexOf(spec.class as typeof CLASS_NAMES[number]);
  return id >= 0 ? id : Number(spec.class.replace("unknown-", ""));
}

export class ObjectSystem {
  readonly slots: (Actor | null)[] = Array(SLOT_COUNT).fill(null);
  readonly pool: (Actor | null)[] = Array(SLOT_COUNT).fill(null);
  private readonly storage: (Actor | null)[] = Array(SLOT_COUNT).fill(null);
  readonly classes: ClassDescriptor[];
  context!: ActorContext;
  readonly savedRooms = new Map<number, ObjectSpec[]>();
  // h11:9301: twenty buffers of thirty four-byte records, kept as bytes because records past a buffer's terminator
  // stay from earlier saves and the original reads them (h0:23ce clears only the terminator's class byte).
  private roomSaveBuffers: Uint8Array[] = [];

  constructor(classes: readonly ActorClass[]) {
    this.classes = CLASS_NAMES.map((name, id) => ({ id, name, handlers: classes.find(c => c.id === id) ?? null }));
  }

  // h0:1996: claim a list slot and a 258-byte pool entry cleared to zero; class fields start at zero as well.
  // Pool entries keep their object identity across reuse, like the fixed g:660c array.
  allocate(id: number, poolIndex = this.pool.indexOf(null), slot = this.slots.indexOf(null)): Actor {
    const handlers = this.classes[id]?.handlers;
    if (!handlers) throw new Error(`class ${id} ${this.classes[id]?.name ?? "unknown"} not ported`);
    if (slot < 0 || slot >= SLOT_COUNT || this.slots[slot]) throw new Error(`AGA object slot ${slot} is not free`);
    if (poolIndex < 0 || poolIndex >= SLOT_COUNT || this.pool[poolIndex]) throw new Error("AGA object pool has no free entry");
    const initial: Actor = {
      id: 0, classId: id, poolIndex, removed: 0, x: 0, y: 0, previousX: 0, previousY: 0,
      direction: 0, frame: 0, flags: 0, firstLayer: 0, packedPosition: 0, previousPackedPosition: 0,
      moved: 0, speed: 0, height: 0, facing: 0, previousHeight: 0, movementHeading: 0,
      collisionDisabled: 0, activeThreat: 0, noTurn: 0, ownerId: 0, ignoredClass: 0, triggerOnly: 0,
      boundsLeft: 0, boundsTop: 0, boundsRight: 0, boundsBottom: 0,
      outerLeft: 0, outerTop: 0, outerRight: 0, outerBottom: 0,
      spriteEnabled: [0, 0, 0], spriteMirror: 0, spriteScheme: 0, spriteSets: [], spritePaths: [],
      spriteOffsetX: [0, 0, 0], spriteOffsetY: [0, 0, 0], spriteMirrorWidth: [0, 0, 0], spriteShade: 0, drawSuppressed: 0,
      ...handlers.createState?.(),
    };
    const actor = this.storage[poolIndex] ?? initial;
    if (actor !== initial) {
      for (const key of Object.keys(actor)) Reflect.deleteProperty(actor, key);
      Object.assign(actor, initial);
    }
    this.storage[poolIndex] = actor;
    this.slots[slot] = this.pool[poolIndex] = actor;
    return actor;
  }

  // h0:1878/h0:1a16: first free list slot, then the record's class, position and flags, then class init.
  spawn(spec: ObjectSpec): Actor | null;
  spawn(id: number, spec: ObjectSpec): Actor | null;
  spawn(idOrSpec: number | ObjectSpec, supplied?: ObjectSpec): Actor | null {
    const spec = typeof idOrSpec === "number" ? supplied! : idOrSpec;
    const id = typeof idOrSpec === "number" ? idOrSpec : classId(spec);
    const handlers = this.classes[id]?.handlers;
    if (!handlers) throw new Error(`class ${id} ${this.classes[id]?.name ?? spec.class} not ported`);
    if (!this.slots.includes(null)) return null;
    const actor = this.allocate(id);
    const state = this.context.state;
    const direction = spec.params.orientation ?? 0;
    Object.assign(actor, {
      id: state.nextObjectId, x: u16(spec.x * 256), y: u16(spec.y * 256),
      previousX: u16(Math.floor(spec.x) << 8), previousY: u16(Math.floor(spec.y) << 8), // h0:1878: integer byte only
      direction, facing: direction, flags: CLASS_FLAGS[id], firstLayer: FIRST_LAYER[id],
      movementHeading: 255, ignoredClass: 255, spriteEnabled: [1, 0, 0],
    });
    state.nextObjectId = u16(state.nextObjectId + 1);
    handlers.init(this.context, actor, spec);
    updateBounds(actor);
    return actor;
  }

  // Pool entries keep their identity after release: globals such as g:85d0 may still point at a freed entry.
  poolEntry(index: number): Actor | null {
    return this.storage[index] ?? null;
  }

  // The update list, the live pool and every pool entry ever allocated (Game.snapshot clones them together, so
  // actor references between them and from the game state stay shared).
  snapshot(): ObjectSlots {
    return { slots: this.slots, pool: this.pool, storage: this.storage, roomSaveBuffers: this.roomSaveBuffers };
  }

  restore(data: ObjectSlots): void {
    if (data.slots.length !== SLOT_COUNT || data.pool.length !== SLOT_COUNT || data.storage.length !== SLOT_COUNT) {
      throw new Error("AGA object snapshot has the wrong slot count");
    }
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.slots[i] = data.slots[i]!;
      this.pool[i] = data.pool[i]!;
      this.storage[i] = data.storage[i]!;
    }
    this.roomSaveBuffers = data.roomSaveBuffers;
  }

  // h0:16ba/h0:1704: release the slot and pool entry, not a deferred tombstone. Pointers to the entry (g:85c8 the
  // player, among others) are left as they are: only h0:179c and the player's death (h0:521c) clear g:85c8.
  remove(actor: Actor): void {
    const index = this.slots.indexOf(actor);
    if (index >= 0) this.slots[index] = null;
    this.pool[actor.poolIndex] = null;
    actor.id = 65535;
    actor.removed = 0;
  }

  // h0:1730: reset room objects without carrying stale update-list entries.
  clear(): void {
    this.slots.fill(null);
    this.pool.fill(null);
    for (const actor of this.storage) if (actor) { actor.id = 65535; actor.removed = 0; }
    this.context.state.player = null;
    this.context.state.spawned = null;
    this.context.state.nextObjectId = 1;
    this.context.state.frameCounter = 0;
    this.context.state.survivorIndex = 0;
    this.context.state.forceRedraw = 0;
    this.context.state.clipBottom = 181;
    this.context.state.talk.depth = 0; // h0:173a clears g:d92c
    this.context.state.playfieldKey = 0; // h0:1746 clears g:8c0e
  }

  // h0:fac: traverse mutable slots in order; spawns in later slots update immediately.
  update(): void {
    const state = this.context.state;
    const ticks = state.frameTicks;
    try {
      for (let slot = 0; slot < SLOT_COUNT && !state.abortFrame; slot++) {
        const actor = this.slots[slot];
        if (!actor || actor.removed) continue;
        state.frameTicks = actor.activeThreat ? state.movementTicks : ticks;
        state.currentObject = actor;
        const handler = this.classes[actor.classId].handlers?.update;
        if (!handler && actor.classId !== 8) throw new Error(`class ${actor.classId} update not ported`);
        handler?.(this.context, actor);
        actor.packedPosition = ((actor.x >>> 8) << 8) + (actor.y >>> 8);
      }
    } finally {
      state.frameTicks = ticks;
    }
  }

  // h0:1ae6: post handlers use a distinct current-object global.
  post(): void {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const actor = this.slots[slot];
      if (!actor || actor.removed) continue;
      this.context.state.postObject = actor;
      const handler = this.classes[actor.classId].handlers?.post;
      if (!handler && !POST_NULL.has(actor.classId)) throw new Error(`class ${actor.classId} post not ported`);
      handler?.(this.context, actor);
    }
  }

  // h0:1bd8: nested messages save and restore receiver/sender; pause blocks delivery.
  send(receiver: Actor, message: ActorMessage): number {
    const state = this.context.state;
    if (state.paused) return 0;
    const oldReceiver = state.receiver, oldSender = state.sender;
    state.receiver = receiver;
    state.sender = message.sender;
    try {
      const handler = this.classes[receiver.classId].handlers?.message;
      if (!handler) throw new Error(`class ${receiver.classId} message not ported`);
      return handler(this.context, receiver, message);
    } finally {
      state.receiver = oldReceiver;
      state.sender = oldSender;
    }
  }

  // h0:230e: callbacks see live, nonremoved actors in slot order.
  forEach(callback: (actor: Actor) => boolean | void): boolean {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const actor = this.slots[slot];
      if (actor && !actor.removed && callback(actor)) return true;
    }
    return false;
  }

  // h0:24de/h0:2524: object class count and stable id lookup.
  count(id: number): number {
    let count = 0;
    this.forEach(actor => { if (actor.classId === id) count++; });
    return u8(count);
  }

  find(id: number): Actor | null {
    for (const actor of this.slots) if (actor && !actor.removed && actor.id === id) return actor;
    return null;
  }

  // h0:4436/h0:444a: live ORB, TUB and generator objects, as a signed byte.
  countHostiles(): number {
    let count = 0;
    this.forEach(actor => { if ([6, 15, 22, 26].includes(actor.classId)) count++; });
    return s8(count);
  }

  // h0:5a64/h0:5a78: send noise message 5 to every live SUR; the sender is the current receiver g:85b4.
  broadcastNoise(kind: number): void {
    const sender = this.context.state.receiver;
    this.forEach(actor => { if (actor.classId === 9) this.send(actor, { type: 5, sender, noiseKind: kind }); });
  }

  // h0:23d8: clearing the last ORB/TUB and disabling vents opens group-7 doors and wakes survivors.
  checkRoomCleared(announce = 0): void {
    if (this.count(15) || this.count(6)) return;
    if (this.forEach(actor => actor.classId === 13 && !(actor as VentActor).ventOff)) return;
    this.forEach(actor => { if (actor.classId === 2 && (actor as DoorActor).switchGroup === 7) this.send(actor, { type: 4, sender: null, switchAction: 0 }); });
    this.broadcastNoise(0);
    this.forEach(actor => { if (actor.classId === 11 && (actor as ArtActor).artKind === 6) (actor as ArtActor).artFired = 1; });
    this.forEach(actor => { if (actor.classId === 13) actor.frame = 6; });
    if (!announce) return;
    showMessage(this.context, "`Room Secured", 4, 3);
    this.context.emit({ type: "sound", id: 29 });
  }

  // h0:1c38/234a: reserve one output record per save handler in the room's buffer, then clear the class byte of
  // the record after the last one. Records the pass does not write keep their earlier bytes.
  save(): ObjectSpec[] {
    const scene = this.context.room.scene;
    const scenes = [...this.savedRooms.keys()];
    const bufferIndex = this.savedRooms.has(scene) ? scenes.indexOf(scene) : scenes.length;
    const buffer = this.roomSaveBuffers[bufferIndex] ??= new Uint8Array(SLOT_COUNT * 4);
    let count = 0;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const actor = this.slots[slot];
      if (!actor || actor.removed || SAVE_EXCLUDED.has(actor.classId)) continue;
      const save = this.classes[actor.classId].handlers?.save;
      if (save) {
        // h0:94cc..9502: scene-1 CUB reserves its slot but performs no write or actor mutation.
        if (actor.classId !== 7 || this.context.state.sceneIndex !== 0) buffer.set(encodeObject(save(this.context, actor)), count * 4);
        count++;
      }
      this.remove(actor);
    }
    if (count < SLOT_COUNT) buffer[count * 4] = 0;
    const records: ObjectSpec[] = [];
    for (let at = 0; at < buffer.length && ((buffer[at]! & 0x0f) | (buffer[at]! & 0x80)); at += 4) {
      records.push(decodeObject(buffer.subarray(at, at + 4)));
    }
    return records;
  }

  // Byte `offset` of the room-save buffers as one block (h11:9301 + offset); buffers not yet used are zero.
  saveBufferByte(offset: number): number {
    if (offset < 0 || offset >= 20 * SLOT_COUNT * 4) throw new Error(`AGA room-save buffer read at +${offset} outside h11:9301`);
    return this.roomSaveBuffers[Math.floor(offset / (SLOT_COUNT * 4))]?.[offset % (SLOT_COUNT * 4)] ?? 0;
  }

  // h0:436a: a lift clears all twenty room-save buffers as well as the directory.
  clearRoomSaves(): void {
    this.savedRooms.clear();
    this.roomSaveBuffers = [];
  }

  spawnPlayer(x: number, y: number, direction: number): Actor | null {
    const actor = this.spawn(0, { class: "unknown-0", x: x / 256, y: y / 256, params: { orientation: direction } });
    this.context.state.player = actor;
    return actor;
  }

  // h0:21a6: fresh-room records precede entry markers and player creation.
  spawnRoom(records: readonly ObjectSpec[], restore = false): void {
    for (const spec of records) {
      const id = classId(spec);
      if ((restore && id === 8) || (!restore && id !== 8)) this.spawn(id, spec);
    }
  }

  // h0:16d0: deferred removal counts down once after this frame's draw dispatch.
  tickDying(): void {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const actor = this.slots[slot];
      if (!actor || !actor.removed) continue;
      actor.removed = u8(actor.removed - 1);
      if (!actor.removed) this.remove(actor);
    }
  }

  // h0:af32/b010: first-layer actors precede others; depth is integer Y only.
  drawOrder(): Actor[] {
    const list = this.slots.filter((actor): actor is Actor => actor !== null && !actor.removed);
    return list.sort((a, b) => b.firstLayer - a.firstLayer || (a.y >>> 8) - (b.y >>> 8));
  }

  // h0:b030: latch draw history during simulation, not when the host renders.
  prepareDraw(): void {
    for (const actor of this.drawOrder()) {
      actor.drawSuppressed = 0;
      if (actor.classId === 22 || actor.classId === 26) {
        const generator = actor as GeneratorActor;
        actor.drawSuppressed = generator.generatorSkipDraw;
        generator.generatorSkipDraw = 0;
      }
      if (actor.classId === 2) {
        const door = actor as DoorActor;
        if (door.doorHasSave && door.doorNeedsRedraw) door.doorSaved = 1;
      }
      if (actor.classId === 6) actor.spriteScheme = 0;
      if (!actor.drawSuppressed) this.classes[actor.classId].handlers?.prepareDraw?.(this.context, actor);
      actor.previousPackedPosition = actor.packedPosition;
      actor.previousHeight = actor.height;
    }
  }

  // h0:1d00 -> h0:1354e: doors whose background was saved this pass move to the redraw list, clearing both flags.
  finishDraw(): void {
    for (const actor of this.slots) {
      if (actor?.classId !== 2) continue;
      const door = actor as DoorActor;
      if (door.doorHasSave && door.doorSaved) door.doorNeedsRedraw = door.doorSaved = 0;
    }
  }
}
