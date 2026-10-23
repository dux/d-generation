import type { GameSnapshot } from "../index.ts";
import type { HostAudio } from "./audio.ts";
import { HostInput, readJoystick } from "./input.ts";
import {
  CONTROL_INTS, FRAME, FRAME_BYTES, HEIGHT, JOY, KEYS_READ, KEYS_WRITTEN, KEY_RING, KEY_RING_SIZE, RESTORE, SAVE, WIDTH,
  type PageMessage, type WorkerMessage,
} from "./shared.ts";

// The AGA screen: one 320x200 8-bitplane PAL lowres bitmap (AllocBitMap planes of 40x200 bytes), shown with
// square pixels (PAL lowres pixels are within 4% of square). The canvas fills its box at any scale: frames are
// drawn without smoothing at the next whole multiple of 320x200, then the browser scales that down smoothly, so
// every game pixel keeps the same width.

// Saved games (nonvolatile.library items, 40 bytes each) as base64 under this prefix.
const NONVOLATILE_PREFIX = "d-generation-aga-nv:";
// F5 save states (Game.snapshot) in IndexedDB.
const SNAPSHOT_DB = "d-generation-aga";
const SNAPSHOT_STORE = "snapshots";
const SNAPSHOT_KEY = "f5";

export interface AgaHostOptions {
  canvas: HTMLCanvasElement;
  box: HTMLElement; // the canvas is scaled to fill it at the game's aspect ratio
  audio: HostAudio;
  demo: boolean; // true: boot into the story, title and attract; false: boot straight into a new game
  onStatus: (text: string) => void;
  onStop: (error: unknown) => void;
}

export interface AgaHandle {
  stop(): void;
  save(): void; // F5: save state after the current main-loop pass
  restore(): void; // F9: back to the last saved state
}

function savedItems(): [string, Uint8Array][] {
  const items: [string, Uint8Array][] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith(NONVOLATILE_PREFIX)) continue;
    items.push([key.slice(NONVOLATILE_PREFIX.length), Uint8Array.from(atob(localStorage.getItem(key)!), (c) => c.charCodeAt(0))]);
  }
  return items;
}

function keepItem(key: string, data: Uint8Array | null): void {
  if (data) localStorage.setItem(NONVOLATILE_PREFIX + key, btoa(String.fromCharCode(...data)));
  else localStorage.removeItem(NONVOLATILE_PREFIX + key);
}

function openSnapshots(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open(SNAPSHOT_DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(SNAPSHOT_STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

function snapshotRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const transaction = db.transaction(SNAPSHOT_STORE, mode);
  const req = run(transaction.objectStore(SNAPSHOT_STORE));
  transaction.oncomplete = () => resolve(req.result);
  transaction.onabort = () => reject(transaction.error ?? req.error);
  return promise;
}

// Runs the native game in a worker (./src/game/host/worker.ts) and shows its frames. The game's waits are
// synchronous, so it cannot share the page's thread: the worker sleeps per PAL vblank and the page only draws,
// forwards keys, gamepad and sounds, and keeps saved games and F5 snapshots.
export async function startAga(options: AgaHostOptions): Promise<AgaHandle> {
  if (!crossOriginIsolated) throw new Error("the page needs cross-origin isolation (COOP/COEP headers) for SharedArrayBuffer");
  const { canvas, box, audio, onStatus } = options;
  const help = `${options.demo ? "Title" : "New game"} - arrows/keypad move, Esc pause, F5 save state, F9 restore state`;
  const control = new SharedArrayBuffer(CONTROL_INTS * 4);
  const frame = new SharedArrayBuffer(FRAME_BYTES);
  const ctrl = new Int32Array(control);
  Atomics.store(ctrl, JOY, readJoystick());

  const source = new OffscreenCanvas(WIDTH, HEIGHT);
  const sourceCtx = source.getContext("2d")!;
  const image = sourceCtx.createImageData(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d")!;
  const pixels = new Uint8ClampedArray(frame);
  const paint = () => ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  // The largest size that fits the box, and the canvas moved onto the device pixel grid (the page may sit it at a
  // fractional device position, which would blur a whole-multiple scale).
  const fit = () => {
    const ratio = devicePixelRatio;
    const scale = Math.min((box.clientWidth * ratio) / WIDTH, (box.clientHeight * ratio) / HEIGHT);
    const whole = Math.max(1, Math.ceil(scale));
    if (canvas.width !== WIDTH * whole) {
      canvas.width = WIDTH * whole; // resets the context state
      canvas.height = HEIGHT * whole;
      ctx.imageSmoothingEnabled = false;
      paint();
    }
    canvas.style.width = `${(WIDTH * scale) / ratio}px`;
    canvas.style.height = `${(HEIGHT * scale) / ratio}px`;
    canvas.style.margin = "0";
    const { left, top } = canvas.getBoundingClientRect();
    canvas.style.marginLeft = `${(Math.ceil(left * ratio) - left * ratio) / ratio}px`;
    canvas.style.marginTop = `${(Math.ceil(top * ratio) - top * ratio) / ratio}px`;
  };
  const resize = new ResizeObserver(fit);
  resize.observe(box);
  // Zoom and moving to another screen change devicePixelRatio without resizing the box.
  let resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  const refit = () => {
    resolution.removeEventListener("change", refit);
    resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    resolution.addEventListener("change", refit);
    fit();
  };
  resolution.addEventListener("change", refit);
  fit();

  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const postToWorker = (message: PageMessage) => worker.postMessage(message);
  let stopped = false;
  let animation = 0;
  let input: HostInput | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(animation);
    worker.terminate();
    resize.disconnect();
    resolution.removeEventListener("change", refit);
    input?.dispose();
    audio.stopAll();
    audio.cue(null);
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    options.onStop(error);
  };

  let scene = "";
  const status = (note = "") => onStatus(`${help}  |  ${scene}${note ? `  |  ${note}` : ""}`);
  const snapshots = openSnapshots();
  const saveState = async (snapshot: GameSnapshot) => {
    await snapshotRequest(await snapshots, "readwrite", (store) => store.put(snapshot, SNAPSHOT_KEY));
    status("state saved");
  };
  const restoreState = async () => {
    const snapshot = await snapshotRequest<GameSnapshot | undefined>(await snapshots, "readonly", (store) => store.get(SNAPSHOT_KEY));
    if (!snapshot) return status("no saved state yet");
    if (Atomics.load(ctrl, RESTORE)) return; // the previous restore is still pending
    postToWorker({ type: "restore", snapshot });
    Atomics.store(ctrl, RESTORE, 1);
  };

  worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
    switch (data.type) {
      case "running":
        status();
        break;
      case "sounds":
        for (const id of data.ids) audio.play(id);
        break;
      case "music":
        audio.cue(data.track);
        break;
      case "scene":
        scene = data.screen ? "title/story screen" : `scene ${data.scene}`;
        status();
        break;
      case "nonvolatile":
        keepItem(data.key, data.data);
        break;
      case "snapshot":
        saveState(data.snapshot).catch((error) => status(`save failed: ${error}`));
        break;
      case "restored":
        status("state restored");
        break;
      case "quit":
        stop();
        onStatus("The game quit (Ctrl+Q). Choose Title or New game to start again.");
        break;
      case "error":
        fail(new Error(data.message));
        break;
    }
  };
  worker.onerror = (event) => fail(new Error(event.message || "game worker failed to start"));

  const save = () => Atomics.store(ctrl, SAVE, 1);
  const restore = () => restoreState().catch((error) => status(`restore failed: ${error}`));
  input = new HostInput(
    (raw) => {
      const written = Atomics.load(ctrl, KEYS_WRITTEN);
      if (written - Atomics.load(ctrl, KEYS_READ) >= KEY_RING_SIZE) return;
      ctrl[KEY_RING + (written % KEY_RING_SIZE)] = raw;
      Atomics.store(ctrl, KEYS_WRITTEN, written + 1);
    },
    { F5: save, F9: () => void restore() },
    () => audio.unlock(),
  );

  onStatus("Loading...");
  postToWorker({ type: "start", demo: options.demo, base: document.baseURI, control, frame, nonvolatile: savedItems() });

  let shown = 0;
  const draw = () => {
    Atomics.store(ctrl, JOY, readJoystick());
    const sequence = Atomics.load(ctrl, FRAME);
    if (sequence !== shown) {
      shown = sequence;
      image.data.set(pixels);
      sourceCtx.putImageData(image, 0, 0);
      paint();
    }
    animation = requestAnimationFrame(draw);
  };
  animation = requestAnimationFrame(draw);
  return { stop, save, restore: () => void restore() };
}
