import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "kind", offset: 0x98, width: 1 },
  { name: "markerClosed", offset: 0x99, width: 1 },
];
