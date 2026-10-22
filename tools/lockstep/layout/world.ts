import type { FieldLayout } from "./types.ts";

// h0:d38/d4a: room position is six bytes; h0:e6a/e7e copy thirty player bytes.
export const positionFields = ["row", "column", "scene", "exitDirection", "spawnDirection", "entrySlot"] as const;
export const playerFields: readonly FieldLayout[] = [
  { name: "lives", offset: 0, width: 1 },
  { name: "rescuedCount", offset: 1, width: 1 },
  { name: "buildingFloor", offset: 2, width: 1 },
  { name: "ammo", offset: 3, width: 1 },
  { name: "throwableAvailable", offset: 4, width: 1 },
  { name: "bombsFound", offset: 5, width: 1 },
  { name: "spawnX", offset: 6, width: 1 },
  { name: "spawnY", offset: 7, width: 1 },
  { name: "spawnDirection", offset: 8, width: 1 },
  { name: "portableLaserCount", offset: 9, width: 1 },
  { name: "slowMotionCount", offset: 10, width: 1 },
  { name: "shieldCount", offset: 11, width: 1 },
  { name: "carriedBombs", offset: 12, width: 1 },
  { name: "inventoryAvailability", offset: 13, width: 1 },
  { name: "slowMotion", offset: 14, width: 1 },
  { name: "playerPadding", offset: 15, width: 1 },
  { name: "slowMotionTime", offset: 16, width: 4, signed: true },
  { name: "invulnerable", offset: 20, width: 1 },
  { name: "shieldPadding", offset: 21, width: 1 },
  { name: "invulnerabilityTime", offset: 22, width: 4, signed: true },
  { name: "paused", offset: 26, width: 1 },
  { name: "specialItemCollected", offset: 27, width: 1 },
  { name: "floorSecurityState", offset: 28, width: 1 },
  { name: "floorSecurityCode", offset: 29, width: 1 },
];

export const world: readonly FieldLayout[] = [
  ...positionFields.map((name, i): FieldLayout => ({ name: `position.${name}`, offset: 0x8a22 + i, width: 1, kind: name === "scene" ? "scene-number" : "scalar" })),
  ...positionFields.map((name, i): FieldLayout => ({ name: `checkpointPosition.${name}`, offset: 0x8a28 + i, width: 1, kind: name === "scene" ? "scene-number" : "scalar" })),
  ...playerFields.map(field => ({ ...field, name: `roomEntryPlayer.${field.name}`, offset: 0x85f2 + field.offset })),
  ...playerFields.map(field => ({ ...field, name: `checkpointPlayer.${field.name}`, offset: 0x8610 + field.offset })),
];
