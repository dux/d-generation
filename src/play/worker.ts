// Runs the ported game: boot, then the frame loop, in real time. Waits are real (Atomics.wait), so the original's
// blocking loops (title delays, menus) run unchanged.
import "../engine/index.ts";
import type { Track } from "../audio/music.ts";
import { bootGame } from "../engine/boot.ts";
import { PLAYER_STATE, gameFrame } from "../engine/core/game.ts";
import { DosExit, Machine, keyboardInterrupt } from "../engine/dos/machine.ts";
import { DEMO_ENDED } from "../engine/geometry/math.ts";
import type { Memory } from "../engine/memory.ts";
import { PLAYBACK } from "../engine/misc/input.ts";
import { KEYS_READ, KEYS_WRITTEN, KEY_RING, KEY_RING_SIZE, SLEEP, type StartMessage, type WorkerMessage } from "./shared.ts";

const PIT_HZ = 1193182;
const LIVES = 5; // the game's starting lives (0:1f87)

function post(message: WorkerMessage): void {
  postMessage(message);
}

self.onmessage = (event: MessageEvent<StartMessage>) => {
  const { files, memory, dac, control } = event.data;
  const ctrl = new Int32Array(control);
  const dos = new Machine(files.map(([name, data]) => [name, new Uint8Array(data)]));
  let m: Memory | null = null;

  const deliverKeys = () => {
    if (!m) return;
    while (Atomics.load(ctrl, KEYS_READ) !== Atomics.load(ctrl, KEYS_WRITTEN)) {
      const read = Atomics.load(ctrl, KEYS_READ);
      keyboardInterrupt(m, ctrl[KEY_RING + (read % KEY_RING_SIZE)]);
      Atomics.store(ctrl, KEYS_READ, read + 1);
    }
  };

  // One timer tick per call (see dos/hardware.ts waitTick), at the rate the game programmed into the PIT.
  let next = performance.now();
  dos.pace = () => {
    deliverKeys();
    next += (1000 * (dos.pitDivisor || 0x10000)) / PIT_HZ;
    const wait = next - performance.now();
    if (wait > 0) Atomics.wait(ctrl, SLEEP, 0, wait);
    else if (wait < -250) next = performance.now(); // fell far behind (tab in background): don't race to catch up
  };
  dos.idle = () => {
    deliverKeys();
    Atomics.wait(ctrl, SLEEP, 0, 4);
  };
  dos.saved = (path, data) => post({ type: "saved", path, data: data.slice().buffer });

  // Amiga music by game phase (the DOS game has none): title and demo, then the game itself.
  let track: Track | null = null;
  const cue = (next: Track) => {
    if (next === track) return;
    track = next;
    post({ type: "music", track });
  };

  try {
    cue("dgen");
    m = bootGame(dos, new Uint8Array(memory), new Uint8Array(dac));
    // Unlimited lives: top the counter back up after every frame, so a lost life never reaches the checkpoint
    // restart. The ported game code itself stays as in GAME.EXE.
    while (!gameFrame(m)) {
      if (m.u8(PLAYER_STATE) < LIVES) m.set8(PLAYER_STATE, LIVES);
      cue(m.u8(PLAYBACK) || m.u8(DEMO_ENDED) ? "dgen" : "dgen2");
    }
    post({ type: "exit", code: 0, output: dos.output });
  } catch (err) {
    if (err instanceof DosExit) post({ type: "exit", code: err.code, output: dos.output });
    else post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
