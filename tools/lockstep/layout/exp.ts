import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "remainsTime", offset: 0x98, width: 2 },
  { name: "remainsSourceClass", offset: 0x9b, width: 1 },
];
