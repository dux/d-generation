import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "switchGroup", offset: 0x52, width: 1 },
  { name: "turretFireTime", offset: 0x98, width: 2 },
  { name: "turretTurnTime", offset: 0x9a, width: 2 },
  { name: "turretEnabled", offset: 0x9c, width: 1 },
  { name: "turretReclaiming", offset: 0x9d, width: 1 },
  { name: "turretArmed", offset: 0x9e, width: 1 },
  { name: "turretFixed", offset: 0x9f, width: 1 },
  { name: "turretDestroyed", offset: 0xa0, width: 1 },
  { name: "turretTransitionTime", offset: 0xa2, width: 2 },
];
