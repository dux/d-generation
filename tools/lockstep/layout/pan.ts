import type { FieldLayout } from "./types.ts";

// h0:129f8/12b88/8c72/1137e: class-14 fields.
export const fields: readonly FieldLayout[] = [
  { name: "panStepTimer", offset: 0x98, width: 2 },
  { name: "panOnStep", offset: 0x9a, width: 1 },
  { name: "panOffStep", offset: 0x9b, width: 1 },
  { name: "panStep", offset: 0x9c, width: 1 },
  { name: "panLive", offset: 0x9d, width: 1 },
  { name: "panSpeedIndex", offset: 0x9e, width: 1 },
  { name: "panStepLength", offset: 0x9f, width: 1 },
  { name: "animationTime", offset: 0xa0, width: 2 },
];
