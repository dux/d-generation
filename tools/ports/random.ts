import { random } from "../../src/engine/random.ts";
import type { Port } from "../ports.ts";

export const ports: Record<string, Port> = {
  "fff:1176": { fn: (m, range) => random(m, range), returns: "ax" },
};
