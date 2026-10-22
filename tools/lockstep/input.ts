import type { FrameInput } from "../../src/game/core/model.ts";

// Frame events apply at the top of a main-loop pass; tick events right after that cooperative tick's vblank
// servers (inside waits), which the native side reaches through Game.onTick.
export interface InputEvent {
  frame?: number;
  tick?: number;
  key?: number;
  down?: boolean;
  joy?: number;
  poke?: unknown;
}

export interface RawFrameInput extends FrameInput {
  readonly rawKeys: readonly number[];
  readonly rawKeyEvents: readonly { readonly key: number; readonly down: boolean }[];
}

export function parseEvents(text: string): InputEvent[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error("events file must contain a JSON array");
  for (const event of value as InputEvent[]) {
    const at = event.tick ?? event.frame;
    if (!Number.isInteger(at) || at! < 0 || (event.frame !== undefined && event.tick !== undefined)) throw new Error(`invalid input event time ${JSON.stringify(event)}`);
    if (event.key === undefined && event.joy === undefined && event.poke === undefined) throw new Error(`invalid input event ${JSON.stringify(event)}`);
    if (event.poke !== undefined && event.tick !== undefined) throw new Error(`pokes apply at frame boundaries only: ${JSON.stringify(event)}`);
    if (event.key !== undefined && (!Number.isInteger(event.key) || event.key < 0 || event.key > 0x7f)) throw new Error(`invalid Amiga raw key ${event.key}`);
    if (event.down !== undefined && typeof event.down !== "boolean") throw new Error(`invalid key state ${String(event.down)}`);
    if (event.joy !== undefined && (!Number.isInteger(event.joy) || event.joy < 0 || event.joy > 0xffffffff)) throw new Error(`invalid ReadJoyPort value ${event.joy}`);
  }
  // Same order as the harness record: frame events by frame, then tick events by tick.
  const events = (value as InputEvent[]).map(event => ({ ...event }));
  return [
    ...events.filter(event => event.tick === undefined).sort((a, b) => a.frame! - b.frame!),
    ...events.filter(event => event.tick !== undefined).sort((a, b) => a.tick! - b.tick!),
  ];
}

export class InputTimeline {
  private frameIndex = 0;
  private tickIndex = 0;
  private readonly keys = new Set<number>();
  private joy = 0x10000000;
  private readonly frames: readonly InputEvent[];
  private readonly ticks: readonly InputEvent[];

  constructor(events: readonly InputEvent[]) {
    this.frames = events.filter(event => event.tick === undefined && (event.key !== undefined || event.joy !== undefined));
    this.ticks = events.filter(event => event.tick !== undefined);
  }

  private apply(event: InputEvent, rawKeyEvents: { key: number; down: boolean }[]): void {
    if (event.joy !== undefined) this.joy = event.joy;
    if (event.key !== undefined) {
      const down = event.down !== false;
      if (down) this.keys.add(event.key);
      else this.keys.delete(event.key);
      rawKeyEvents.push({ key: event.key, down });
    }
  }

  // Input delivered at the h0:7b2 boundary of `frame`.
  at(frame: number): RawFrameInput {
    const rawKeyEvents: { key: number; down: boolean }[] = [];
    while (this.frameIndex < this.frames.length && this.frames[this.frameIndex]!.frame! <= frame) this.apply(this.frames[this.frameIndex++]!, rawKeyEvents);
    return { joy: this.joy, rawKeys: [...this.keys], rawKeyEvents };
  }

  // Input due after cooperative tick `clock`, or null.
  atTick(clock: number): RawFrameInput | null {
    const rawKeyEvents: { key: number; down: boolean }[] = [];
    let any = false;
    while (this.tickIndex < this.ticks.length && this.ticks[this.tickIndex]!.tick! <= clock) {
      this.apply(this.ticks[this.tickIndex++]!, rawKeyEvents);
      any = true;
    }
    return any ? { joy: this.joy, rawKeys: [...this.keys], rawKeyEvents } : null;
  }
}
