import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "bounces", offset: 0x98, width: 1 },
  { name: "flicker", offset: 0x99, width: 1 },
  { name: "exploding", offset: 0x9a, width: 2 },
  { name: "explosionTimer", offset: 0x9c, width: 2 },
  { name: "lifetime", offset: 0x9e, width: 1 },
];
