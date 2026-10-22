import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "ventOff", offset: 0x98, width: 1 },
  { name: "ventHostileLimit", offset: 0x99, width: 1, signed: true },
  { name: "ventCreatureKind", offset: 0x9a, width: 1, signed: true },
  { name: "ventTimer", offset: 0x9c, width: 2 },
  { name: "ventPeriod", offset: 0x9e, width: 1, signed: true },
  { name: "ventFrameSet", offset: 0x9f, width: 1, signed: true },
];
