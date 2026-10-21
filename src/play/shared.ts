// Shared state between the page and the game worker (SharedArrayBuffers, so the page can draw while the game's
// blocking loops run in the worker).

// control: Int32Array of CONTROL_INTS.
export const KEYS_WRITTEN = 0; // scancodes pushed by the page
export const KEYS_READ = 1; // scancodes delivered by the worker
export const SLEEP = 2; // Atomics.wait target for the worker's real-time pacing (never notified)
export const KEY_RING = 3; // ring of KEY_RING_SIZE scancodes
export const KEY_RING_SIZE = 256;
export const CONTROL_INTS = KEY_RING + KEY_RING_SIZE;

export interface StartMessage {
  files: [string, ArrayBuffer][];
  memory: SharedArrayBuffer; // 1 MB real-mode address space
  dac: SharedArrayBuffer; // 768 bytes, 6-bit VGA DAC
  control: SharedArrayBuffer;
}

export type WorkerMessage = { type: "exit"; code: number; output: string } | { type: "error"; message: string };
