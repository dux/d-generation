import * as tel from "../../src/engine/objects/tel.ts";
import type { Port } from "../ports.ts";

export const ports: Record<string, Port> = {
  "0:4a69": { fn: (m, record, obj) => tel.telInit(m, record, obj) },
  "0:4a8c": { fn: (m, obj, record) => tel.telSave(m, obj, record) },
  "0:4aaa": { fn: (m) => tel.telUpdate(m) },
  "0:4ab4": { fn: (m) => tel.telCheckPassenger(m) },
  "0:4aef": { fn: (m) => tel.telAnimate(m) },
  "0:4b8a": { fn: (m) => tel.telCheckLeft(m) },
  "0:4bb0": { fn: (m) => tel.telSend(m) },
  "0:4c24": { fn: (m, pad) => tel.telPickDestination(m, pad), returns: "ax" },
  "0:4c82": { fn: (m, pad, index) => tel.telNextLinked(m, pad, index), returns: "ax" },
  "0:4cc4": { fn: (m, msg, arg) => tel.telMessage(m, msg, arg), returns: "ax" },
  "0:4d0c": { fn: (m) => tel.telStart(m), returns: "ax" },
  "0:4e0d": { fn: (m) => tel.telPostUpdate(m) },
  "0:4e13": { fn: (m) => tel.telDraw(m) },
};
