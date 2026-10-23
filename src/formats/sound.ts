// Sound effects: the 30 samples of amiga.eff as assets/sounds/sampleNN.wav (8-bit mono, extracted by
// ./tools/extract-assets.ts) and the executable's sound table that plays them. h0:1551a plays sound id n by looking
// it up in the sound table (h11:44f6, 6 bytes per sound, ended by a negative id) and starts Paula through h10:37f6
// with length/2 words, the period and the one-shot flag at volume 63 (h11:6200). Sound 23 plays at volume 31 and
// alternates with sound 51 on every call (h0:1554a); sound 0 stops all channels; sound 57 right after 22 is dropped.
// One-shot channels are stopped by the audio interrupt (h10:38dc) after the first pass, others loop.

export interface AmigaSample {
  data: Int8Array; // signed 8-bit, as Paula plays it
}

export interface AmigaSound {
  id: number;
  sample: number;
  oneShot: boolean;
  period: number;
  volume: number;
}

// Paula clock (PAL) for converting periods to sample rates.
export const PAULA_CLOCK = 3546895;
export const SAMPLE_COUNT = 30;

// h11:44f6: [sound id, sample, one-shot flag, period]; the fourth byte of each record is always 0 and unused.
const SOUND_TABLE: [number, number, number, number][] = [
  [1, 0, 1, 407], [2, 29, 1, 407], [3, 1, 1, 407], [4, 2, 1, 135], [5, 3, 1, 204], [6, 3, 1, 270],
  [9, 4, 1, 407], [10, 5, 1, 407], [7, 2, 1, 204], [8, 2, 1, 270], [12, 2, 1, 407], [13, 6, 1, 407],
  [14, 7, 1, 407], [17, 8, 1, 204], [57, 8, 1, 241], [16, 9, 1, 407], [58, 8, 1, 181], [18, 10, 1, 181],
  [23, 11, 1, 813], [22, 12, 1, 407], [20, 13, 1, 204], [37, 14, 1, 407], [25, 4, 1, 407], [28, 16, 1, 407],
  [29, 8, 1, 270], [15, 17, 1, 407], [59, 18, 1, 407], [11, 19, 1, 407], [26, 8, 1, 135], [32, 20, 1, 407],
  [33, 21, 0, 204], [19, 12, 1, 813], [24, 22, 1, 204], [34, 23, 1, 204], [27, 24, 1, 813], [36, 2, 1, 204],
  [21, 27, 1, 813], [48, 26, 0, 539], [51, 11, 1, 721],
];

export const AMIGA_SOUNDS: AmigaSound[] = SOUND_TABLE.map(([id, sample, oneShot, period]) => ({
  id,
  sample,
  oneShot: oneShot !== 0,
  period,
  volume: id === 23 ? 31 : 63,
}));

export function sampleFile(index: number): string {
  return `assets/sounds/sample${String(index).padStart(2, "0")}.wav`;
}

// A RIFF WAVE file of 8-bit unsigned mono PCM, as ./tools/extract-assets.ts writes them.
export function parseWav(bytes: Uint8Array): AmigaSample {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAVE file");
  let format: { channels: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === "fmt ") format = { channels: view.getUint16(body + 2, true), bits: view.getUint16(body + 14, true) };
    else if (id === "data") {
      if (!format || format.channels !== 1 || format.bits !== 8) throw new Error("expected 8-bit mono PCM");
      return { data: Int8Array.from(bytes.subarray(body, body + size), (v) => v - 128) };
    }
    at = body + size + (size & 1);
  }
  throw new Error("WAVE file without data");
}
