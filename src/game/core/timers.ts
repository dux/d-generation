import { s8, s16, u8, u16, u32 } from "./int.ts";

export interface AgaTimerSlot {
  flags: number;
  counter: number;
}

// clock counts PAL vblanks (50 Hz, host pacing); gameClock is g:44ac, the 60 Hz timer ISR count;
// vblankDivider is h10:210, which makes every fifth blank run the ISR twice.
export interface AgaTimerState {
  clock: number;
  gameClock: number;
  slots: AgaTimerSlot[];
  vblankDivider: number;
}

export class AgaTimers {
  readonly state: AgaTimerState;

  // h0:14522: seven cleared flag words; initial BSS counters and clock are zero.
  constructor(state?: AgaTimerState) {
    if (state && state.slots.length !== 7) throw new Error("AGA timers require seven slots");
    this.state = state ? {
      clock: u32(state.clock),
      gameClock: u32(state.gameClock),
      vblankDivider: s16(state.vblankDivider),
      slots: state.slots.map(slot => ({ flags: u16(slot.flags), counter: u16(slot.counter) })),
    } : { clock: 0, gameClock: 0, vblankDivider: 0, slots: Array.from({ length: 7 }, () => ({ flags: 0, counter: 0 })) };
  }

  // h0:12730: claims the first free slot; raw indexed extensions use scale four.
  allocate(): number {
    for (let i = 0; i < 7; i++) {
      if (this.state.slots[i].flags & 1) continue;
      this.state.slots[i].flags = (this.state.slots[i].flags | 1) & 0xfff9;
      this.set(i, 0);
      return i;
    }
    return -1;
  }

  // h0:14576: only the slot's flag word is cleared.
  free(index: number): void {
    this.state.slots[this.index(index)].flags = 0;
  }

  // h0:1458a via h0:5d10: raw 31860402 has index extension 0402 (scale four).
  set(index: number, value: number): void {
    this.state.slots[this.index(index)].counter = u16(value);
  }

  // h0:1462a: read the selected slot's unsigned counter word.
  get(index: number): number {
    return this.state.slots[this.index(index)].counter;
  }

  // h0:145a4, reached through h0:5d16: bit 2 selects countdown, not enabled state.
  enable(index: number, on: number | boolean): void {
    const slot = this.state.slots[this.index(index)];
    slot.flags = u8(Number(on)) ? slot.flags | 4 : slot.flags & 0xfffb;
  }

  // h0:145de, reached through h0:5d22: sets bit 1, which makes the ISR count.
  freeze(index: number): number {
    const value = this.get(index);
    this.state.slots[this.index(index)].flags |= 2;
    return value;
  }

  // h0:14606: clears bit 1, stopping this timer, and returns its counter.
  thaw(index: number): number {
    this.state.slots[this.index(index)].flags &= 0xfffd;
    return this.get(index);
  }

  // h0:1463e: the previous counter word is returned before writing the new word.
  exchange(index: number, value: number): number {
    const previous = this.get(index);
    this.set(index, value);
    return previous;
  }

  // h0:144b2: flag test extension 7401 indexes d7.w*4+1, not d7.w+1.
  tick(ticks = 1): void {
    for (let tick = 0; tick < ticks; tick++) {
      this.state.gameClock = u32(this.state.gameClock + 1);
      for (let i = 0; i < 7; i++) {
        const slot = this.state.slots[i];
        if (!(slot.flags & 2)) continue;
        if (slot.flags & 4) {
          if (slot.counter !== 0) slot.counter--;
        } else slot.counter = u16(slot.counter + 1);
      }
    }
  }

  // h10:224..234: PAL vblank runs the 60 Hz timer ISR once, twice every fifth blank.
  vblank(ticks = 1): void {
    for (let tick = 0; tick < ticks; tick++) {
      this.state.clock = u32(this.state.clock + 1);
      this.tick();
      const divider = s16(this.state.vblankDivider - 1);
      if (divider < 0) {
        this.tick();
        this.state.vblankDivider = 4;
      } else this.state.vblankDivider = divider;
    }
  }

  // h0:1457a: all timer entry points narrow their index to a signed byte.
  private index(value: number): number {
    const index = s8(value);
    if (index < 0 || index >= 7) throw new Error(`AGA timer index ${index} is outside the timer table`);
    return index;
  }
}
