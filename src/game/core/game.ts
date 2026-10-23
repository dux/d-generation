import type { Floor, ObjectSpec, Room } from "../../formats/level.ts";
import type { DemoRecording } from "../../formats/pack.ts";
import { actorClasses } from "../actors/index.ts";
import { playerClass } from "../actors/player.ts";
import { initCubeItems, type CubActor } from "../actors/cub.ts";
import { applySurvivorPalette } from "../actors/sur.ts";
import { flash, type GeneratorActor } from "../actors/cgen.ts";
import { objectRecord } from "../actors/shared.ts";
import { DemoInput, type DemoInputState } from "./demo.ts";
import { ATTRACT_DEMOS } from "./attract.ts";
import { cyclePalette, finishFlash } from "./effects.ts";
import { blocked, inRange, initializeOccupancy, updateBounds } from "./geometry.ts";
import { consumeKey, deliverInput, heldDirection, padVblank, pendingKey, readJoyButton } from "./input.ts";
import { initMessages, showMessage, updateMessages } from "./messages.ts";
import { s8, s16, s32, u8, u16, u32 } from "./int.ts";
import { createRuntimeRoom, type Actor, type ActorContext, type FrameInput, type GameEvent, type GameState, type MusicTrack, type RuntimeRoom } from "./model.ts";
import { ObjectSystem, type ObjectSlots } from "./objects.ts";
import { createState } from "./state.ts";
import type { AgaTimerState } from "./timers.ts";
import { World, type WorldState } from "./world.ts";
import { bombed, ending } from "../ui/ending.ts";
import { handleKeys } from "../ui/keys.ts";
import { padMenu } from "../ui/padmenu.ts";
import { MemoryNonVolatile, type NonVolatileStore } from "../ui/save.ts";
import { clearScreen, paletteVblank, restoreView } from "../ui/screen.ts";
import { startGame, title } from "../ui/title.ts";
import { composeScreenObjects } from "../ui/title-picture.ts";
import { terminal } from "../ui/terminal/terminal.ts";

export interface GameOptions {
  // Start directly in this room (tools, tests): no boot, no title. Without it the game boots at h0:76a.
  scene?: number;
  // With `scene`: play the room's attract demo record. Without `scene`: false starts a new game right after the
  // boot instead of the story (as if the first card had been skipped).
  demo?: boolean;
  // Build an empty game for a snapshot or capture import (no room initialization).
  restore?: boolean;
  // Nonvolatile storage for save/restore game (default: in memory).
  storage?: NonVolatileStore;
}

const ENTRY_INDEX = [2, 3, 0, 1]; // g:3cc.
const CROWD_X = [8, 0, 0, -8, -8, 0]; // g:334
const CROWD_Y = [0, -7, 9, 7, -7, 0]; // g:33a
const COPYRIGHT = "        D/Generation V1.0 Copyright 1993 Robert Cook\n               Conversion by Abersoft Sep 17 1993\n"; // g:896
const ONE_LIFE = "`One life remaining."; // g:2a6
const RESTORED = "`Previously Saved Game Restored"; // g:2bc
const FLASH_COLORS = [[63, 63, 63], [63, 0, 0], [0, 63, 0], [0, 0, 63], [63, 0, 63]]; // g:27b via g:28a
const DEBRIS = [[0x68, 0x90], [0x6c, 0x8d], [0x6d, 0x8d], [0x70, 0x75], [0x74, 0x78], [0x75, 0x7c], [0x7c, 0x6e], [0x80, 0x76], [0x81, 0x76], [0x8a, 0x72]]; // g:3a1
const BOMBED_SHAKE = [-4, -2, 0, 3, 0, -2, 2, 0, -4, 3, 1, -2, 0, 4, 1, -2, -3, 2, 128]; // g:348
const BOMBED_SHAKE_RESTORE = [-2, 1, 0, -1, 0, 3, 1, -3, 4, 1, -1, -3, 0, 2, -2, 3, -1, -4, 0, 128]; // g:36e
// h0:7cb8..7d0e: player positions of the h0:7c94 story transitions, by scene index.
const STORY_SPOTS: ReadonlyMap<number, readonly [number, number]> = new Map([[0x89, [0x7a, 0x70]], [0x39, [0x5f, 0x80]], [0x44, [0x7b, 0x53]]]);
// Harness CIA music handler calls (one per PAL vblank) from h0:77ec to the end of dgen.mod (h7:42 cleared).
const MODULE_TICKS: Readonly<Record<MusicTrack, number>> = { dgen: 3978, dgen2: 0 };
// h0:179f0 at harness DateStamp day 5000, minute 0, tick 0: (0xb6a + 5000) * 86400 = 684460800 plus 21600 from
// g:621c and the g:f8d0 hour (observed: g:d99a = 684482403 three seconds after boot).
const HARNESS_EPOCH = 684482400;

// A main-loop pass in a host that may unwind a wait (restore while paused): thrown from onTick.
export class GameInterrupt extends Error {}

// Game.snapshot(): everything a running game mutates as plain structured-cloneable data (F5/F9 save states).
// Level data, demo files and class handlers are not included; restore() needs a game built from the same files.
export interface GameSnapshot {
  version: 1;
  state: Omit<GameState, "random" | "timers">;
  random: number;
  timers: AgaTimerState;
  world: WorldState;
  room: { floor: number; scene: number };
  runtimeRoom: RuntimeRoom;
  objects: ObjectSlots;
  demo: DemoInputState;
  savedRooms: Map<number, ObjectSpec[]>;
  paletteWrites: Map<number, number>;
  paletteBeforeFlash: Map<number, number> | null;
  booted: boolean;
  quit: number;
  skipStory: boolean;
}

export class Game {
  readonly state: GameState = createState();
  readonly world: World;
  readonly objects = new ObjectSystem([playerClass, ...actorClasses]);
  readonly events: GameEvent[] = [];
  readonly context: ActorContext;
  readonly storage: NonVolatileStore;
  demo: DemoInput;
  // Called after every cooperative PAL vblank inside waits and polls; hosts pace, deliver input and draw here.
  onTick: (() => void) | null = null;
  // h0:7b2 boundary state: the boot has reached the main loop.
  booted = false;
  // Room saves are native state; restoration may populate them without spawning actors.
  readonly savedRooms = this.objects.savedRooms;
  readonly paletteWrites = new Map<number, number>();
  paletteBeforeFlash: Map<number, number> | null = null;
  // Display copies so far (h0:20f0 -> h0:aea8 after each draw pass); the renderer keeps the last copied view while a pass is in progress.
  drawPasses = 0;
  private quit = 0;

  get random() { return this.state.random; }
  get timers() { return this.state.timers; }
  get room(): Room { return this.context.room; }
  get runtimeRoom(): RuntimeRoom { return this.context.runtimeRoom; }
  get quitRequested(): boolean { return !!this.quit; }

  private emit(event: GameEvent): void {
    if (event.type === "palette") {
      if (event.colors.length === 768 && this.state.flashMessage >= 100 && !this.paletteBeforeFlash) this.paletteBeforeFlash = new Map(this.paletteWrites);
      for (let i = 0; i < event.colors.length; i++) {
        const color = event.colors[i] & 63;
        this.paletteWrites.set(event.start * 3 + i, color << 2);
      }
    }
    if (event.type === "sound" && this.state.muted) return; // h0:1551a returns while g:2e88 is set
    this.events.push(event);
  }

  palette(base: Uint8Array): Uint8Array {
    const palette = base.slice();
    for (const [index, value] of this.paletteWrites) palette[index] = value;
    return palette;
  }

  // A deep copy of the game between two main-loop passes (or before boot), sharing nothing with the live game.
  snapshot(): GameSnapshot {
    const { random, timers, ...state } = this.state;
    const floor = this.world.floors.find(floor => floor.rooms.includes(this.room));
    if (!floor) throw new Error(`AGA snapshot: scene ${this.room.scene} is not on a loaded floor`);
    return structuredClone<GameSnapshot>({
      version: 1, state, random: random.seed, timers: timers.state, world: this.world.state,
      room: { floor: floor.floor, scene: this.room.scene }, runtimeRoom: this.runtimeRoom,
      objects: this.objects.snapshot(), demo: this.demo.save(), savedRooms: this.savedRooms,
      paletteWrites: this.paletteWrites, paletteBeforeFlash: this.paletteBeforeFlash,
      booted: this.booted, quit: this.quit, skipStory: this.skipStory,
    });
  }

  // Replaces the whole game state with a snapshot's (the snapshot stays usable). Pending events are dropped.
  restore(snapshot: GameSnapshot): void {
    if (snapshot.version !== 1) throw new Error(`AGA snapshot version ${snapshot.version} is not supported`);
    const data = structuredClone(snapshot);
    const room = this.world.floors.find(floor => floor.floor === data.room.floor)?.rooms.find(room => room.scene === data.room.scene);
    if (!room) throw new Error(`AGA snapshot: floor ${data.room.floor} has no scene ${data.room.scene}`);
    Object.assign(this.state, data.state);
    this.random.seed = data.random;
    Object.assign(this.timers.state, data.timers);
    Object.assign(this.world.state, data.world);
    this.context.room = room;
    this.context.runtimeRoom = data.runtimeRoom;
    this.objects.restore(data.objects);
    this.demo.restore(data.demo);
    for (const [target, source] of [[this.savedRooms, data.savedRooms], [this.paletteWrites, data.paletteWrites]] as const) {
      target.clear();
      for (const [key, value] of source) (target as Map<number, unknown>).set(key, value);
    }
    this.paletteBeforeFlash = data.paletteBeforeFlash;
    this.booted = data.booted;
    this.quit = data.quit;
    this.skipStory = data.skipStory;
    this.events.length = 0;
    this.bindInput();
  }

  constructor(floors: Floor[], private readonly sequences: ReadonlyMap<number, DemoRecording>, options: GameOptions = {}) {
    this.world = new World(floors);
    this.storage = options.storage ?? new MemoryNonVolatile();
    const scene = options.scene ?? 76;
    this.demo = new DemoInput(this.sequence(scene === 65 ? 52 : 50));
    const room = this.world.enterRoom(scene);
    this.state.sceneIndex = scene - 1;
    this.state.visited = this.world.state.visited;
    this.context = {
      state: this.state, objects: this.objects, random: this.random, timers: this.timers,
      room, runtimeRoom: createRuntimeRoom(room), input: {}, world: this.world,
      emit: event => this.emit(event),
      exitRoom: next => this.exitRoom(next),
      departLift: next => this.departLift(next),
      requestRoom: next => this.requestRoom(next),
      storyTransition: next => this.storyTransition(next),
      vblank: () => this.vblank(),
      wait: (ticks, interruptible) => this.wait(ticks, interruptible),
      waitKey: click => this.waitKey(click),
      bombed: () => bombed(this),
      ending: id => ending(this, id),
      saveCheckpoint: () => this.saveCheckpoint(),
      restartCheckpoint: () => this.restartCheckpoint(),
      readButton: which => this.readButton(which),
      readDirection: () => this.demo.readDirection(this.context),
      recordObject: id => this.demo.recordObject(this.context, id),
      terminal: () => terminal(this),
    };
    this.objects.context = this.context;
    this.bindInput();
    if (options.restore) {
      this.booted = true;
      return;
    }
    if (options.scene === undefined) {
      this.skipStory = options.demo === false;
      return;
    }
    // Direct start: the h0:2640 allocations without the title, then the room as demo playback or a new game.
    this.allocateTimers();
    initCubeItems(this.context);
    if (options.demo !== false) {
      const demo = ATTRACT_DEMOS.find(entry => entry.scene === scene);
      this.state.spawnX = demo?.x ?? 57;
      this.state.spawnY = demo?.y ?? 128;
      this.state.spawnDirection = demo?.direction ?? 2;
      this.state.attractIndex = scene === 65 ? 0 : 1;
      this.state.demoPending = 1;
    }
    this.state.storyShown = 1;
    this.setGridPosition(scene);
    this.enterRoom(scene);
    this.saveCheckpoint();
    this.booted = true;
  }

  private skipStory = false;

  private sequence(id: number): DemoRecording {
    const recording = this.sequences.get(id);
    if (!recording) throw new Error(`AGA demo sequence ${id} is missing`);
    return recording;
  }

  // h0:2640: message (h0:b802), frame, flash, blink, palette and room timers, in slot order.
  private allocateTimers(): void {
    initMessages(this.context);
    this.state.frameTimer = this.timers.allocate();
    this.state.flashTimer = this.timers.allocate();
    this.state.delayTimer = this.timers.allocate(); // h0:268a: g:dc2a
    const palette = this.state.paletteTimer = this.timers.allocate();
    this.state.roomTimer = this.timers.allocate();
    this.timers.set(palette, 10);
    this.timers.enable(palette, 1);
    this.timers.freeze(palette);
    this.timers.enable(this.state.frameTimer, 0);
    this.timers.freeze(this.state.frameTimer);
  }

  // h0:76a..7b2 (DOS 0:1a9c) boot(): program start up to the first main-loop boundary: player reset (h0:e4e),
  // startup h0:2640 with the title h0:28ea inside h0:2730, the first room, h0:d38, cube items h0:2108 (h0:f9fa)
  // and the setjmp h0:2126 (returns 0). Runs the whole intro unless a key or button skips it.
  boot(): void {
    if (this.booted) throw new Error("AGA game has already booted");
    const state = this.state;
    this.resetPlayer();
    state.collisionHandled = 0;
    this.allocateTimers();
    // h0:2730: DGEN.CFG was checked when the game was created; h0:6a0(0), g:53c, h0:7804(1), then the title.
    if (this.skipStory) {
      state.storyShown = 1;
      startGame(this, 0);
    } else title(this);
    // h0:289c h0:6de(0): object bank group 0 (g:49f, 0xff after delta set 0x22) is reloaded; h0:317c then
    // returns that call's d0, which is 0 in the harness (the return of h0:7828).
    state.frontShapeSet = 0;
    this.random.seed = 0;
    state.attractVariant = this.random.next(4);
    state.visited.fill(false);
    state.roomResilience.fill(0);
    this.enterRoom(state.sceneIndex + 1); // h0:2708 h0:1030(1)
    this.world.saveCheckpoint(state); // h0:270c h0:e7e
    this.world.saveRoomPosition(); // h0:794 h0:d38
    initCubeItems(this.context); // h0:798 h0:2108 -> h0:f9fa
    this.booted = true;
  }

  // h0:e4e: 30 player bytes cleared, five lives, floor 80.
  private resetPlayer(): void {
    const state = this.state;
    state.lives = 5;
    state.rescuedCount = 0;
    state.buildingFloor = 80;
    state.ammo = state.throwableAvailable = state.bombsFound = 0;
    state.spawnX = state.spawnY = state.spawnDirection = 0;
    state.portableLaserCount = state.slowMotionCount = state.shieldCount = state.carriedBombs = 0;
    state.inventoryAvailability = state.slowMotion = state.playerPadding = 0;
    state.slowMotionTime = state.invulnerable = state.shieldPadding = state.invulnerabilityTime = 0;
    state.paused = state.specialItemCollected = state.floorSecurityState = state.floorSecurityCode = 0;
  }

  // h0:3650: map row and column of a scene (row 39, column 11 when unmapped).
  setGridPosition(scene: number): void {
    const position = this.world.gridPosition(scene);
    this.world.position.row = position?.row ?? 39;
    this.world.position.column = position?.column ?? 11;
  }

  // h0:2f22 (DOS 0:3a71) newGame(): playback off, fresh player, scene 1 from grid row/column (row 4, column 3
  // when h0:3650 fails), position checkpoint and sound 0.
  newGame(): void {
    const state = this.state;
    state.demoPlayback = 0;
    state.roomChange = 1;
    this.sound(0);
    this.resetPlayer();
    state.visited.fill(false);
    state.roomResilience.fill(0);
    state.sceneIndex = 0;
    this.world.position.entrySlot = 0;
    state.spawnX = 0;
    clearScreen(state.screen); // h0:ad8a
    const position = this.world.gridPosition(1);
    this.world.position.row = position?.row ?? 4;
    this.world.position.column = position?.column ?? 3;
    this.world.position.scene = 1;
    this.world.saveRoomPosition();
    this.sound(0);
  }

  // h0:2060 resetGame(): after an ending: fresh player and checkpoint, every story flag cleared, checkpoint restart.
  resetGame(): void {
    const state = this.state;
    this.resetPlayer();
    this.world.saveCheckpoint(state);
    state.frontShapeSet = 0; // h0:206a clears g:4b4
    state.collisionHandled = 0;
    state.roomChange = 1;
    state.exitReached = state.useDisabled = state.backgroundDirty = state.endingId = 0;
    state.generatorOverride = state.bomberActive = state.roomEffect = state.endingAlt = 0;
    this.restartCheckpoint();
    this.sound(0);
    state.attractIndex = 0;
  }

  // h0:1030 (DOS 0:2052) enterRoom(1): room-local state resets before the fresh/restored object spawn passes;
  // no post or draw pass runs here.
  private enterRoom(scene: number): void {
    const state = this.state;
    state.screen.bombed = null;
    state.sceneIndex = u8(scene - 1);
    state.roomChange = 0;
    this.timers.thaw(state.roomTimer);
    this.timers.set(state.roomTimer, 240);
    this.timers.enable(state.roomTimer, 1);
    state.doorSaveSlots = 0;
    state.survivorIndex = 0;
    state.occupancyScene = -1;
    this.context.room = this.world.enterRoom(scene);
    this.context.runtimeRoom = createRuntimeRoom(this.context.room);
    this.objects.clear();
    this.sound(0);
    this.drawRoomState();
    initializeOccupancy(this.context);
    const restored = this.savedRooms.get(scene);
    this.objects.spawnRoom(restored ?? this.room.objects);
    this.objects.spawnRoom(this.room.objects, true);
    const entries: ({ x: number; y: number } | null)[] = Array(4).fill(null);
    this.objects.forEach(actor => {
      if (actor.classId !== 8) return;
      entries[ENTRY_INDEX[actor.direction]] = { x: actor.x, y: actor.y };
      this.objects.remove(actor);
    });
    // h0:1668: one random state-7 CUB becomes the live terminal.
    const terminals: CubActor[] = [];
    this.objects.forEach(actor => { if (actor.classId === 7 && (actor as CubActor).cubState === 7) terminals.push(actor as CubActor); });
    if (terminals.length) terminals[this.random.next(terminals.length)]!.cubActive = 1;
    this.setPlayerPalette(0);
    this.sound(0x30);
    // h0:10c0..h0:110a: the D/Generation creature (class 26) in the ending rooms.
    const index = state.sceneIndex;
    if (state.generatorOverride && index === 0x78 && state.roomEffect) {
      state.roomEffect = 0;
      const dgen = this.objects.spawn(objectRecord(0xda, 0x6c, 0x98, 0x80)) as GeneratorActor | null;
      if (!dgen) throw new Error("h0:10d8 assumes a free slot for the DGEN");
      dgen.generatorSpawnTime = 0x1400;
      dgen.speed = 0;
      dgen.x = (dgen.x & 0xff) | 0x6700;
      dgen.y = (dgen.y & 0xff) | 0x9d00;
      updateBounds(dgen);
    }
    // h0:159c(0): record da 94 66 80 in scene 58, da 6c 98 80 elsewhere.
    if (!state.generatorOverride && index === 0x39) this.objects.spawn(objectRecord(0xda, 0x94, 0x66, 0x80));
    if (index === 0x8d) this.objects.spawn(objectRecord(0x89, 0x7e, 0x84, 0)); // h0:15e6
    if (index === 0x79 && !state.backgroundDirty) this.objects.spawn(objectRecord(0x89, 0x64, 0x56, 2)); // h0:1606
    if (!state.arrivalShown && index === 0) {
      // h0:112c..1146: the first visit to scene 1 starts with the arrival sled instead of the player.
      state.inventoryAvailability = state.arrivalShown = 1;
      this.objects.spawn(objectRecord(0x87, 0x80, 0x80, 0)); // h0:14ca(0)
      this.sound(21);
    } else {
      if (!state.suppressPlayer && ![0x8d, 0x66, 0x90].includes(index)) {
        if (!state.spawnX) {
          let slot = this.world.position.entrySlot;
          if (!entries[slot]) slot = entries.findIndex(entry => entry !== null);
          if (slot < 0) throw new Error(`scene ${scene} has no player entry`);
          this.world.position.entrySlot = slot;
          state.spawnX = entries[slot]!.x >>> 8;
          state.spawnY = entries[slot]!.y >>> 8;
          state.spawnDirection = this.world.position.spawnDirection;
        }
        this.objects.spawnPlayer(state.spawnX * 256, state.spawnY * 256, state.spawnDirection);
      }
      if (index === 0) {
        this.objects.spawn(objectRecord(0x07, 0x82, 0x7e, 0xa0)); // h0:14f2
        state.inventoryAvailability = 1;
      }
    }
    this.world.savePlayerState(state);
    // h0:1514: six class-19 records 83 78 78 i<<4; h0:154c: six class-27 records 8b x y i (offsets g:334/g:33a).
    if (index === 0x89) for (let i = 0; i < 6; i++) this.objects.spawn(19, objectRecord(0x83, 0x78, 0x78, i << 4));
    if (index === 0x71) for (let i = 0; i < 6; i++) this.objects.spawn(objectRecord(0x8b, 0x8b + CROWD_X[i]!, 0x7e + CROWD_Y[i]!, i));
    if (state.oneLifePending) {
      showMessage(this.context, ONE_LIFE, 3, 5);
      state.oneLifePending = 0;
    }
    if (state.copyrightPending) {
      this.showVersion();
      state.copyrightPending = 0;
    }
    state.demoPlayback = state.demoRecording = 0;
    if (state.demoPending) {
      state.demoPending = 0;
      state.demoPlayback = 1;
      state.demoClock = state.demoIndex = state.directionIndex = 0;
      state.demoDirection = state.demoMagnitude = state.demoButton = 0;
      this.random.seed = 0;
    }
    this.restorePanel();
    if (state.restoredPending) {
      showMessage(this.context, RESTORED, 6, 2);
      state.restoredPending = 0;
    }
    state.movementScale = state.roomResilience[state.sceneIndex];
  }

  // h0:36aa: sprintf of g:896, shown for six units in style 0.
  showVersion(): void {
    showMessage(this.context, COPYRIGHT, 6, 0);
  }

  // h0:3700(g:4d2, 0) -> h0:e1a8: the panel bitmap is restored below the panel top; the native panel is drawn
  // from panelText, so the restore empties it.
  restorePanel(): void {
    this.state.panelText = "";
  }

  // h0:1250 game-state effects of drawing a room: reloading DGEN.PAL (scenes 1/69, or leaving 103) restarts the
  // colour cycle, and the four light rooms load player palette 14/16 at base 32.
  private drawRoomState(): void {
    const state = this.state, index = state.sceneIndex;
    if (state.drawnScene === 0x66 || index === 0 || index === 0x44) state.paletteStep = 0;
    if ([0x6a, 0x77, 0x7f, 0x75].includes(index)) applySurvivorPalette(this.context, 14, 16, 32);
    if (state.backgroundDirty && index === 0x79) {
      // h0:14a2 -> h0:1236e: the cannon room after the DGEN died keeps its redraw and status colours.
      state.forceRedraw = state.paletteDirty = 1;
      state.statusRed = 0x44;
      state.statusGreen = 0x54;
      state.statusBlue = 0x1a;
    }
    state.drawnScene = index;
  }

  // h0:1222: switch the player colours to variant 11+v/13+v when the variant changes.
  private setPlayerPalette(variant: number): void {
    if (this.state.playerPalette === variant) return;
    applySurvivorPalette(this.context, variant + 11, variant + 13, 0);
    this.state.playerPalette = variant;
  }

  // h0:3edc exitRoom: rescued survivors at the edge (h0:5a9e) and fired kind-7 ART (h0:5ada) go first; when the
  // map has a neighbour (h0:3f54), a chasing generator (class 22 or 26) is remembered by h0:d5c -> h0:d66 so it can
  // follow (h0:d92), the room is saved and the change happens at the next main-loop boundary.
  private exitRoom(scene: number | null): void {
    const state = this.state;
    this.objects.forEach(actor => {
      if (actor.classId !== 9 || actor.ignoredClass !== 9) return;
      state.lives = u8(state.lives + 1);
      state.rescuedCount = u8(state.rescuedCount + 1);
      this.objects.remove(actor);
    });
    this.objects.forEach(actor => {
      if (actor.classId === 11 && (actor as Actor & { artKind: number }).artKind === 7) actor.removed = state.round;
    });
    if (!state.collisionHandled) state.roomAlert = 0;
    if (scene === null) return;
    this.objects.forEach(actor => {
      if (actor.classId !== 22 && actor.classId !== 26) return;
      state.collisionHandled = state.sceneIndex;
      state.chaserX = actor.x >>> 8;
      state.chaserY = actor.y >>> 8;
    });
    this.savedRooms.set(this.room.scene, this.objects.save());
    state.visited[state.sceneIndex] = true;
    this.setGridPosition(scene);
    this.world.position.scene = scene;
    state.sceneIndex = scene - 1;
    state.spawnX = 0;
    state.roomChange = 1;
  }

  // h0:43a6: immediate transitions suppress a provisional player; the grid position comes from h0:3650.
  private requestRoom(scene: number): void {
    this.state.sceneIndex = scene - 1;
    this.setGridPosition(scene);
    this.state.abortFrame = 1;
    this.stopAudio();
    restoreView(this.state.screen);
    this.state.suppressPlayer = 1;
    try {
      this.enterRoom(scene);
    } finally {
      this.state.suppressPlayer = 0;
    }
    this.timers.set(this.state.frameTimer, 0);
    this.state.collisionHandled = 0;
  }

  // h0:7c94 storyTransition(scene): the immediate room change h0:43a6, then (except into scene index 0x8d) a
  // player from the stack record 10 x y 00 at the fixed spot of scene index 0x89 (which also empties the
  // inventory), 0x39 or 0x44; sound 0x21 except into 0x44 (h0:d040), and the white flash h0:c9a(0, 4).
  storyTransition(scene: number): void {
    const state = this.state;
    this.requestRoom(scene);
    const index = state.sceneIndex;
    if (index !== 0x8d) {
      if (index === 0x89) state.shieldCount = state.carriedBombs = state.slowMotionCount = state.portableLaserCount = state.inventoryAvailability = 0;
      const spot = STORY_SPOTS.get(index);
      if (!spot) throw new Error(`AGA h0:7c94 spawns the player from an unwritten stack record in scene index ${index}`);
      this.objects.spawnPlayer(spot[0]! * 256, spot[1]! * 256, 1); // record byte 0 = 0x10: class 0, orientation 1
    }
    if (index !== 0x44) this.sound(0x21);
    flash(this.context, 0, 4);
  }

  // h0:4348: a lift starts a new floor and calls its arrival cabin.
  private departLift(scene: number): void {
    this.objects.clearRoomSaves();
    this.state.visited.fill(false);
    this.state.roomResilience.fill(0);
    this.state.floorSecurityState = this.state.bomberActive;
    this.state.floorSecurityCode = this.state.bomberMinutes;
    this.requestRoom(scene);
    this.state.buildingFloor = u8(this.state.buildingFloor + 1);
    this.state.bombsFound = 0;
    const lift = this.objects.slots.find(actor => actor?.classId === 18);
    if (!lift) throw new Error(`scene ${scene} has no arrival lift`);
    this.objects.send(lift, { type: 5, sender: null });
  }

  // h0:d38/e6a/e7e: the floor checkpoint includes room position and player inventory.
  saveCheckpoint(): void {
    this.world.saveRoomPosition();
    this.world.savePlayerState(this.state);
    this.world.saveCheckpoint(this.state);
  }

  // h0:d0c: a checkpoint restart discards room saves as well as both visitation lists.
  restartCheckpoint(): void {
    const position = this.world.restartFromCheckpoint(this.state);
    this.savedRooms.clear();
    this.state.roomResilience.fill(0);
    this.state.collisionHandled = 0;
    this.state.sceneIndex = position.scene - 1;
    this.state.roomChange = 1;
  }

  // One cooperative PAL vblank (harness tick): timers and the host hook.
  // h10:212 order: palette fade steps, the timer interrupt (twice every fifth blank), the pad reader h0:14b80.
  vblank(count = 1): void {
    for (let i = 0; i < count; i++) {
      paletteVblank(this.state.screen);
      this.timers.vblank();
      padVblank(this.state.input);
      this.onTick?.();
    }
  }

  // h0:1462a under the harness rule: one PAL tick precedes each timer-query visit.
  pollTimer(slot: number): number {
    this.vblank();
    return this.timers.get(slot);
  }

  // h0:3104 -> h0:179f0 seconds(): ((0xb6a + days) * 1440 + minutes) * 60 + ticks / 50 + g:621c (+ 3600 with
  // g:f8d0). The harness DateStamp is day 5000, minute 0 and counts its ticks as PAL vblanks; on a real Amiga
  // it is the wall clock. Only differences of this value are used (h0:b6c), so the harness epoch is kept.
  seconds(): number {
    return HARNESS_EPOCH + Math.floor(this.timers.state.clock / 50);
  }

  // h0:304c (DOS 0:3b29) wait(ticks, interruptible): a countdown timer of `ticks` counts with the frame timer stopped.
  wait(ticks: number, interruptible: boolean): number {
    const timers = this.timers, frameTimer = this.state.frameTimer;
    timers.thaw(frameTimer);
    const timer = timers.allocate();
    if (timer < 0) throw new Error("Error exit: 20 (h0:304c found no free timer)");
    timers.set(timer, ticks);
    timers.enable(timer, 1);
    timers.freeze(timer);
    let result = 0;
    for (;;) {
      if (interruptible) {
        if (this.readButton(0) === 2 || this.readButton(1) === 2) { result = 1; break; }
        if (this.pendingKey()) { result = this.consumeKey(); break; }
      }
      if (!this.pollTimer(timer)) break;
    }
    timers.thaw(timer);
    timers.free(timer);
    timers.freeze(frameTimer);
    return result;
  }

  // h0:357c (DOS 0:bc9d) waitKey(click): buttons released, then a key (button 0 = Esc, button 1 = Enter), then
  // released again; the frame timer is restored afterwards.
  waitKey(click: number): number {
    const state = this.state;
    const saved = this.pollTimer(state.frameTimer);
    state.waitSteps = 0;
    while (this.readButton(0) < 3 || this.readButton(1) < 3) this.waitStep();
    let key = 0;
    for (;;) {
      this.waitStep();
      if (this.pendingKey()) { key = this.consumeKey(); break; }
      if (this.readButton(0) === 2) { key = 0x1b; break; }
      if (this.readButton(1) === 2) { key = 0x0d; break; }
    }
    if (click) this.sound(0x13);
    state.waitSteps = 0;
    while (this.readButton(0) < 3 || this.readButton(1) < 3) this.waitStep();
    this.timers.set(state.frameTimer, saved);
    return s8(key);
  }

  // h0:3622: one busy-wait step (a harness tick point); demo playback still advances every 100 steps.
  waitStep(): void {
    const state = this.state;
    this.vblank();
    if (!state.demoRecording && !state.demoPlayback) return;
    const steps = state.waitSteps;
    state.waitSteps = u16(steps + 1);
    if (steps !== 100) return;
    this.frameSync();
    state.waitSteps = 0;
    state.demoClock = u32(state.demoClock + s16(state.frameTicks));
  }

  // h0:3736 -> h0:b434: demo playback buttons, else the joystick (values 1 press, 2 held, 3 release, 4 idle).
  readButton(which: number): number {
    if (this.state.demoPlayback) return this.demo.readButton(this.context, which);
    return readJoyButton(this.state.input, which);
  }

  // h0:36e2 -> h0:14b0c / h0:36fa -> h0:14b1e / h0:372a -> h0:151a4.
  pendingKey(): boolean { return pendingKey(this.state.input); }
  consumeKey(): number { return consumeKey(this.state.input); }

  // h0:14b1e when the queue may be empty (h0:31c0's cheat sequence): the Amiga spins while interrupts run.
  consumeKeyBlocking(): number {
    while (!this.pendingKey()) this.vblank();
    return this.consumeKey();
  }

  // h0:372a -> h0:151a4: the CD32 pad menu (Ctrl+B or REVERSE).
  padMenu(): number {
    return padMenu(this);
  }

  // Input of the host (or the lockstep timeline): raw key transitions go through the h0:130a4 handler now.
  deliver(input: FrameInput): void {
    deliverInput(this.state.input, input);
  }

  // h0:77e0 -> h0:1551a sound(id): 0 stops every channel.
  sound(id: number): void {
    this.emit({ type: "sound", id });
  }

  // h0:8544 -> h10:37e4: audio channels off.
  stopAudio(): void {
    this.emit({ type: "sound", id: 0 });
  }

  // h0:c566 / h0:c63c: a module replaces whatever g:dcf4 held (effects can no longer play).
  loadMusic(track: MusicTrack): void {
    this.state.music = { loaded: track, playing: 0, endClock: 0 };
  }

  // h0:77ec -> h0:16780: start the loaded module.
  startMusic(): void {
    const music = this.state.music;
    if (music.loaded === null || music.loaded === "effects") throw new Error("AGA music start without a module");
    music.playing = 1;
    music.endClock = u32(this.timers.state.clock + MODULE_TICKS[music.loaded]);
    this.emit({ type: "music", track: music.loaded });
  }

  // h7:42 is cleared by the player when the module ends.
  musicPlaying(): boolean {
    const music = this.state.music;
    if (music.playing && music.loaded === "dgen" && this.timers.state.clock >= music.endClock) music.playing = 0;
    return !!music.playing;
  }

  // h0:3116 -> h0:16738: stop the module player.
  stopMusic(): void {
    if (this.state.music.playing) this.emit({ type: "music", track: null });
    this.state.music.playing = 0;
  }

  // h0:311c -> h0:c6f8: load amiga.eff once; it replaces the module.
  loadEffects(): void {
    const music = this.state.music;
    if (music.loaded === "effects") return;
    if (music.playing) this.emit({ type: "music", track: null });
    this.state.music = { loaded: "effects", playing: 0, endClock: 0 };
  }

  // h0:314c -> h0:c8ce: DATA/DEMO%d.SEQ.
  loadDemo(sequence: number): void {
    this.demo = new DemoInput(this.sequence(sequence));
    this.state.demoSequence = sequence;
  }

  // h0:7804 -> h0:1238c(1): object shape bank selection for the title and talk portraits.
  loadObjectBank(_bank: number): void {
    // Shape banks are loaded by the renderer; no game state depends on the selection.
  }

  // h0:1730: reset room objects (b6c before its sled).
  resetRoomObjects(): void {
    this.objects.clear();
  }

  // h0:14ca(kind): record 87 80 80 kind, a class-23 sled.
  spawnSled(kind: number): void {
    this.objects.spawn(objectRecord(0x87, 0x80, 0x80, kind));
  }

  // h0:b6c's partial pass: h0:20e4, eba, fac, 1ae6, 1d00, 20cc, 1b28, 16d0 and the draw h0:20f0.
  titlePass(): void {
    for (const actor of this.objects.slots) if (actor) actor.moved = 0;
    this.frameSync();
    this.objects.update();
    this.objects.post();
    this.objects.prepareDraw();
    this.objects.finishDraw();
    composeScreenObjects(this);
    this.state.screen.objectsVisible = true;
    this.state.forceRedraw = 0;
    this.objects.tickDying();
    this.drawPasses++;
  }

  // h0:c16(id): every colour register becomes flash colour g:28a[id].
  flashScript(id: number): void {
    const color = FLASH_COLORS[id]!;
    this.emit({ type: "palette", start: 0, colors: Array.from({ length: 768 }, (_, i) => color[i % 3]!) });
  }

  // h0:1dd2 tail: shake scripts g:348/g:36e and the red background flash of h0:1d8a.
  startShake(): void {
    const state = this.state;
    state.shakeScript = BOMBED_SHAKE;
    state.shakeRestoreScript = BOMBED_SHAKE_RESTORE;
    state.redFlash = 1;
    state.redFlashLevel = 0x3f;
  }

  // h0:20a8 -> h0:e6b0: advance each word script until 0x80. The AGA h0:e6e6/e6ee consumers are bare returns,
  // so these scripts change no display coordinates on this build.
  private advanceShake(): void {
    const state = this.state;
    if (state.shakeScript[0] !== 128) state.shakeScript = state.shakeScript.slice(1);
    if (state.shakeRestoreScript[0] !== 128) state.shakeRestoreScript = state.shakeRestoreScript.slice(1);
  }

  // h0:1e70: the class-25 debris records 89 x y 01 of g:3a1.
  spawnDebris(): void {
    for (const [x, y] of DEBRIS) this.objects.spawn(objectRecord(0x89, x!, y!, 1));
  }

  // h0:1d8a: the red background flash after h0:1dd2 fades by frameTicks / 64 per pass.
  private redFlash(): void {
    const state = this.state;
    if (!state.redFlash) return;
    this.emit({ type: "palette", start: 0, colors: [state.redFlashLevel & 63, 0, 0] });
    state.redFlashLevel = s8(state.redFlashLevel - Math.trunc(s16(state.frameTicks) / 0x40));
    if (state.redFlashLevel < 0) {
      state.redFlash = 0;
      this.emit({ type: "palette", start: 0, colors: [0, 0, 0] });
    }
  }

  // h0:eba: two-pass pacing, signed word clamp, then slow-motion/pause scaling.
  private frameSync(): void {
    const state = this.state;
    state.syncCounter = u16(state.syncCounter + 1);
    const target = Math.trunc(s16(state.syncCounter << 2) / 2);
    while (this.pollTimer(state.frameTimer) < u16(target)) {}
    if (s16(state.syncCounter) > 1) {
      state.syncCounter = 0;
      const ticks = Math.max(1, Math.min(25, s16(this.timers.exchange(state.frameTimer, 0))));
      state.frameTicks = Math.min(ticks * 40, 768);
      state.slowFrameTicks = state.frameTicks;
      if (state.slowMotion) state.frameTicks = s16(state.frameTicks) >> 1;
      if (state.paused) state.frameTicks = 0;
    }
    state.movementTicks = state.frameTicks;
    if (!state.demoPlayback && !state.demoRecording) {
      if (state.movementScale) state.movementTicks = s16((s16(state.frameTicks) * u16(state.movementScale)) >> 8);
      if (state.lives === 2) state.movementTicks = u16(state.movementTicks - 10);
      if (state.lives === 1) state.movementTicks = u16(state.movementTicks - 20);
    }
  }

  // Live direction (h0:e48c reads g:ddb2 when asked, so a pad change inside frameSync counts in the same pass),
  // and the playfield key (g:8c0e/g:8c86) as the actors read them.
  private bindInput(): void {
    const state = this.state;
    const live: FrameInput = {};
    Object.defineProperty(live, "direction", { enumerable: true, get: () => heldDirection(state.input) });
    Object.defineProperty(live, "keyPressed", { enumerable: true, get: () => !!state.playfieldKeyPending, set: (v: boolean) => { state.playfieldKeyPending = v ? 1 : 0; } });
    Object.defineProperty(live, "keyCode", { enumerable: true, get: () => state.playfieldKey, set: (v: number) => { state.playfieldKey = u8(v); } });
    this.context.input = live;
    this.demo.setInput(live);
  }

  // h0:7b2..b5a (DOS 0:1aed) frame(input): one main-loop pass between two h0:7b2 boundaries.
  frame(input: FrameInput = {}): void {
    if (!this.booted) throw new Error("AGA game has not booted (call boot() first)");
    if (this.quit) throw new Error("AGA game has quit");
    const state = this.state;
    this.deliver(input);
    if (state.titleRequested) {
      state.titleRequested = 0;
      title(this);
      state.arrivalShown = 0;
      // h0:7ca..7d6 seeds from h0:317c, a bare RTS: d0 is what h0:28ea left, the return of its last call,
      // graphics.library LoadRGB32 (h0:146d2). That LVO is void, so the value is undefined on hardware; the
      // truth harness returns 0, and the port uses that value.
      this.random.seed = 0;
      state.attractVariant = this.random.seed & 3;
    }
    if (state.demoPlayback) {
      state.throwableAvailable = 1;
      state.demoPlayback = 0;
      if (this.readButton(0) === 1 || this.readButton(1) === 1) state.menuRequested = 1;
      else state.demoPlayback = 1;
    }
    if (state.menuRequested) {
      state.menuRequested = 0;
      this.newGame();
    }
    if (state.roomChange) {
      if (!state.lives) this.restartCheckpoint();
      state.roomChange = 0;
      this.stopAudio();
      restoreView(state.screen);
      this.enterRoom(state.sceneIndex + 1);
      this.timers.set(state.frameTimer, 0);
      this.objects.checkRoomCleared(0);
    }
    this.followChaser();
    for (const actor of this.objects.slots) if (actor) actor.moved = 0;
    this.frameSync();
    this.quit = handleKeys(this);
    this.objects.update();
    if (!state.abortFrame && !this.quit) {
      this.objects.post();
      this.objects.prepareDraw();
      this.objects.finishDraw();
      state.forceRedraw = 0; // h0:1d00 ends the draw pass by clearing g:4ea.
      state.paletteDirty = 0; // h0:2114 -> h0:122fe redraws the status lights once
      updateMessages(this.context, slot => this.pollTimer(slot));
      this.endFlash();
      this.objects.tickDying();
      this.drawPasses++;
      this.endFlash();
      cyclePalette(this.context);
      this.redFlash();
      this.advanceShake();
    }
    state.abortFrame = 0;
    this.advanceCountdowns();
    state.frameCounter = u16(state.frameCounter + 1);
    if (state.demoPlayback || state.demoRecording) state.demoClock = u32(state.demoClock + s16(state.frameTicks));
    if (this.quit) this.emit({ type: "quit" });
  }

  // h0:d92: after a death in a room a generator chased the player through, it re-enters with the player:
  // record 86 (8a with g:527) at the chaser's position, kept only if it is free and away from the player.
  private followChaser(): void {
    const state = this.state;
    if (!state.player || !state.collisionHandled) return;
    const override = u8(state.generatorOverride << 7);
    const sameRoom = state.sceneIndex === state.collisionHandled;
    const x = sameRoom ? state.chaserX : state.spawnX, y = sameRoom ? state.chaserY : state.spawnY;
    const chaser = this.objects.spawn(objectRecord(override ? 0x8a : 0x86, x, y, override));
    state.currentObject = chaser;
    const range = state.sceneIndex === 0x79 ? 0x3c : 0x1e;
    if (!chaser || blocked(this.context, chaser) || (!sameRoom && inRange(chaser, state.player, range))) {
      if (chaser) this.objects.remove(chaser);
      return;
    }
    state.roomAlert = state.collisionHandled;
    state.collisionHandled = 0;
  }

  private endFlash(): void {
    if (!finishFlash(this.context) || !this.paletteBeforeFlash) return;
    this.paletteWrites.clear();
    for (const [index, value] of this.paletteBeforeFlash) this.paletteWrites.set(index, value);
    this.paletteBeforeFlash = null;
  }

  // h0:77fe: a full 256-colour load (DGEN.PAL g:47e8 / g:dafa, bombed.pal g:db0a) replaces every earlier colour write.
  resetPalette(): void {
    this.paletteWrites.clear();
    this.paletteBeforeFlash = null;
  }

  // h0:8be..b3e: countdowns use wrapped signed arithmetic, with strict underflow.
  private advanceCountdowns(): void {
    const state = this.state, ticks = s16(state.frameTicks);
    if (state.player && state.slowMotion) {
      state.slowMotionTime = s32(state.slowMotionTime - s16(state.slowFrameTicks));
      if (state.slowMotionTime < 0) {
        state.paused = state.slowMotion = 0;
        this.sound(14);
      }
    }
    if (state.roomEffect) {
      state.endingTime = s32(state.endingTime - ticks);
      if (state.endingTime < 0) {
        state.roomEffect = 0;
        clearScreen(state.screen);
        this.requestRoom(103);
        this.objects.spawn(objectRecord(0x87, 0x84, 0x42, 4)); // h0:90e: the jet-pack sled (class 23 kind 4)
      }
    }
    if (!state.useDisabled && state.bomberActive && ![102, 144].includes(state.sceneIndex)) {
      if (state.bomberMinutes === 1) {
        state.bomberSecondTime = s16(state.bomberSecondTime - ticks);
        if (state.bomberSecondTime < 0) {
          state.bomberSecondTime = s16(state.bomberSecondTime + 0x1700);
          state.bomberSeconds = u8(state.bomberSeconds - 1);
          if (!state.bomberSeconds) {
            clearScreen(state.screen);
            this.requestRoom(103);
            this.wait(0x32, false);
            bombed(this);
            state.endingId = 2;
            state.bomberActive = 0;
          } else showMessage(this.context, `\`${s8(state.bomberSeconds)} second${s8(state.bomberSeconds) > 1 ? "s" : ""}`, 3, 5);
        }
      } else {
        state.bomberMinuteTime = s32(state.bomberMinuteTime - ticks);
        if (state.bomberMinuteTime < 0) {
          state.bomberMinuteTime = s32(state.bomberMinuteTime + 0x56400);
          state.bomberMinutes = u8(state.bomberMinutes - 1);
          if (state.bomberMinutes === 1) { state.bomberSecondTime = 0x1700; state.bomberSeconds = 60; }
          else showMessage(this.context, `\` Bomber will attack in ${s8(state.bomberMinutes)} minute${s8(state.bomberMinutes) > 1 ? "s" : ""}`, 3, 5);
        }
      }
    }
    if (state.sceneIndex === 0x39) state.paletteRotation = u16(state.paletteRotation + 1); // h0:20f6 -> h0:b180
    if (state.player && state.invulnerable) {
      state.invulnerabilityTime = s32(state.invulnerabilityTime - ticks);
      if (state.invulnerabilityTime < 0) { state.invulnerable = 0; this.sound(27); }
    }
    if (this.pollTimer(state.roomTimer) === 0) {
      if (state.sceneIndex === 0x66) {
        ending(this, s8(state.endingId));
        this.timers.thaw(state.roomTimer);
        this.timers.set(state.roomTimer, 0xf0);
        this.timers.enable(state.roomTimer, 1);
      } else if (state.backgroundDirty) {
        state.bomberActive = state.bomberMinutes = state.bomberSeconds = 1;
        state.bomberSecondTime = 0;
      } else {
        state.roomChange = 1;
        this.world.restorePlayerState(state);
        state.collisionHandled = state.roomAlert;
        state.lives = u8(state.lives - 1);
        if (state.lives === 1 && state.buildingFloor !== 0x59) state.oneLifePending = 1;
        state.exitReached = state.useDisabled = state.backgroundDirty = 0;
        if (state.demoPlayback) {
          state.demoPlayback = 0;
          state.titleRequested = 1;
          this.sound(0);
        }
      }
    }
  }
}
