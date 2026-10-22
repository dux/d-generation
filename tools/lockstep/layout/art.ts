import type { FieldLayout } from "./types.ts";

// h0:1276e/863c/8836/10412: class-11 fields.
export const fields: readonly FieldLayout[] = [
  { name: "animationTime", offset: 0x98, width: 2 },
  { name: "artKind", offset: 0x9a, width: 1 },
  { name: "artParameter", offset: 0x9b, width: 1 },
  { name: "artSensorTriggered", offset: 0x9c, width: 1 },
  { name: "artFired", offset: 0x9d, width: 1 },
  { name: "artFuse", offset: 0x9e, width: 2 },
  { name: "artTickTime", offset: 0xa0, width: 2 },
];
