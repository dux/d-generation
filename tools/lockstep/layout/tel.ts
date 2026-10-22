import type { FieldLayout } from "./types.ts";

// h0:45d4..h0:4916, h0:11442.
export const fields: readonly FieldLayout[] = [
  { name: "telLastFrame", offset: 0x98, width: 1 },
  { name: "telPeriod", offset: 0x9a, width: 2 },
  { name: "telAnimationTime", offset: 0x9c, width: 2 },
  { name: "telActive", offset: 0x9e, width: 1 },
  { name: "telPassenger", offset: 0xa0, width: 4, kind: "actor-slot" },
  { name: "telOccupied", offset: 0xa4, width: 1 },
  { name: "telDestination", offset: 0xa6, width: 4, kind: "actor-slot" },
  { name: "telLink", offset: 0xaa, width: 1 },
  { name: "telPassengerId", offset: 0xac, width: 2 },
];
