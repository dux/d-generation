// The original game state lives in a 1 MB real-mode address space with the data segment at a fixed paragraph.
// The port keeps the same layout so ported functions read and write the same offsets as GAME.EXE, and can be
// checked byte for byte against the original running in tools/emu.

export class Memory {
  readonly bytes: Uint8Array<ArrayBufferLike>;
  // VGA DAC: 256 colors x 6-bit RGB, set through ports 3c8/3c9 (not addressable memory).
  readonly dac: Uint8Array<ArrayBufferLike>;
  // Stack pointer, an offset in DS (the game runs with SS = DS). Ports that pass the address of a local
  // variable to a callee allocate it on this stack: `const local = m.push(6); ...; m.pop(6);`.
  sp = 0xd9b2;

  push(size: number): number {
    this.sp = (this.sp - ((size + 1) & ~1)) & 0xffff;
    return this.sp;
  }

  pop(size: number): void {
    this.sp = (this.sp + ((size + 1) & ~1)) & 0xffff;
  }

  // ds: data segment paragraph (DS:0 = ds * 16). bytes/dac may be views of SharedArrayBuffers so another thread
  // can display the screen (A000) and palette while the game runs in a worker.
  constructor(
    readonly ds: number,
    bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0x100000),
    dac: Uint8Array<ArrayBufferLike> = new Uint8Array(768),
  ) {
    this.bytes = bytes;
    this.dac = dac;
  }

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
