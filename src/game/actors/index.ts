import type { ActorClass } from "../core/model.ts";
import { surMarkerClass } from "./sur-marker.ts";
import { doorClass } from "./door.ts";
import { switchClass } from "./switch.ts";
import { orbClass } from "./orb.ts";
import { cubClass } from "./cub.ts";
import { entryClass } from "./entry.ts";
import { surClass } from "./sur.ts";
import { trkClass } from "./trk.ts";
import { decClass } from "./dec.ts";
import { venClass } from "./ven.ts";
import { tubClass } from "./tub.ts";
import { expClass } from "./exp.ts";
import { liftClass } from "./lift.ts";
import { laserClass } from "./laser.ts";
import { cgenClass } from "./cgen.ts";
import { hedClass } from "./hed.ts";
import { barClass } from "./bar.ts";
import { panClass } from "./pan.ts";
import { squClass } from "./squ.ts";
import { telClass } from "./tel.ts";
import { sliClass } from "./sli.ts";
import { anmClass } from "./anm.ts";
import { dgenClass } from "./dgen.ts";
import { derridaClass } from "./derrida.ts";
import { artClass } from "./art.ts";
import { projectileClass } from "./gre.ts";
import { elcClass } from "./elc.ts";

// g:426: only implemented non-player descriptors are registered; absent classes fail at spawn.
export const actorClasses: ActorClass[] = [
  surMarkerClass, doorClass, switchClass, orbClass, cubClass, entryClass,
  surClass, trkClass, decClass, venClass, tubClass, expClass, liftClass,
  laserClass, cgenClass, hedClass,
  barClass, panClass, squClass,
  telClass, sliClass, anmClass, dgenClass, derridaClass,
  artClass, projectileClass, elcClass,
];
