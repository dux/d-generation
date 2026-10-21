import { telInit } from "../../src/engine/objects/tel.ts";
import type { Port } from "../ports.ts";

export const ports: Record<string, Port> = {
  "0:4a69": { fn: (m, record, obj) => telInit(m, record, obj) },
};
