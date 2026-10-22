import { s16, u8, u16 } from "./int.ts";

export class AgaRandom {
  private value: number;

  // g:bf0c starts at zero. h0:11ea clears it when starting demo playback.
  constructor(seed = 0) {
    this.value = u16(seed);
  }

  get seed(): number { return this.value; }
  set seed(value: number) { this.value = u16(value); }

  // h0:e7f4 (DOS fff:1176): two byte LCGs in a big-endian word.
  next(range: number): number {
    const low = u8(u8(this.value) * 17 + 0xa1);
    const high = u8((this.value >>> 8) * 31 + 0xbf);
    this.value = (high << 8) | low;
    const mixed = u8(low + high);
    // MOVE.W to the stack followed by MOVE.B reads the HIGH byte of its LOW word.
    return u16(range) ? (u16(mixed * s16(range)) >>> 8) : mixed;
  }

  // h0:e85a: seeded query restores the live generator, including both seed bytes.
  withSeed(range: number, seed: number): number {
    const previous = this.value;
    this.value = u16(seed);
    const result = this.next(range);
    this.value = previous;
    return result;
  }
}
