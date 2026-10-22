// DATA/*.PAL palettes: 3 bytes per color, 6-bit components, loaded as `byte << 2` (h0:cc9a).
export type Palette = Uint8Array; // 8-bit RGB triplets

// RED/GREEN/BLUE.PAL hold 48 colors that replace DGEN.PAL colors 32..79.
export const SCHEME_FIRST = 32;

export function parsePalette(bytes: Uint8Array): Palette {
  return bytes.map((v) => (v << 2) & 0xff);
}

export function withScheme(base: Palette, scheme: Palette): Palette {
  const pal = base.slice();
  pal.set(scheme.subarray(0, 48 * 3), SCHEME_FIRST * 3);
  return pal;
}
