import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "liftArrival", offset: 0x98, width: 1 },
  { name: "liftRunning", offset: 0x99, width: 1 },
  { name: "animationTime", offset: 0x9c, width: 2 },
  { name: "liftDestination", offset: 0x9e, width: 1 },
  { name: "liftTimer", offset: 0xa0, width: 2 },
  { name: "liftClipBottom", offset: 0xa2, width: 1 },
  { name: "liftClipTop", offset: 0xa3, width: 1 },
  { name: "liftDoorsOpen", offset: 0xa4, width: 1 },
];
