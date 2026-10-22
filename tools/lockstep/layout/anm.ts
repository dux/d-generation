import type { FieldLayout } from "./types.ts";

// h0:8254..h0:840a, h0:11216; the fall uses +e/+f as one 8.8 height word.
export const fields: readonly FieldLayout[] = [
  { name: "anmHeightFraction", offset: 0xf, width: 1 },
  { name: "anmSpeed", offset: 0x14, width: 2, signed: true },
  { name: "anmAnimationTime", offset: 0x98, width: 2 },
  { name: "anmDelay", offset: 0x9a, width: 2, signed: true },
  { name: "anmLanded", offset: 0x9c, width: 1 },
  { name: "anmKind", offset: 0x9d, width: 1 },
  { name: "anmTriggered", offset: 0x9e, width: 1 },
  { name: "anmTime", offset: 0xa0, width: 2 },
];
