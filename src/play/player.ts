// Page side of the game: loads the files, starts the worker, draws the VGA screen (A000 + DAC) every animation
// frame and turns keyboard events into PC scancodes.
import gameFiles from "virtual:game-files";
import { CONTROL_INTS, KEYS_READ, KEYS_WRITTEN, KEY_RING, KEY_RING_SIZE, type StartMessage, type WorkerMessage } from "./shared.ts";

const SCREEN = 0xa0000;
const WIDTH = 320;
const HEIGHT = 200;

// KeyboardEvent.code -> scancode set 1 (arrows and the navigation block as their keypad codes, no E0 prefix).
const SCANCODES: Record<string, number> = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07, Digit7: 0x08,
  Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b, Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18,
  KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c, NumpadEnter: 0x1c, ControlLeft: 0x1d,
  ControlRight: 0x1d, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24,
  KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a, Backslash: 0x2b,
  KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34,
  Slash: 0x35, ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38, AltRight: 0x38, Space: 0x39,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
  Home: 0x47, Numpad7: 0x47, ArrowUp: 0x48, Numpad8: 0x48, PageUp: 0x49, Numpad9: 0x49, NumpadSubtract: 0x4a,
  ArrowLeft: 0x4b, Numpad4: 0x4b, Numpad5: 0x4c, ArrowRight: 0x4d, Numpad6: 0x4d, NumpadAdd: 0x4e, End: 0x4f,
  Numpad1: 0x4f, ArrowDown: 0x50, Numpad2: 0x50, PageDown: 0x51, Numpad3: 0x51, Insert: 0x52, Numpad0: 0x52,
  Delete: 0x53, NumpadDecimal: 0x53,
};

export interface GameHandle {
  stop(): void;
}

export async function startGame(canvas: HTMLCanvasElement, onStatus: (text: string) => void): Promise<GameHandle> {
  if (!crossOriginIsolated) throw new Error("the page needs cross-origin isolation (COOP/COEP headers) for SharedArrayBuffer");
  onStatus("loading game files");
  const files = await Promise.all(
    gameFiles.map(async (path): Promise<[string, ArrayBuffer]> => {
      const res = await fetch(`/dgener/${path}`);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return [path.replaceAll("/", "\\"), await res.arrayBuffer()];
    }),
  );
  const memory = new SharedArrayBuffer(0x100000);
  const dac = new SharedArrayBuffer(768);
  const control = new SharedArrayBuffer(CONTROL_INTS * 4);
  const ctrl = new Int32Array(control);
  const bytes = new Uint8Array(memory);
  const palette = new Uint8Array(dac);

  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
    if (data.type === "exit") onStatus(`game exited (${data.code})${data.output ? `: ${data.output}` : ""}`);
    else onStatus(`game crashed: ${data.message}`);
  };
  const start: StartMessage = { files, memory, dac, control };
  worker.postMessage(start, files.map(([, data]) => data));
  onStatus("running");

  const ctx = canvas.getContext("2d")!;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const image = ctx.createImageData(WIDTH, HEIGHT);
  const rgb = new Uint32Array(256);
  let frame = 0;
  const draw = () => {
    for (let i = 0; i < 256; i++) {
      const r = (palette[i * 3] << 2) | (palette[i * 3] >> 4);
      const g = (palette[i * 3 + 1] << 2) | (palette[i * 3 + 1] >> 4);
      const b = (palette[i * 3 + 2] << 2) | (palette[i * 3 + 2] >> 4);
      rgb[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
    const out = new Uint32Array(image.data.buffer);
    for (let i = 0; i < WIDTH * HEIGHT; i++) out[i] = rgb[bytes[SCREEN + i]];
    ctx.putImageData(image, 0, 0);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  const key = (release: boolean) => (e: KeyboardEvent) => {
    const code = SCANCODES[e.code];
    if (code === undefined || e.metaKey) return;
    e.preventDefault();
    // Auto-repeat arrives as repeated make codes, like a real keyboard's typematic repeat.
    const written = Atomics.load(ctrl, KEYS_WRITTEN);
    if (written - Atomics.load(ctrl, KEYS_READ) >= KEY_RING_SIZE) return;
    ctrl[KEY_RING + (written % KEY_RING_SIZE)] = code | (release ? 0x80 : 0);
    Atomics.store(ctrl, KEYS_WRITTEN, written + 1);
  };
  const down = key(false);
  const up = key(true);
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);

  return {
    stop() {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      worker.terminate();
    },
  };
}
