import { TYPED } from "./shared.ts";
// KeyboardEvent.code -> Amiga raw key code (key positions of the US keyboard). The game's input.device handler
// (h0:130a4) turns direction keys into held bits and every other key into a translated character, so all of them
// are passed on; the game decides what it reads.
const AMIGA_KEYS: Record<string, number> = {
  Backquote: 0x00, Digit1: 0x01, Digit2: 0x02, Digit3: 0x03, Digit4: 0x04, Digit5: 0x05, Digit6: 0x06,
  Digit7: 0x07, Digit8: 0x08, Digit9: 0x09, Digit0: 0x0a, Minus: 0x0b, Equal: 0x0c, Backslash: 0x0d, Numpad0: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18,
  KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Numpad1: 0x1d, Numpad2: 0x1e, Numpad3: 0x1f,
  KeyA: 0x20, KeyS: 0x21, KeyD: 0x22, KeyF: 0x23, KeyG: 0x24, KeyH: 0x25, KeyJ: 0x26, KeyK: 0x27, KeyL: 0x28,
  Semicolon: 0x29, Quote: 0x2a, Numpad4: 0x2d, Numpad5: 0x2e, Numpad6: 0x2f, IntlBackslash: 0x30,
  KeyZ: 0x31, KeyX: 0x32, KeyC: 0x33, KeyV: 0x34, KeyB: 0x35, KeyN: 0x36, KeyM: 0x37, Comma: 0x38, Period: 0x39,
  Slash: 0x3a, NumpadDecimal: 0x3c, Numpad7: 0x3d, Numpad8: 0x3e, Numpad9: 0x3f,
  Space: 0x40, Backspace: 0x41, Tab: 0x42, NumpadEnter: 0x43, Enter: 0x44, Escape: 0x45, Delete: 0x46,
  NumpadSubtract: 0x4a, F1: 0x50, F2: 0x51, F3: 0x52, F4: 0x53, F5: 0x54, F6: 0x55, F7: 0x56, F8: 0x57,
  F9: 0x58, F10: 0x59, NumpadDivide: 0x5c, NumpadMultiply: 0x5d, NumpadAdd: 0x5e, Help: 0x5f, Insert: 0x5f,
  ShiftLeft: 0x60, ShiftRight: 0x61, CapsLock: 0x62, ControlLeft: 0x63, ControlRight: 0x63, AltLeft: 0x64,
  AltRight: 0x65,
};

// Held arrows go to the game as one direction key, since it takes the lowest held direction bit (h0:130a4 via
// h0:e548) and has its diagonals on keypad 7/9/1/3: up+left becomes keypad 7. Opposite arrows cancel.
const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};
const ARROW_KEYS = [[0x3d, 0x4c, 0x3f], [0x4f, 0, 0x4e], [0x1d, 0x4d, 0x1f]]; // [dy + 1][dx + 1]

// lowlevel.library ReadJoyPort() bits: game controller type, right/left/down/up, buttons 22/23.
const JP_TYPE_GAMECTLR = 1 << 28;
const JPF_RIGHT = 1, JPF_LEFT = 2, JPF_DOWN = 4, JPF_UP = 8;
const JPF_BUTTON_BLUE = 1 << 23; // h0:14c80 button 0
const JPF_BUTTON_RED = 1 << 22; // h0:14c80 button 1

// Keyboard events as Amiga raw key codes (bit 7 = release), in order; host hotkeys (by KeyboardEvent.code) are
// taken out of the stream.
export class HostInput {
  private readonly arrows = new Set<string>();
  private arrowKey = 0;
  private readonly listener = (e: KeyboardEvent) => this.key(e);

  constructor(
    private readonly send: (raw: number) => void,
    private readonly hotkeys: Record<string, () => void>,
    private readonly onKey: () => void,
  ) {
    window.addEventListener("keydown", this.listener);
    window.addEventListener("keyup", this.listener);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.listener);
    window.removeEventListener("keyup", this.listener);
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey) return;
    const down = e.type === "keydown";
    if (down) this.onKey();
    const hotkey = this.hotkeys[e.code];
    if (hotkey) {
      e.preventDefault();
      if (down && !e.repeat) hotkey();
      return;
    }
    if (ARROWS[e.code]) {
      e.preventDefault();
      if (down) this.arrows.add(e.code);
      else this.arrows.delete(e.code);
      let dx = 0, dy = 0;
      for (const arrow of this.arrows) [dx, dy] = [dx + ARROWS[arrow][0], dy + ARROWS[arrow][1]];
      const next = ARROW_KEYS[dy + 1][dx + 1];
      if (next === this.arrowKey) return;
      if (this.arrowKey) this.send(this.arrowKey | 0x80);
      if (next) this.send(next);
      this.arrowKey = next;
      return;
    }
    const code = AMIGA_KEYS[e.code];
    const typed = e.key === "Enter" ? 13 : e.key === "Backspace" ? 8 : e.key.length === 1 ? e.key.charCodeAt(0) : 0;
    if (code === undefined && !typed) return;
    e.preventDefault();
    // What the key types, for the host's on-screen keyboard typist (./src/game/host/typing.ts).
    if (down && typed && typed < 0x80) this.send(TYPED | typed);
    // Auto-repeat arrives as repeated presses, as input.device repeats a held key.
    if (code !== undefined) this.send(down ? code : code | 0x80);
  }
}

// First connected gamepad as a ReadJoyPort(1) value: stick or d-pad, button 0 BLUE, button 1 RED. Without one,
// a CD32 pad with nothing pressed (what the truth harness reports), which the game reads as idle.
export function readJoystick(): number {
  const pad = navigator.getGamepads?.().find((p) => p?.connected);
  if (!pad) return JP_TYPE_GAMECTLR;
  const pressed = (i: number) => !!pad.buttons[i]?.pressed;
  const [x = 0, y = 0] = pad.axes;
  let joy = JP_TYPE_GAMECTLR;
  if (x > 0.5 || pressed(15)) joy |= JPF_RIGHT;
  if (x < -0.5 || pressed(14)) joy |= JPF_LEFT;
  if (y > 0.5 || pressed(13)) joy |= JPF_DOWN;
  if (y < -0.5 || pressed(12)) joy |= JPF_UP;
  if (pressed(0)) joy |= JPF_BUTTON_BLUE;
  if (pressed(1)) joy |= JPF_BUTTON_RED;
  return joy >>> 0;
}
