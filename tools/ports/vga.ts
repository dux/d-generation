import {
  clearBuffers,
  clearDrawBuffer,
  clearFrontBuffer,
  copyRect,
  drawSprite,
  dropColumn,
  hline,
  maskBuffer,
  maskWithFrame,
  putPixel,
  setCrtc04,
  setCrtc10,
  setPalette,
} from "../../src/engine/vga.ts";
import type { Port } from "../ports.ts";

export const ports: Record<string, Port> = {
  "23ac:000d": { fn: (m, v) => setCrtc10(m, v) },
  "23ac:0024": { fn: (m, v) => setCrtc04(m, v) },
  "23ac:003b": { fn: (m, p, first, count) => setPalette(m, p, first, count) },
  "23ac:0060": { fn: (m) => clearBuffers(m) },
  "23ac:0084": { fn: (m) => clearFrontBuffer(m) },
  "23ac:009a": { fn: (m) => clearDrawBuffer(m) },
  "23ac:00b0": { fn: (m) => maskBuffer(m), returns: "dx:ax" },
  "23ac:00b6": { fn: (m, x, y, c) => putPixel(m, x, y, c) },
  "23ac:00fb": { fn: (m, x, y, n, c) => hline(m, x, y, n, c) },
  "23ac:012f": { fn: (m, x, y, c, f) => dropColumn(m, x, y, c, f) },
  "23ac:01ac": { fn: (m, x, y, w, h, s, d) => copyRect(m, x, y, w, h, s, d) },
  "23ac:022d": { fn: (m, x, y, o, s, fx, fy) => maskWithFrame(m, x, y, o, s, fx, fy) },
  "23ac:0340": { fn: (m, x, y, o, s, sh, fl, lo) => drawSprite(m, x, y, o, s, sh, fl, lo) },
};
