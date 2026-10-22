import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "animationTime", offset: 0x98, width: 2 },
  { name: "switchGroup", offset: 0x9a, width: 1 },
  { name: "switchChanged", offset: 0x9c, width: 1 },
  { name: "switchAction", offset: 0x9d, width: 1 },
  { name: "switchSecondaryGroup", offset: 0x9e, width: 1 },
  { name: "switchOverlapping", offset: 0x9f, width: 1 },
  { name: "switchOverlapActor", offset: 0xa0, width: 4, kind: "actor-slot" },
  { name: "switchCooldown", offset: 0xa4, width: 2 },
  { name: "switchOneShot", offset: 0xa6, width: 1 },
];
