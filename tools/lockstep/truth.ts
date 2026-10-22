import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { FieldLayout } from "./layout/types.ts";
import type { InputEvent } from "./input.ts";

export const GLOBAL_BASE = 0x3c0000;
export const SLOT_COUNT = 30;
export const POOL_BASE = GLOBAL_BASE + 0x660c;
export const POOL_STRIDE = 0x102;
// h10:210: vblank divider word, captured beside h11 by snapshot.py --compact.
export const VBLANK_DIVIDER = 0x380210;

interface EncodedRegion {
  address: number;
  data: string;
  xor?: boolean;
}

interface FrameRecord {
  frame: number;
  ticks: number;
  pc: string;
  scene_index: number;
  failure_pc: string | null;
  slots: number[];
  regions: EncodedRegion[];
  events?: InputEvent[];
}

export class TruthFrame {
  constructor(readonly record: FrameRecord, private readonly regions: ReadonlyMap<number, Uint8Array>) {}

  read(address: number, width: number, signed = false): number {
    for (const [base, bytes] of this.regions) {
      const offset = address - base;
      if (offset < 0 || offset + width > bytes.length) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, width);
      if (width === 1) return signed ? view.getInt8(0) : view.getUint8(0);
      if (width === 2) return signed ? view.getInt16(0) : view.getUint16(0);
      if (width === 4) return signed ? view.getInt32(0) : view.getUint32(0);
      throw new Error(`invalid truth field width ${width}`);
    }
    throw new Error(`frame ${this.record.frame}: uncaptured truth address 0x${address.toString(16)} width ${width}`);
  }

  // NUL-terminated 8-bit text, e.g. the g:db1e pending panel message.
  text(address: number, size: number): string {
    let text = "";
    for (let i = 0; i < size; i++) {
      const code = this.read(address + i, 1);
      if (!code) break;
      text += String.fromCharCode(code);
    }
    return text;
  }

  value(base: number, field: FieldLayout): number | boolean | null {
    const value = this.read(base + field.offset, field.width, field.signed);
    if (field.kind === "scene-number") return value + 1;
    if (field.kind === "boolean") return value !== 0;
    if (field.kind === "profile-index") {
      if (!value) return null;
      // h0:6e14..6e1c binds +be from the three-pointer table at g:9dbc.
      for (let index = 0; index < 3; index++) {
        if (this.read(GLOBAL_BASE + 0x9dbc + index * 4, 4) === value) return index;
      }
      throw new Error(`frame ${this.record.frame}: ${field.name} points outside dialogue profiles: 0x${value.toString(16)}`);
    }
    if (field.kind !== "actor-slot") return value;
    if (!value) return null;
    // Object pointers compare as g:660c pool entries; a pointer may outlive its object (h0:16ba keeps the entry).
    const entry = (value - POOL_BASE) / POOL_STRIDE;
    if (!Number.isInteger(entry) || entry < 0 || entry >= SLOT_COUNT) throw new Error(`frame ${this.record.frame}: ${field.name} points outside the object pool: 0x${value.toString(16)}`);
    return entry;
  }
}

// snapshot.py --compact records h11 and external actors, XOR against prior regions.
// Decode one boundary at a time: memory use does not grow with the frame count.
export async function* readTruth(path: string): AsyncGenerator<TruthFrame> {
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const regions = new Map<number, Uint8Array>();
  let expected = 0;
  try {
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line) as FrameRecord;
      if (record.frame !== expected++) throw new Error(`nonconsecutive truth frame ${record.frame}; expected ${expected - 1}`);
      if (record.pc !== "h0:7b2" || record.failure_pc) throw new Error(`invalid truth boundary at frame ${record.frame}: ${record.pc}, failure ${record.failure_pc}`);
      if (record.slots.length !== SLOT_COUNT) throw new Error(`frame ${record.frame}: expected ${SLOT_COUNT} object slots`);
      const active = new Map<number, Uint8Array>();
      for (const region of record.regions) {
        const decoded = Uint8Array.from(Buffer.from(region.data, "base64"));
        if (region.xor) {
          const prior = regions.get(region.address);
          if (!prior || prior.length !== decoded.length) throw new Error(`frame ${record.frame}: missing XOR base at 0x${region.address.toString(16)}`);
          for (let i = 0; i < decoded.length; i++) decoded[i] = decoded[i]! ^ prior[i]!;
        }
        regions.set(region.address, decoded);
        active.set(region.address, decoded);
      }
      yield new TruthFrame(record, active);
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
