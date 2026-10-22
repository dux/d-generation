import type { Actor } from "../../core/model.ts";

// What the conversation, inventory and terminal prompts draw straight into the display bitmap (g:de50), in
// drawing order. The original keeps those pixels until h0:e1a8 copies the view back over them (or a room
// redraw replaces them); the native record is emptied at the same points. ./src/game/ui/talk/render.ts draws it.
export type DisplayOp =
  | { op: "panel"; top: number; fill: number } // h0:dfda clearPanel(fill) from the panel top to the last row
  | { op: "wrap"; x: number; y: number; text: string; wide: number } // h0:de2a drawText(pos, text, 1)
  | { op: "text"; x: number; y: number; text: string; wide: number } // h0:dcb4 one line
  | { op: "row"; x: number; y: number; width: number; color: number } // h0:f318 menu row with set 37 end caps
  | { op: "slot"; x: number; y: number; color: number } // h0:f3f0 inventory slot with set 39 end caps
  | { op: "icon"; item: number; x: number; y: number } // h0:13f68 set 39 frame item + 1
  | { op: "keyboard" } // h0:14d1a(0): the on-screen keyboard (h9 planes, BitMap g:df0c) at (0x32, 0x32)
  | { op: "invert"; column: number; row: number } // h0:14f34/14fbe/15048: minterm 0x50 on one keyboard cell
  | { op: "unkeyboard" } // h0:14d1a(2): the saved 219x69 rectangle (g:df08) back at (0x32, 0x32)
  | { op: "delta"; set: number; entry: number; x: number; y: number } // h0:3188 into the display (terminals)
  | { op: "clear" } // h0:ad9c while g:de5c points at the display: the whole screen 0
  | { op: "vim"; name: string }; // h0:cc28 into the display (der.vim, scene 18 terminal)

// h0:135ac/h0:1400c/h0:b9d6 globals that outlive one call.
export interface TalkState {
  // g:d92c / g:d92e: the topic stack of the conversation (20 words; h0:1730 clears the depth).
  depth: number;
  stack: number[];
  // g:de04: the survivor being talked to; g:de0c: a survivor or class-27 piece with a profile is in the room.
  talker: Actor | null;
  present: number;
  // g:de1a / g:de14: visible option slots of the current topic, 0xff terminated.
  count: number;
  rows: number[];
  // g:de13 / g:de0d: inventory items with a non-zero count, 0xff terminated.
  itemCount: number;
  items: number[];
  // g:dc2b: input cursor blink phase; g:de66 / g:de67: on-screen keyboard column and row.
  cursorBlink: number;
  keyColumn: number;
  keyRow: number;
  display: DisplayOp[];
  // h0:922c: colour registers loaded from this palette file instead of the room's (null: the room's).
  palette: string | null;
}

export function createTalkState(): TalkState {
  return {
    depth: 0, stack: Array<number>(20).fill(0), talker: null, present: 0, count: 0, rows: Array<number>(6).fill(0),
    itemCount: 0, items: Array<number>(6).fill(0), cursorBlink: 0, keyColumn: 0, keyRow: 0, display: [], palette: null,
  };
}
