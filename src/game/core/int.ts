// h0:e804..e828, h0:ef2..f18: 68k byte/word operands wrap independently.
export const u8 = (value: number): number => value & 0xff;
export const s8 = (value: number): number => (value << 24) >> 24;
export const u16 = (value: number): number => value & 0xffff;
export const s16 = (value: number): number => (value << 16) >> 16;
export const u32 = (value: number): number => value >>> 0;
export const s32 = (value: number): number => value | 0;
