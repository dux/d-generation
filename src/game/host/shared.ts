import type { GameSnapshot, MusicTrack } from "../index.ts";

// Shared memory between the page and the game worker (./src/game/host/worker.ts). The game's waits are synchronous
// (the intro, pause, endings and the cheat key reads block until enough PAL vblanks pass), so the game runs in a
// worker that sleeps in Atomics.wait once per vblank; the page writes input here and draws the frame buffer.

// control: Int32Array of CONTROL_INTS.
export const KEYS_WRITTEN = 0; // raw key events pushed by the page
export const KEYS_READ = 1; // raw key events delivered by the worker
export const SLEEP = 2; // Atomics.wait target of the worker's pacing (never notified)
export const SAVE = 3; // set by the page: the worker posts a snapshot after the current main-loop pass and clears it
export const RESTORE = 4; // set by the page after posting a restore message: the worker unwinds and loads it
export const JOY = 5; // ReadJoyPort(1) word of the first gamepad (the page polls it; workers have no Gamepad API)
export const FRAME = 6; // frame buffer sequence number, bumped after each picture
export const GIVE_GRENADES = 7; // added to by the page's +Grenade button: the worker hands them over and clears it
export const GIVE_BOMBS = 8; // the same for +Bomb
export const RESTART = 9; // set by the page's Restart level button: the worker restarts the floor and clears it
export const KEY_RING = 10; // ring of KEY_RING_SIZE Amiga raw key codes (bit 7 = release) and TYPED characters
export const TYPED = 0x100; // ring entry TYPED | character code: what the key typed, for the on-screen keyboard
export const KEY_RING_SIZE = 256;
export const CONTROL_INTS = KEY_RING + KEY_RING_SIZE;

// The displayed 320x200 picture as RGBA.
export const WIDTH = 320;
export const HEIGHT = 200;
export const FRAME_BYTES = WIDTH * HEIGHT * 4;

export type PageMessage =
  | {
    type: "start";
    demo: boolean; // true: boot into the story and attract; false: boot straight into a new game
    base: string; // the page's document.baseURI: game files are fetched relative to it
    control: SharedArrayBuffer;
    frame: SharedArrayBuffer;
    nonvolatile: [string, Uint8Array][]; // saved games (nonvolatile.library items) kept by the page
  }
  | { type: "restore"; snapshot: GameSnapshot };

export type WorkerMessage =
  | { type: "running" }
  | { type: "sounds"; ids: number[] }
  | { type: "music"; track: MusicTrack | null }
  | { type: "scene"; scene: number; screen: boolean }
  | { type: "nonvolatile"; key: string; data: Uint8Array | null } // StoreNV / DeleteNV, for the page to keep
  | { type: "snapshot"; snapshot: GameSnapshot } // SAVE answered
  | { type: "restored" }
  | { type: "quit" }
  | { type: "error"; message: string };
