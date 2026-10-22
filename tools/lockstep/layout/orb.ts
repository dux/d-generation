import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "animationTime", offset: 0x98, width: 2 },
  { name: "attackActive", offset: 0x9a, width: 2 },
  { name: "attackReset", offset: 0x9c, width: 1 },
  { name: "attackDamage", offset: 0x9d, width: 1 },
  { name: "captured", offset: 0x9e, width: 1 },
  { name: "capturePending", offset: 0x9f, width: 1 },
  { name: "deathTimer", offset: 0xa0, width: 2 },
  { name: "capturedAnimationTime", offset: 0xa2, width: 2 },
  { name: "capturedFrame", offset: 0xa4, width: 1 },
  { name: "cooldown", offset: 0xa6, width: 2 },
  { name: "targetId", offset: 0xa8, width: 2 },
  { name: "capturedScheme", offset: 0xaa, width: 1 },
  { name: "capturedClass", offset: 0xab, width: 1 },
];
