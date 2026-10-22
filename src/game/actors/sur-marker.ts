import type { Actor, ActorClass } from "../core/model.ts";
import { saveRecord } from "./shared.ts";
import type { SurActor } from "./sur.ts";

// AGA +98 marker kind, +99 closed.
export interface MarkerActor extends Actor {
  kind: number;
  markerClosed: number;
}

export const surMarkerClass: ActorClass<MarkerActor> = {
  id: 1,
  name: "sur-marker",
  createState: () => ({ kind: 0, markerClosed: 0 }),
  // h0:8b64 (DOS 0:81ed): invisible survivor destination marker.
  init(_ctx, actor, spec) {
    if (spec.class !== "sur-marker") throw new Error("AGA marker requires sur-marker record");
    actor.facing = 0;
    actor.direction = 0;
    actor.kind = spec.params.kind;
    actor.markerClosed = actor.kind === 4 ? 1 : 0;
    actor.collisionDisabled = 1;
  },
  // h0:8bb0 (DOS 0:8238): original handler is RTS.
  update() {},
  // h0:8bb2 / h0:8bee (DOS 0:8239 / 0:8285): an open marker sets the arriving survivor's +a0 pause byte.
  message(_ctx, actor, message) {
    if (message.type === 6 && message.sender?.classId === 9 && !actor.markerClosed) (message.sender as SurActor).surPause = 1;
    return 1;
  },
  // h0:8c18 (DOS 0:82a4): original handler is RTS.
  post() {},
  // h0:8c1a (DOS 0:82a5): invisible marker, original handler is RTS.
  draw() {},
  // h0:8b94 (DOS 0:821a): byte 3 = marker kind.
  save(_ctx, actor) { return saveRecord(actor, actor.kind); },
};
