import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Layouts } from "./compare.ts";
import type { FieldLayout } from "./layout/types.ts";
import { globals } from "./layout/globals.ts";
import { actor } from "./layout/actor.ts";

const classFiles = new Map<number, string>([
  [0, "player"], [1, "sur-marker"], [2, "door"], [3, "tel"],
  [4, "switch"], [5, "squ"], [6, "orb"], [7, "cub"],
  [8, "entry"], [9, "sur"], [10, "trk"], [11, "art"],
  [12, "dec"], [13, "ven"], [14, "pan"], [15, "tub"],
  [16, "elc"], [17, "exp"], [18, "lift"], [19, "projectile"],
  [20, "laser"], [21, "bar"], [22, "cgen"], [23, "sli"],
  [24, "hed"], [25, "anm"], [26, "dgen"], [27, "derrida"],
]);

function fields(value: unknown, path: string): readonly FieldLayout[] {
  if (!Array.isArray(value)) throw new Error(`${path}: missing exported layout array`);
  for (const field of value as FieldLayout[]) {
    if (typeof field.name !== "string" || !Number.isInteger(field.offset) || field.offset < 0 || ![1, 2, 4].includes(field.width)) {
      throw new Error(`${path}: invalid field layout ${JSON.stringify(field)}`);
    }
  }
  return value as FieldLayout[];
}

export async function loadLayouts(): Promise<Layouts> {
  const directory = fileURLToPath(new URL("./layout/", import.meta.url));
  const classes = new Map<number, readonly FieldLayout[]>();
  for (const [id, stem] of classFiles) {
    const path = join(directory, `${stem}.ts`);
    try {
      await access(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    // Class layouts are optional port plugins; absent classes fail when encountered.
    const module = await import(pathToFileURL(path).href) as { fields: unknown };
    classes.set(id, fields(module.fields, path));
  }
  return { globals: fields(globals, "globals.ts"), actor: fields(actor, "actor.ts"), classes };
}
