import { drawDelta, type DeltaSet } from "../formats/delta.ts";
import { allFrames, type ShapeNode } from "../formats/shape.ts";
import { Screen } from "./screen.ts";

export interface SheetRect {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Sheet {
  screen: Screen;
  rects: SheetRect[];
}

interface SheetItem {
  label: string;
  width: number;
  height: number;
  draw(screen: Screen, x: number, y: number): void;
}

const PAD = 2;

// Shelf packing: left to right, wrapping at maxWidth.
function buildSheet(items: SheetItem[], maxWidth: number): Sheet {
  const rects: SheetRect[] = [];
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  let width = 0;
  for (const item of items) {
    if (x > PAD && x + item.width + PAD > maxWidth) {
      x = PAD;
      y += shelf + PAD;
      shelf = 0;
    }
    rects.push({ label: item.label, x, y, width: item.width, height: item.height });
    x += item.width + PAD;
    width = Math.max(width, x);
    shelf = Math.max(shelf, item.height);
  }
  const screen = new Screen(Math.max(width, 1), y + shelf + PAD);
  items.forEach((item, i) => item.draw(screen, rects[i].x, rects[i].y));
  return { screen, rects };
}

export function shapeSheet(root: ShapeNode[], maxWidth = 320): Sheet {
  return buildSheet(
    allFrames(root).map(({ path, frame }) => ({
      label: path.join("/"),
      width: frame.width,
      height: frame.height,
      draw: (screen, x, y) => screen.blit(frame, x, y),
    })),
    maxWidth,
  );
}

// Delta images by entry index; empty entries are left out.
export function deltaSheet(set: DeltaSet, maxWidth = 480): Sheet {
  return buildSheet(
    set.entries.flatMap((entry, i) =>
      entry.width ? [{ label: String(i), width: entry.width, height: entry.height, draw: (screen: Screen, x: number, y: number) => drawDelta(screen, entry, x - entry.dx, y - entry.dy) }] : [],
    ),
    maxWidth,
  );
}
