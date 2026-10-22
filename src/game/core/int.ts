// h0:e804..e828, h0:ef2..f18: 68k byte/word operands wrap independently.
export const u8 = (value: number): number => value & 0xff;
export const s8 = (value: number): number => (value << 24) >> 24;
export const u16 = (value: number): number => value & 0xffff;
export const s16 = (value: number): number => (value << 16) >> 16;
export const u32 = (value: number): number => value >>> 0;
export const s32 = (value: number): number => value | 0;

// h0:7874..7878: DIVS truncates toward zero, unlike an arithmetic right shift.
export function divs(numerator: number, denominator: number): number {
  const divisor = s16(denominator);
  if (divisor === 0) throw new Error("68k signed division by zero");
  const quotient = Math.trunc(s32(numerator) / divisor);
  if (quotient < -0x8000 || quotient > 0x7fff) throw new Error("68k signed division overflow");
  return quotient;
}
