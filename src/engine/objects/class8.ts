import { register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";

// Class 8: placeholder class whose only slot is an empty init.

// 0:3c49 init(record, object): nothing.
export function class8Init(_m: Memory, _record: number, _obj: number): void {}

register("0:3c49", class8Init);
