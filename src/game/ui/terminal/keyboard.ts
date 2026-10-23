// The CD32 on-screen keyboard picture, which h0:14d1a(0) blits to (0x32, 0x32): chunky palette indexes extracted
// from hunk 9 of the executable by ./tools/extract-cd32-pictures.ts.
export const KEYBOARD_WIDTH = 219;
export const KEYBOARD_HEIGHT = 69;
export const KEYBOARD_FILE = "data/cd32-keyboard.bin";

export function parseKeyboard(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== KEYBOARD_WIDTH * KEYBOARD_HEIGHT) throw new Error(`${KEYBOARD_FILE} holds ${bytes.length} bytes`);
  return bytes;
}
