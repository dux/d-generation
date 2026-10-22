import type { FieldLayout } from "./types.ts";

// Classes 22/26 share h0:8040, h0:7c5c and h0:10d5a, including these offsets.
export const fields: readonly FieldLayout[] = [
  { name: "lastPlayerX", offset: 0x9e, width: 1 },
  { name: "lastPlayerY", offset: 0x9f, width: 1 },
  { name: "generatorSpawnTime", offset: 0xa0, width: 2 },
  { name: "generatorActive", offset: 0xa2, width: 1 },
  { name: "generatorHits", offset: 0xa4, width: 1 },
  { name: "generatorPlayerTriggered", offset: 0xa6, width: 1 },
  { name: "generatorAnimationTime", offset: 0xa8, width: 2 },
  { name: "generatorSkipDraw", offset: 0xaa, width: 1 },
  { name: "generatorDying", offset: 0xab, width: 1 },
  { name: "generatorDeathFrame", offset: 0xac, width: 1 },
];
