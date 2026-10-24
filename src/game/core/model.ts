import type { ObjectSpec, Room } from "../../formats/level.ts";
import type { Gfx } from "../render/gfx.ts";
import type { AgaRandom } from "./random.ts";
import type { AgaTimers } from "./timers.ts";
import type { ObjectSystem } from "./objects.ts";
import type { World } from "./world.ts";
import type { TalkState } from "../ui/talk/state.ts";
import type { InputState } from "./input.ts";
import type { ScreenState } from "../ui/screen.ts";

export interface FrameInput {
  direction?: number;
  fire?: boolean;
  use?: boolean;
  key?: number;
  joy?: number;
  magnitude?: number;
  heading?: number;
  run?: boolean;
  keyPressed?: boolean;
  keyCode?: number;
  rawKeys?: readonly number[];
  rawKeyEvents?: readonly { key: number; down: boolean }[];
}

// h0:bf34..c052: authored seven-byte cells expand to native eight-byte cells.
export interface RuntimeCell {
  walls: number;
  floorLines: number;
  wallVariants: number;
  tiles: number;
  padding: number;
  tileVariants: number;
}

export interface RuntimeRoom {
  cells: RuntimeCell[];
}

export function createRuntimeRoom(room: Room): RuntimeRoom {
  const mask = (indices: readonly number[]) => indices.reduce((bits, index) => bits | (1 << index), 0);
  const lanes = (digits: string) => {
    let low = 0, high = 0;
    for (let index = 0; index < 8; index++) {
      const value = Number(digits[index]);
      if (value & 1) low |= 1 << index;
      if (value & 2) high |= 1 << index;
    }
    return low | (high << 8);
  };
  return { cells: room.cells.flatMap(row => row.trim().split(/\s+/).map(name => {
    const cell = room.cellLegend[name];
    return {
      walls: cell.walls.reduce((bits, side) => bits | (2 << (side * 2)), cell.unknownWallBits ?? 0),
      floorLines: mask(cell.floorLines), wallVariants: lanes(cell.wallLineSelectors),
      tiles: mask(cell.tiles), padding: 0, tileVariants: lanes(cell.tileVariants),
    };
  })) };
}

export interface Actor {
  id: number;
  classId: number;
  poolIndex: number;
  removed: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  direction: number;
  frame: number;
  flags: number;
  firstLayer: number;
  packedPosition: number;
  previousPackedPosition: number;
  moved: number;
  speed: number;
  height: number;
  facing: number;
  previousHeight: number;
  movementHeading: number;
  collisionDisabled: number;
  activeThreat: number;
  noTurn: number;
  ownerId: number;
  ignoredClass: number;
  triggerOnly: number;
  boundsLeft: number;
  boundsTop: number;
  boundsRight: number;
  boundsBottom: number;
  outerLeft: number;
  outerTop: number;
  outerRight: number;
  outerBottom: number;
  // h0:b030/e2b2: three draw parts share the common sprite block (+0x20 frame pointers, +0xe6 mirror, +0xe7 enables, +0xed scheme).
  spriteEnabled: [number, number, number];
  spriteMirror: number;
  spriteScheme: number;
  spriteSets: number[];
  spritePaths: number[][];
  spriteOffsetX: number[];
  spriteOffsetY: number[];
  spriteMirrorWidth: number[];
  spriteShade: number;
  drawSuppressed: number;
}

export interface ActorMessage {
  type: number;
  sender: Actor | null;
  direction?: number;
  x?: number;
  y?: number;
  damage?: number;
  group?: number;
  previousX?: number;
  previousY?: number;
  switchAction?: number;
  noiseKind?: number;
}

export type GameEvent =
  | { type: "sound"; id: number }
  | { type: "message"; id?: number; text: string }
  | { type: "palette"; start: number; colors: readonly number[] }
  // Music phases: h0:77ec starts the loaded module, h0:16738/h0:c6f8 end it (null = no music).
  | { type: "music"; track: MusicTrack | null }
  // h0:31c0 key 0x11: the player quit the game (h0:2722 exit).
  | { type: "quit" };

export type MusicTrack = "dgen" | "dgen2";

// g:dcf4 holds one of the two modules or the amiga.eff samples (h0:c566, h0:c63c, h0:c6f8).
export interface MusicState {
  loaded: MusicTrack | "effects" | null;
  // h7:42: the module is playing until clock reaches endClock (harness CIA: one player call per PAL vblank).
  playing: number;
  endClock: number;
}

export interface GameState {
  sceneIndex: number;
  roomChange: number;
  frameTicks: number;
  movementTicks: number;
  movementScale: number;
  frameCounter: number;
  syncCounter: number;
  demoClock: number;
  demoPlayback: number;
  demoRecording: number;
  demoPending: number;
  attractIndex: number;
  attractVariant: number;
  demoIndex: number;
  directionIndex: number;
  demoButton: number;
  demoDirection: number;
  demoMagnitude: number;
  titleRequested: number;
  menuRequested: number;
  abortFrame: number;
  suppressPlayer: number;
  paused: number;
  slowMotion: number;
  slowFrameTicks: number;
  ammo: number;
  throwableAvailable: number;
  useDisabled: number;
  carriedBombs: number;
  deathPending: number;
  slowMotionTime: number;
  lives: number;
  buildingFloor: number;
  bombsFound: number;
  bomberActive: number;
  bomberMinutes: number;
  bomberSeconds: number;
  bomberMinuteTime: number;
  bomberSecondTime: number;
  endingTime: number;
  nextObjectId: number;
  player: Actor | null;
  currentObject: Actor | null;
  postObject: Actor | null;
  receiver: Actor | null;
  sender: Actor | null;
  spawned: Actor | null;
  frameTimer: number;
  roomTimer: number;
  visited: boolean[];
  survivorIndex: number;
  round: number;
  portableLaserCount: number;
  shieldCount: number;
  doorSaveSlots: number;
  scrollX: number;
  scrollY: number;
  roomLeft: number;
  roomTop: number;
  roomWidth: number;
  roomHeight: number;
  occupancy: Uint8Array;
  occupancyScene: number;
  generatorOverride: number;
  frontShapeSet: number;
  paletteTop: number;
  paletteBottom: number;
  paletteColor: number;
  slowMotionCount: number;
  rescuedCount: number;
  spawnX: number;
  spawnY: number;
  spawnDirection: number;
  inventoryAvailability: number;
  playerPadding: number;
  invulnerable: number;
  shieldPadding: number;
  invulnerabilityTime: number;
  specialItemCollected: number;
  floorSecurityState: number;
  floorSecurityCode: number;
  cubeItems: number[];
  roomResilience: number[];
  flashTimer: number;
  flashMessage: number;
  paletteTimer: number;
  paletteStep: number;
  forceRedraw: number;
  // g:3f9b: h0:122fe stamps delta entry g:dd90 of the room set at g:dd91,g:dd92 (the creature's gore) once.
  gorePending: number;
  goreEntry: number;
  goreX: number;
  goreY: number;
  // The gore is in the room bitmap g:87fe since that stamp; a room entry redraws the bitmap without it.
  goreShown: number;
  // h0:c4e -> h0:77fe(g:dafa): a full flash ends on plain DGEN.PAL, without the room's scheme and light colours,
  // until the next room entry writes them again.
  dgenPalette: number;
  backgroundDirty: number;
  roomEffect: number;
  collisionHandled: number;
  roomAlert: number;
  shakeScript: readonly number[];
  shakeRestoreScript: readonly number[];
  // h0:b7aa/b746 panel message: pending text, 55-tick time units, font and colour bytes, shown flag, timer slot, text origin.
  messageText: string;
  messageTime: number;
  messageFont: number;
  textColor: number;
  messageShown: number;
  messageTimer: number;
  messageX: number;
  messageY: number;
  panelTop: number;
  // g:64e0 scene index of the last drawn room; g:231 player palette variant loaded by h0:1222.
  drawnScene: number;
  playerPalette: number;
  // g:4d0: the next room entry shows the copyright line (initial data 1).
  copyrightPending: number;
  // Text currently blitted into the panel bitmap by h0:b6a8 (native stand-in for those panel pixels).
  panelText: string;
  clipBottom: number;
  // g:4e6: the scene-1 arrival sled has played this game (h0:1030); g:6583: the title sled is still descending (h0:12c62).
  arrivalShown: number;
  titleAnimation: number;
  // g:de68: CD32 menu selection; display records preserve its direct bitmap writes during cooperative waits.
  padItem: number;
  padDisplay: ({ op: "menu" } | { op: "invert"; item: number } | { op: "restore" })[];
  // Screen content outside room play (title, story, ending); mode "room" means the play screen.
  screen: ScreenState;
  // g:53e: the story has played since the last ending; g:d996: clip saved by the title; g:3ba2: input cursor flag.
  storyShown: number;
  savedClip: number;
  textCursor: number;
  // g:d99a: music clock (h0:3104 seconds) when the title module started.
  musicClock: number;
  music: MusicState;
  // g:23f ending id shown when the room timer expires in scene 0x66; g:bfc selects ending 3 over 4 (h0:73de).
  endingId: number;
  endingAlt: number;
  // g:23b "One life remaining." and g:23c "Previously Saved Game Restored" on the next room entry (h0:1030).
  oneLifePending: number;
  restoredPending: number;
  // g:23d: set by the exit (h0:3f54) and cheat 0x94, cleared on death and restore.
  exitReached: number;
  // g:82c cheat armed (keys 0x91 0x92 0x92 0xa0); g:2e88 sound muted; g:53f toggled by key 0xa5 (no reader).
  cheatArmed: number;
  muted: number;
  keyToggle: number;
  // g:8c0e/g:8c86: last playfield key from h0:31c0; g:4eb: a conversation is running (h0:135ac loop).
  playfieldKey: number;
  playfieldKeyPending: number;
  talking: number;
  // g:d927/g:d928: position of the generator that chased the player out of scene g:d926 (h0:d66).
  chaserX: number;
  chaserY: number;
  // g:4ec: h0:3622 busy-wait step counter; g:232/g:6580: the red flash after h0:1dd2 (h0:1d8a).
  waitSteps: number;
  redFlash: number;
  redFlashLevel: number;
  // h0:b180 calls in scene 58 (each rotates DGEN colours 64..191 by one in g:db0a); DEMO%d.SEQ last loaded.
  paletteRotation: number;
  demoSequence: number;
  // Keyboard and joystick as the input handler h0:12f2c/h0:130a4 leaves them.
  input: InputState;
  // Conversation, inventory and terminal state (./src/game/ui/talk); g:dc2a: timer slot of the h0:bc62 delays.
  talk: TalkState;
  delayTimer: number;
  random: AgaRandom;
  timers: AgaTimers;
}

export interface ActorContext {
  state: GameState;
  objects: ObjectSystem;
  random: AgaRandom;
  timers: AgaTimers;
  room: Room;
  runtimeRoom: RuntimeRoom;
  input: FrameInput;
  world: World;
  emit(event: GameEvent): void;
  // h0:3edc: the exit object passes, then (when the map has a neighbour) the room change to `scene`.
  exitRoom(scene: number | null): void;
  departLift(scene: number): void;
  // h0:43a6: immediate room transition without a provisional player.
  requestRoom(scene: number): void;
  // h0:7c94: a story room change that brings the player along (scene indexes 0x89/0x39/0x44), sound 0x21, flash.
  storyTransition(scene: number): void;
  // Cooperative PAL tick, including palette/input servers and host pacing.
  vblank(): void;
  // h0:304c: synchronous wait of `ticks` timer counts; 0 on expiry, 1 for a button, else the key code.
  wait(ticks: number, interruptible: boolean): number;
  // h0:357c: wait for a key or button (Esc for button 0, Enter for button 1); click plays sound 0x13.
  waitKey(click: number): number;
  // h0:1dd2: the bombed explosion picture and flash.
  bombed(): void;
  // h0:7542: an ending screen, then the title (runs synchronously until the title returns).
  ending(id: number): void;
  saveCheckpoint(): void;
  restartCheckpoint(): void;
  readButton(which: number): number;
  readDirection(): { direction: number; magnitude: number; heading: number };
  recordObject(id: number): void;
  // h0:908a: the computer terminal of the current scene (./src/game/ui/terminal).
  terminal(): void;
}

export interface ActorClass<T extends Actor = Actor> {
  id: number;
  name: string;
  createState?(): Partial<T>;
  init(context: ActorContext, actor: T, spec: ObjectSpec): void;
  update?(context: ActorContext, actor: T): void;
  message?(context: ActorContext, actor: T, message: ActorMessage): number;
  post?(context: ActorContext, actor: T): void;
  draw?(context: ActorContext, actor: T, gfx: Gfx): void;
  // h0:b030: state a class draw handler changes in the original draw pass (simulation side; render draw must not).
  prepareDraw?(context: ActorContext, actor: T): void;
  save?(context: ActorContext, actor: T): ObjectSpec;
}
