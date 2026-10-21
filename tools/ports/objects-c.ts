import { talk } from "../../src/engine/creatures/talk.ts";
import { anmDraw, anmInit, anmMessage, anmPostUpdate, anmUpdate } from "../../src/engine/objects/anm.ts";
import {
  class1Draw,
  class1Init,
  class1Message,
  class1PostUpdate,
  class1Store,
  class1Touched,
  class1Update,
} from "../../src/engine/objects/class1.ts";
import { decDraw, decInit, decMessage, decPostUpdate, decUpdate } from "../../src/engine/objects/dec.ts";
import {
  elcAnimate,
  elcDraw,
  elcInit,
  elcMessage,
  elcPostUpdate,
  elcUpdate,
  elcZap,
} from "../../src/engine/objects/elc.ts";
import { hedDraw, hedHit, hedInit, hedMessage, hedPostUpdate, hedTurn, hedUpdate } from "../../src/engine/objects/hed.ts";
import {
  panDraw,
  panInit,
  panMessage,
  panPostUpdate,
  panStep,
  panStore,
  panTouched,
  panUpdate,
} from "../../src/engine/objects/pan.ts";
import type { Port } from "../ports.ts";
import { machineState } from "./dos.ts";

export const ports: Record<string, Port> = {
  "0:8088": { fn: (m, record, obj) => elcInit(m, record, obj) },
  "0:809c": { fn: (m) => elcUpdate(m) },
  "0:80a3": { fn: (m) => elcZap(m) },
  "0:80f4": { fn: (m) => elcAnimate(m) },
  "0:811e": { fn: (m, msg, arg) => elcMessage(m, msg, arg), returns: "ax" },
  "0:8163": { fn: (m) => elcPostUpdate(m) },
  "0:8169": { fn: (m) => elcDraw(m) },
  "0:81ed": { fn: (m, record, obj) => class1Init(m, record, obj) },
  "0:821a": { fn: (m, obj, record) => class1Store(m, obj, record) },
  "0:8238": { fn: (m) => class1Update(m) },
  "0:8239": { fn: (m, msg, arg) => class1Message(m, msg, arg), returns: "ax" },
  "0:8285": { fn: (m) => class1Touched(m) },
  "0:82a4": { fn: (m) => class1PostUpdate(m) },
  "0:82a5": { fn: (m) => class1Draw(m) },
  "0:82a6": { fn: (m) => panUpdate(m) },
  "0:82aa": { fn: (m) => panStep(m) },
  "0:830d": { fn: (m, msg, arg) => panMessage(m, msg, arg), returns: "ax" },
  "0:8359": { fn: (m) => panTouched(m), returns: "ax" },
  "0:83c2": { fn: (m) => panPostUpdate(m) },
  "0:83c8": { fn: (m) => panDraw(m) },
  "0:83d7": { fn: (m, record, obj) => panInit(m, record, obj) },
  "0:8442": { fn: (m, obj, record) => panStore(m, obj, record) },
  "0:a184": { fn: (m, record, obj) => decInit(m, record, obj) },
  "0:a192": { fn: (m) => decUpdate(m) },
  "0:a193": { fn: (m, msg, arg) => decMessage(m, msg, arg), returns: "ax" },
  "0:a197": { fn: (m) => decPostUpdate(m) },
  "0:a19d": { fn: (m) => decDraw(m) },
  "0:a1ac": { fn: (m, record, obj) => hedInit(m, record, obj) },
  "0:a1dc": { fn: (m) => hedUpdate(m) },
  "0:a23c": { fn: (m, msg, arg) => hedMessage(m, msg, arg), returns: "ax" },
  "0:a29d": { fn: (m, msg) => hedTurn(m, msg), returns: "ax" },
  "0:a2b1": { fn: (m) => hedHit(m), returns: "ax" },
  "0:a2e6": { fn: (m) => hedPostUpdate(m) },
  "0:a2ec": { fn: (m) => hedDraw(m) },
  "0:a2fb": { fn: (m, record, obj) => anmInit(m, record, obj), ...machineState },
  "0:a31e": { fn: (m) => anmUpdate(m) },
  "0:a3bd": { fn: (m, msg, arg) => anmMessage(m, msg, arg), returns: "ax" },
  "0:a3c1": { fn: (m) => anmPostUpdate(m) },
  "0:a3c7": { fn: (m) => anmDraw(m) },
  "0:a3ee": { fn: (m) => talk(m), returns: "ax" },
};
