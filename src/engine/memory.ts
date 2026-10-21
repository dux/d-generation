// The original game state lives in a 1 MB real-mode address space with the data segment at a fixed paragraph.
// The port keeps the same layout so ported functions read and write the same offsets as GAME.EXE, and can be
// checked byte for byte against the original running in tools/emu.

export class Memory {
  readonly bytes = new Uint8Array(0x100000);
  // VGA DAC: 256 colors x 6-bit RGB, set through ports 3c8/3c9 (not addressable memory).
  readonly dac = new Uint8Array(768);

  // ds: data segment paragraph (DS:0 = ds * 16).
  constructor(readonly ds: number) {}

  private at(off: number): number {
    return this.ds * 16 + (off & 0xffff);
  }

  u8(off: number): number {
    return this.bytes[this.at(off)];
  }

  s8(off: number): number {
    return (this.bytes[this.at(off)] << 24) >> 24;
  }

  u16(off: number): number {
    const a = this.at(off);
    return this.bytes[a] | (this.bytes[a + 1] << 8);
  }

  s16(off: number): number {
    return (this.u16(off) << 16) >> 16;
  }

  set8(off: number, value: number): void {
    this.bytes[this.at(off)] = value & 0xff;
  }

  set16(off: number, value: number): void {
    const a = this.at(off);
    this.bytes[a] = value & 0xff;
    this.bytes[a + 1] = (value >> 8) & 0xff;
  }

  // Far reads (seg:off) for shape banks and other buffers outside DS.
  farU8(seg: number, off: number): number {
    return this.bytes[seg * 16 + (off & 0xffff)];
  }
}
