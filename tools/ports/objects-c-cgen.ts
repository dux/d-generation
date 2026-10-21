import {
  cgenDestroyed,
  cgenDraw,
  cgenInit,
  cgenMarkPlayer,
  cgenMessage,
  cgenOnHit,
  cgenOnShot,
  cgenOnTouch,
  cgenPostUpdate,
  cgenRestart,
  cgenSpawn,
  cgenTickTimer,
  cgenUpdate,
} from "../../src/engine/objects/cgen.ts";
import type { Port } from "../ports.ts";
import { machineState } from "./dos.ts";

export const ports: Record<string, Port> = {
  "0:9d7f": { fn: (m) => cgenUpdate(m) },
  "0:9dd5": { fn: (m, sound) => cgenDestroyed(m, sound) },
  "0:9e1e": { fn: (m) => cgenMarkPlayer(m) },
  "0:9e39": { fn: (m) => cgenTickTimer(m) },
  "0:9e45": { fn: (m) => cgenSpawn(m) },
  "0:9e88": { fn: (m, msg, arg) => cgenMessage(m, msg, arg), returns: "ax" },
  "0:9ee5": { fn: (m) => cgenOnTouch(m) },
  "0:9fa5": { fn: (m, arg) => cgenOnHit(m, arg), returns: "ax" },
  "0:9feb": { fn: (m, arg) => cgenOnShot(m, arg), returns: "ax" },
  "0:a050": { fn: (m, arg) => cgenRestart(m, arg), returns: "ax" },
  "0:a0b7": { fn: (m) => cgenPostUpdate(m) },
  "0:a0bd": { fn: (m) => cgenDraw(m) },
  "0:a0e8": { fn: (m, record, obj) => cgenInit(m, record, obj), ...machineState },
};
