import type { ActorContext, FrameInput } from "./model.ts";
import { s8, u16 } from "./int.ts";
import { updateBounds } from "./geometry.ts";

export interface DirectionEvent { time: number; direction: number; magnitude: number }
export interface ButtonEvent { time: number; code: number }
export interface DemoInputState {
  directions: readonly DirectionEvent[];
  buttons: readonly ButtonEvent[];
  previousButtons?: readonly boolean[];
  input?: FrameInput;
}

// h0:c8ce / h0:f292 / h0:b434: disk records are LE and runtime records are BE/aligned.
export class DemoInput {
  private readonly directions: DirectionEvent[] = [];
  private readonly buttons: ButtonEvent[] = [];
  private readonly previousButtons = [false, false];
  private input: FrameInput = {};

  constructor(bytes: Uint8Array) {
    if (bytes.length !== 7500) throw new Error(`AGA demo sequence has ${bytes.length} bytes, expected 7500`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 500; i++) {
      const at = i * 6;
      this.directions.push({ time: view.getUint32(at, true), direction: bytes[at + 4], magnitude: bytes[at + 5] });
    }
    for (let i = 0; i < 900; i++) {
      const at = 3000 + i * 5;
      this.buttons.push({ time: view.getUint32(at, true), code: bytes[at + 4] });
    }
  }

  setInput(input: FrameInput): void { this.input = input; }

  // The streams (recording rewrites them) and the button history, for Game.snapshot; the live input is not kept.
  save(): DemoInputState {
    return { directions: this.directions, buttons: this.buttons, previousButtons: this.previousButtons };
  }

  // Restores native input streams, including records changed by h0:b46e recording.
  restore(state: DemoInputState): void {
    if (state.directions.length !== 500 || state.buttons.length !== 900) throw new Error("AGA demo stream dimensions are invalid");
    for (let i = 0; i < 500; i++) this.directions[i] = { ...state.directions[i] };
    for (let i = 0; i < 900; i++) this.buttons[i] = { ...state.buttons[i] };
    this.previousButtons[0] = state.previousButtons?.[0] ?? false;
    this.previousButtons[1] = state.previousButtons?.[1] ?? false;
    this.input = state.input ?? {};
  }

  // h0:f292: consume every due direction change, keeping the last magnitude.
  readDirection(ctx: ActorContext): { direction: number; magnitude: number; heading: number } {
    const state = ctx.state;
    if (state.demoPlayback) {
      for (;;) {
        const event = this.directions[state.directionIndex];
        if (!event) throw new Error("demo direction stream exhausted");
        if (event.time > state.demoClock) break;
        state.directionIndex = u16(state.directionIndex + 1);
        if (event.direction === 100) {
          state.demoPlayback = 0;
          state.titleRequested = 1;
        } else {
          state.demoDirection = event.direction;
          state.demoMagnitude = event.magnitude;
        }
      }
      return { direction: s8(state.demoDirection), magnitude: s8(state.demoMagnitude), heading: s8(state.demoDirection) * 8 };
    }
    const direction = this.input.direction ?? -1;
    return { direction, magnitude: this.input.magnitude ?? (direction < 0 ? 0 : 40), heading: this.input.heading ?? direction * 8 };
  }

  // h0:b4e6/h0:b5de: button 1 consumes at most one record per poll.
  readButton(ctx: ActorContext, which: number): number {
    const state = ctx.state;
    if (!state.demoPlayback) {
      const held = !!(which === 0 ? this.input.fire : this.input.use);
      const was = this.previousButtons[which];
      this.previousButtons[which] = held;
      return held ? (was ? 2 : 1) : (was ? 3 : 4);
    }
    const event = this.buttons[state.demoIndex];
    if (!event) throw new Error("demo button stream exhausted");
    if (which === 0) {
      if (event.time <= state.demoClock && event.code === 50) {
        state.demoIndex = u16(state.demoIndex + 1);
        return 2;
      }
      return 4;
    }
    const was = state.demoButton;
    if (event.time <= state.demoClock) {
      if (event.code < 50) {
        state.demoButton = event.code;
        state.demoIndex = u16(state.demoIndex + 1);
      } else {
        this.playbackObject(ctx, event.code);
      }
    }
    return state.demoButton ? (was ? 4 : 3) : (was ? 2 : 1);
  }
  // h0:b46e: only the time long is overwritten in the two coordinate records.
  recordObject(ctx: ActorContext, id: number): void {
    const state = ctx.state;
    if (!state.demoRecording) return;
    const actor = ctx.objects.find(id);
    if (!actor) throw new Error(`demo recorder object ${id} not found`);
    const index = state.demoIndex;
    if (index + 2 >= this.buttons.length) throw new Error("demo button recording buffer exhausted");
    this.buttons[index] = { time: state.demoClock, code: (id + 100) & 255 };
    this.buttons[index + 1].time = actor.x;
    this.buttons[index + 2].time = actor.y;
    state.demoIndex = u16(index + 3);
  }

  // h0:b54e: recorded corrections are original demo behavior, not truth-capture input.
  private playbackObject(ctx: ActorContext, code: number): void {
    const state = ctx.state;
    const actor = code === 100 ? state.player : ctx.objects.find(code - 100);
    if (actor) {
      const x = this.buttons[state.demoIndex + 1], y = this.buttons[state.demoIndex + 2];
      if (!x || !y) throw new Error("demo object correction is truncated");
      actor.x = u16(x.time);
      actor.y = u16(y.time);
      updateBounds(actor);
    }
    state.demoIndex = u16(state.demoIndex + 3);
  }
}
