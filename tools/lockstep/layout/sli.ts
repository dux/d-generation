import type { FieldLayout } from "./types.ts";

// h0:1292a, h0:73b2..h0:766e, h0:12a6e, h0:12c62.
export const fields: readonly FieldLayout[] = [
  { name: "sledSpeed", offset: 0x14, width: 2, signed: true },
  { name: "sledAnimationTime", offset: 0x98, width: 2 },
  { name: "sledStepTime", offset: 0x9a, width: 2, signed: true },
  { name: "sledLanded", offset: 0x9c, width: 1 },
  { name: "sledDescending", offset: 0x9d, width: 1 },
  { name: "sledWaitTime", offset: 0x9e, width: 2, signed: true },
  { name: "sledWaiting", offset: 0xa0, width: 1 },
  { name: "sledAscending", offset: 0xa1, width: 1 },
  { name: "sledKind", offset: 0xa2, width: 1 },
  { name: "sledJet", offset: 0xa3, width: 1 },
  { name: "sledAltitude", offset: 0xa4, width: 4, signed: true },
];
