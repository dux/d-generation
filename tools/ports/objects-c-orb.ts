import {
  acquireTarget,
  cooldownTick,
  fn_0_8db3,
  fn_0_8dee,
  fn_0_8eae,
  fn_0_90ec,
  fn_0_9125,
  orbDraw,
  orbHit,
  orbInit,
  orbMessage,
  orbPostUpdate,
  orbSave,
  orbUpdate,
} from "../../src/engine/objects/orb.ts";
import type { Port } from "../ports.ts";

export const ports: Record<string, Port> = {
  "0:3c4a": { fn: (m, record, obj) => orbInit(m, record, obj) },
  "0:3c82": { fn: (m, obj, record) => orbSave(m, obj, record) },
  "0:8da3": { fn: (m) => orbUpdate(m) },
  "0:8db3": { fn: (m) => fn_0_8db3(m) },
  "0:8dee": { fn: (m) => fn_0_8dee(m) },
  "0:8eae": { fn: (m) => fn_0_8eae(m) },
  "0:8eca": { fn: (m) => cooldownTick(m) },
  "0:8eed": { fn: (m) => acquireTarget(m) },
  "0:902c": { fn: (m) => orbHit(m), returns: "ax" },
  "0:9088": { fn: (m, msg, arg) => orbMessage(m, msg, arg), returns: "ax" },
  "0:90ec": { fn: (m, arg) => fn_0_90ec(m, arg), returns: "ax" },
  "0:9125": { fn: (m, arg) => fn_0_9125(m, arg), returns: "ax" },
  "0:914a": { fn: (m) => orbPostUpdate(m) },
  "0:9150": { fn: (m) => orbDraw(m) },
};
