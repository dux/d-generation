import type { FieldLayout } from "./types.ts";

// Class 24: h0:8104/h0:813a/h0:11004; +9a's high byte is also the drift speed.
export const fields: readonly FieldLayout[] = [
  { name: "headHeightFraction", offset: 0x0f, width: 1 },
  { name: "headVerticalSpeed", offset: 0x14, width: 2, signed: true },
  { name: "headAnimationTime", offset: 0x98, width: 2 },
  { name: "headTime", offset: 0x9a, width: 2 },
];
