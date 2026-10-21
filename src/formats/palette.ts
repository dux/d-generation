// VGA DAC palettes: 3 bytes per color, 6-bit components.
export type Palette = Uint8Array; // 256 colors, 8-bit RGB triplets

// RED/GREEN/BLUE.PAL hold 48 colors that replace DGEN.PAL colors 32..79 (GAME.EXE 0:149a).
export const SCHEME_FIRST = 32;

export function parsePalette(bytes: Uint8Array): Palette {
  const pal = new Uint8Array(256 * 3);
  for (let i = 0; i < bytes.length && i < pal.length; i++) pal[i] = (bytes[i] << 2) | (bytes[i] >> 4);
  return pal;
}

export function withScheme(base: Palette, scheme: Palette): Palette {
  const pal = base.slice();
  pal.set(scheme.subarray(0, 48 * 3), SCHEME_FIRST * 3);
  return pal;
}
