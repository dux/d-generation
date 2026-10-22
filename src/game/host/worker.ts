// Runs the native game in a worker, in real time: boot, then main-loop passes. Every cooperative PAL vblank
// (Game.onTick) sleeps until its 20 ms slot, takes the page's input and draws, so the original's synchronous
// waits (intro, pause, endings) run unchanged while the page stays responsive.
import { Screen } from "../../render/screen.ts";
import { createGame, GameInterrupt, MemoryNonVolatile, renderGame, renderPalette, type GameSnapshot } from "../index.ts";
import { loadAgaAssets } from "../render/assets.ts";
import { roomImage } from "../render/room.ts";
import { loadUiAssets } from "../ui/assets.ts";
import { drawPadMenu } from "../ui/padmenu-render.ts";
import { renderScreen } from "../ui/render.ts";
import { readGameFile } from "./files.ts";
import {
  FRAME, HEIGHT, JOY, KEYS_READ, KEYS_WRITTEN, KEY_RING, KEY_RING_SIZE, RESTORE, SAVE, SLEEP, WIDTH,
  type PageMessage, type WorkerMessage,
} from "./shared.ts";

const TICK_MS = 20; // PAL vblank
const MAX_LAG_MS = 250; // further behind (background tab, slow pass) the clock jumps instead of catching up
const SCENES = 150;

function post(message: WorkerMessage): void {
  postMessage(message);
}

// nonvolatile.library over the page's saved items: the worker keeps a copy and reports every change.
class PageNonVolatile extends MemoryNonVolatile {
  constructor(items: [string, Uint8Array][]) {
    super();
    for (const [key, data] of items) this.items.set(key, data);
  }

  override store(app: string, item: string, data: Uint8Array): number {
    const result = super.store(app, item, data);
    post({ type: "nonvolatile", key: `${app}/${item}`, data: data.slice() });
    return result;
  }

  override delete(app: string, item: string): void {
    super.delete(app, item);
    post({ type: "nonvolatile", key: `${app}/${item}`, data: null });
  }
}

// Restore snapshots posted by the page; the worker only reads them after unwinding to its event loop.
const restores: GameSnapshot[] = [];
let restoreArrived: (() => void) | null = null;

self.onmessage = (event: MessageEvent<PageMessage>) => {
  const message = event.data;
  if (message.type === "restore") {
    restores.push(message.snapshot);
    restoreArrived?.();
    return;
  }
  run(message).catch((error: unknown) => {
    post({ type: "error", message: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
  });
};

async function nextRestore(): Promise<GameSnapshot> {
  while (!restores.length) {
    const { promise, resolve } = Promise.withResolvers<void>();
    restoreArrived = resolve;
    await promise;
  }
  restoreArrived = null;
  return restores.splice(0).at(-1)!;
}

async function run(start: Extract<PageMessage, { type: "start" }>): Promise<void> {
  const ctrl = new Int32Array(start.control);
  const shared = new Uint8ClampedArray(start.frame);
  const rgba = new Uint8ClampedArray(shared.length);
  const [game, assets, ui] = await Promise.all([
    createGame(readGameFile, { demo: start.demo, storage: new PageNonVolatile(start.nonvolatile) }),
    loadAgaAssets((path) => readGameFile(`amiga/aga/${path}`)),
    loadUiAssets(readGameFile),
  ]);
  // Room pictures are decoded up front: the worker cannot await a load in the middle of a pass.
  const images = new Set<string>();
  for (let scene = 1; scene <= SCENES; scene++) {
    const name = roomImage(scene);
    if (name) images.add(name);
  }
  await Promise.all([...images].map((name) => assets.vim(name)));

  const screen = new Screen(WIDTH, HEIGHT);
  const screenObjects = { game, assets };
  const draw = () => {
    let palette: Uint8Array;
    if (game.state.screen.mode === "screen") palette = renderScreen(screen, game.state.screen, ui, screenObjects);
    else {
      renderGame(screen, game, assets);
      palette = renderPalette(game, assets);
    }
    drawPadMenu(screen, game.state, ui.padMenu);
    shared.set(screen.toRGBA(palette, false, rgba));
    Atomics.add(ctrl, FRAME, 1);
  };

  let scene = -1, screenMode = false;
  const flush = () => {
    const sounds: number[] = [];
    for (const event of game.events.splice(0)) {
      if (event.type === "sound") sounds.push(event.id);
      else if (event.type === "music") post({ type: "music", track: event.track });
    }
    if (sounds.length) post({ type: "sounds", ids: sounds });
    const mode = game.state.screen.mode === "screen";
    if (game.room.scene !== scene || mode !== screenMode) {
      scene = game.room.scene;
      screenMode = mode;
      post({ type: "scene", scene, screen: mode });
    }
  };

  let next = performance.now();
  game.onTick = () => {
    if (Atomics.load(ctrl, RESTORE)) throw new GameInterrupt("restore requested");
    const rawKeyEvents: { key: number; down: boolean }[] = [];
    while (Atomics.load(ctrl, KEYS_READ) !== Atomics.load(ctrl, KEYS_WRITTEN)) {
      const read = Atomics.load(ctrl, KEYS_READ);
      const raw = ctrl[KEY_RING + (read % KEY_RING_SIZE)]!;
      rawKeyEvents.push({ key: raw & 0x7f, down: !(raw & 0x80) });
      Atomics.store(ctrl, KEYS_READ, read + 1);
    }
    game.deliver({ rawKeyEvents, joy: Atomics.load(ctrl, JOY) >>> 0 });
    flush();
    draw();
    next += TICK_MS;
    const wait = next - performance.now();
    if (wait > 0) Atomics.wait(ctrl, SLEEP, 0, wait);
    else if (wait < -MAX_LAG_MS) next = performance.now();
  };

  post({ type: "running" });
  for (;;) {
    try {
      if (!game.booted) game.boot();
      for (;;) {
        game.frame();
        flush();
        if (game.quitRequested) {
          draw();
          post({ type: "quit" });
          return;
        }
        // Only between passes: a snapshot never holds a half-done pass.
        if (Atomics.exchange(ctrl, SAVE, 0)) post({ type: "snapshot", snapshot: game.snapshot() });
      }
    } catch (error) {
      if (!(error instanceof GameInterrupt)) throw error;
      game.restore(await nextRestore());
      post({ type: "sounds", ids: [0] });
      const music = game.state.music;
      post({ type: "music", track: music.playing && music.loaded !== "effects" ? music.loaded : null });
      Atomics.store(ctrl, RESTORE, 0);
      next = performance.now();
      draw();
      flush();
      post({ type: "restored" });
    }
  }
}
