import type { FieldLayout } from "./types.ts";

// h0:384c/5846/5b04: class-19 fields.
export const fields: readonly FieldLayout[] = [
  { name: "projectileOwnerClass", offset: 0x98, width: 1 },
  { name: "projectileParked", offset: 0x99, width: 1 },
  { name: "projectileOwnerGrace", offset: 0x9a, width: 1 },
  { name: "projectileLifetime", offset: 0x9b, width: 1 },
  { name: "projectilePathTime", offset: 0x9c, width: 2 },
  { name: "projectilePath", offset: 0x9e, width: 1 },
  { name: "projectilePathStep", offset: 0x9f, width: 1 },
];
