import type { FieldLayout } from "./types.ts";

// h0:8a28/8a3e/11126 and h0:52fa: class-16 fields.
export const fields: readonly FieldLayout[] = [
  { name: "elcTime", offset: 0x9a, width: 2 },
  { name: "elcVictimClass", offset: 0x9e, width: 1 },
  { name: "elcSparkScheme", offset: 0x9f, width: 1 },
  { name: "elcZapTime", offset: 0xa0, width: 2 },
];
