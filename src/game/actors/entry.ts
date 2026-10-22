import type { ActorClass } from "../core/model.ts";

export const entryClass: ActorClass = {
  id: 8,
  name: "entry",
  // h0:37ba (DOS 0:3c49): entry metadata is consumed by the room spawner; init is RTS.
  init() {},
};
