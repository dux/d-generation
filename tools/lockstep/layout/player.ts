import type { FieldLayout } from "./types.ts";

// h0:373c/4cbc/4cf0/faf4: class-0 fields in the AGA 258-byte actor.
export const fields: readonly FieldLayout[] = [
  { name: "walkDistance", offset: 0x98, width: 2 },
  { name: "knockbackFrames", offset: 0x9b, width: 1 },
  { name: "nudgePending", offset: 0x9c, width: 1 },
  { name: "inputHeading", offset: 0x9d, width: 1 },
  { name: "invulnerabilityTicks", offset: 0xa4, width: 2 },
  { name: "invulnerable", offset: 0xaa, width: 1 },
  { name: "liftedAnimation", offset: 0xab, width: 1 },
  { name: "controlled", offset: 0xad, width: 1 },
  { name: "liftedTicks", offset: 0xae, width: 2 },
  { name: "playerShieldFrame", offset: 0xb0, width: 1 },
];
