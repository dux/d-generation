import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "animationTime", offset: 0x98, width: 2 },
  { name: "attackActive", offset: 0x9a, width: 1 },
  { name: "attackReset", offset: 0x9b, width: 1 },
  { name: "attackDamage", offset: 0x9c, width: 1 },
  { name: "movementStopped", offset: 0x9d, width: 1 },
  { name: "dormant", offset: 0x9e, width: 1 },
  { name: "surpriseJump", offset: 0x9f, width: 1 },
  { name: "wakeTimer", offset: 0xa0, width: 2 },
  { name: "waking", offset: 0xa2, width: 1 },
  { name: "jumpAttempted", offset: 0xa3, width: 1 },
];
