import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "cubKind", offset: 0x98, width: 1 },
  { name: "cubState", offset: 0x99, width: 1 },
  { name: "animationTime", offset: 0x9a, width: 2 },
  { name: "cubActive", offset: 0x9c, width: 1 },
  { name: "cubVariant", offset: 0x9d, width: 1 },
  { name: "cubItem", offset: 0x9e, width: 1 },
  { name: "cubSpecial", offset: 0xa2, width: 1 },
];
