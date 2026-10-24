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
import type { Talker } from "../ui/talk/talk.ts";
import { gameFileReader } from "./files.ts";
import { keyboardShown, PadTypist } from "./typing.ts";
import {
  FRAME, GIVE_BOMBS, GIVE_GRENADES, HEIGHT, JOY, KEYS_READ, KEYS_WRITTEN, KEY_RING, KEY_RING_SIZE, RESTORE, SAVE, SLEEP,
  TYPED, WIDTH,
  type PageMessage, type WorkerMessage,
} from "./shared.ts";

const TICK_MS = 20; // PAL vblank
const MAX_LAG_MS = 250; // further behind (background tab, slow pass) the clock jumps instead of catching up
const LIVES = 5; // a new game's lives (h0:e4e)
const SCENES = 150;
// River in scene 75 gives her shield ("_21" on her topic 9) only at the end of one answer path; the browser hands it
// over as soon as a conversation with her starts. Her asked-topics word (+d0) records topic 9, so it happens once.
const RIVER_SCENE = 75;
const RIVER_GIFT_TOPIC = 9;
// +Grenade / +Bomb caps: the stats screen prints grenades with two digits, the inventory a bomb count with one.
const MAX_GRENADES = 99;
const MAX_BOMBS = 9;
// Leaving Derrida's room starts the hidden escape countdown (h0:3f54 sets g:d95e to 0x75800, about 100 s here);
// the browser makes it nine times as long, about 15 minutes. The later 0x3200 countdowns are left alone.
const ESCAPE_START = 0x75800;
const ESCAPE_STRETCH = 9;

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
  const readGameFile = gameFileReader(start.base);
  const [game, assets, ui] = await Promise.all([
    createGame(readGameFile, { demo: start.demo, storage: new PageNonVolatile(start.nonvolatile) }),
    loadAgaAssets(readGameFile),
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

  const giveRiverGift = () => {
    const state = game.state, talker = state.talk.talker as Talker | null;
    if (!state.talking || game.room.scene !== RIVER_SCENE || !talker?.surProfile) return;
    if (talker.surAsked & (1 << RIVER_GIFT_TOPIC)) return;
    talker.surAsked = (talker.surAsked | (1 << RIVER_GIFT_TOPIC)) >>> 0;
    state.shieldCount = (state.shieldCount + 1) & 0xff;
  };

  // The +Grenade and +Bomb buttons. Bombs are inventory item 0, kept in `portableLaserCount`.
  const giveItems = () => {
    const state = game.state;
    const grenades = Atomics.exchange(ctrl, GIVE_GRENADES, 0), bombs = Atomics.exchange(ctrl, GIVE_BOMBS, 0);
    if (grenades) state.ammo = Math.max(state.ammo, Math.min(MAX_GRENADES, state.ammo + grenades));
    if (bombs) state.portableLaserCount = Math.max(state.portableLaserCount, Math.min(MAX_BOMBS, state.portableLaserCount + bombs));
  };

  // A countdown that just started from the escape value (it only ever rises when set) gets stretched once.
  let lastEndingTime = game.state.endingTime;
  const stretchEscape = () => {
    const state = game.state;
    const started = state.roomEffect && state.endingTime > lastEndingTime && state.endingTime > ESCAPE_START / 2;
    if (started && state.endingTime <= ESCAPE_START) state.endingTime *= ESCAPE_STRETCH;
    lastEndingTime = state.endingTime;
  };

  let next = performance.now();
  const typist = new PadTypist();
  game.onTick = () => {
    if (Atomics.load(ctrl, RESTORE)) throw new GameInterrupt("restore requested");
    giveRiverGift();
    giveItems();
    const typing = keyboardShown(game);
    const rawKeyEvents: { key: number; down: boolean }[] = [];
    while (Atomics.load(ctrl, KEYS_READ) !== Atomics.load(ctrl, KEYS_WRITTEN)) {
      const read = Atomics.load(ctrl, KEYS_READ);
      const value = ctrl[KEY_RING + (read % KEY_RING_SIZE)]!;
      Atomics.store(ctrl, KEYS_READ, read + 1);
      if (value & TYPED) {
        if (typing) typist.type(value & 0xff);
        continue;
      }
      // While the on-screen keyboard is up, presses would only queue up as commands for after the prompt.
      if (typing && !(value & 0x80)) continue;
      rawKeyEvents.push({ key: value & 0x7f, down: !(value & 0x80) });
    }
    game.deliver({ rawKeyEvents, joy: typist.joy(game) ?? Atomics.load(ctrl, JOY) >>> 0 });
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
        // Unlimited lives in the browser: the lives counter (g:85d4) goes back to 5 after every pass, so the
        // ported game code stays as in the executable.
        if (game.state.lives < LIVES) game.state.lives = LIVES;
        stretchEscape();
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
