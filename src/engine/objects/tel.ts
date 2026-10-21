import type { Memory } from "../memory.ts";

// Class 3, TEL.VGA: teleporter pad.

// 0:4a69 init(record, object): record byte 3 = link id (low 2 bits kept per pad).
export function telInit(m: Memory, record: number, obj: number): void {
  const link = m.u8(record + 3);
  m.set8(0x611f, link); // last teleporter link read
  m.set8(obj + 0x8e, link & 3);
  m.set16(obj + 0x84, 0x15e);
  m.set8(obj + 0x18, 1);
}
