import type { FieldLayout } from "./types.ts";

export const fields: readonly FieldLayout[] = [
  { name: "doorSide", offset: 0x45, width: 1 },
  { name: "switchGroup", offset: 0x52, width: 1 },
  { name: "doorClosed", offset: 0x98, width: 1 },
  { name: "doorClosing", offset: 0x99, width: 1 },
  { name: "doorReverseSlide", offset: 0x9a, width: 1 },
  { name: "doorHasSave", offset: 0x9b, width: 1 },
  { name: "doorSaveSlot", offset: 0x9c, width: 1 },
  { name: "doorNeedsRedraw", offset: 0x9d, width: 1 },
  { name: "doorDestroyed", offset: 0x9e, width: 1 },
  { name: "doorSaved", offset: 0x9f, width: 1 },
];
