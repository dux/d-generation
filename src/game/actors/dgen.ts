import type { ActorClass } from "../core/model.ts";
import { cgenClass } from "./cgen.ts";

// g:24e0: descriptor 26, the D/Generation creature, is byte-identical to class 22 (g:24b8) apart from its class id:
// same shapes (g:2150), flags 20, footprint and handlers. The id alone matters: the hostile count (h0:4436), the
// cannon's target search (h0:8366) and the generator step table (h0:4f70) look for class 26.
export const dgenClass: ActorClass = { ...cgenClass, id: 26, name: "dgen" };
