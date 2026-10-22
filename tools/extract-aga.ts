// Dumps decoded Amiga AGA data to ./out/aga for inspection: sprite and delta sheets, images, palettes, sound effects.
// Usage: bun run extract:aga
import { mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { AMIGA_SOUNDS, decodeVim, PAULA_CLOCK, parseAgaShapeFile, parseAmigaEffects, unlzw, VIM_HEIGHT, VIM_WIDTH } from "../src/formats/aga.ts";
import { parseDeltaSet } from "../src/formats/delta.ts";
import { parsePalette, withScheme, type Palette } from "../src/formats/palette.ts";
import { allFrames } from "../src/formats/shape.ts";
import { deltaSheet, shapeSheet } from "../src/render/sheet.ts";
import { encodePNG } from "./png.ts";

const ROOT = join(import.meta.dir, "..");
const AGA = join(ROOT, "amiga", "aga");
const DATA = join(AGA, "DATA");

const load = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());

// The disk is case-insensitive and the game asks for "scene%d.pal", "genoq.pal" and so on.
function findData(name: string): string | undefined {
  const file = readdirSync(DATA).find((f) => f.toLowerCase() === name.toLowerCase());
  return file && join(DATA, file);
}

function indexedRGBA(pixels: Uint8Array, palette: Palette, alpha?: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    out.set(palette.subarray(pixels[i] * 3, pixels[i] * 3 + 3), i * 4);
    out[i * 4 + 3] = alpha ? alpha[i] : 255;
  }
  return out;
}

// 8-bit unsigned mono PCM.
function encodeWAV(samples: Int8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples.length, true);
  for (let i = 0; i < samples.length; i++) out[44 + i] = (samples[i] + 128) & 0xff;
  return out;
}

export async function extractAgaAssets(outDir: string): Promise<void> {
  for (const dir of ["palettes", "sprites", "deltas", "images", "sfx"]) mkdirSync(join(outDir, dir), { recursive: true });
  const dgen = parsePalette(await load(join(DATA, "DGEN.PAL")));

  // genoq2.pal is not a VGA palette (32 OCS 0x0RGB words) and the AGA executable never loads it.
  const palettes = readdirSync(DATA).filter((f) => /\.pal$/i.test(f) && f !== "genoq2.pal");
  for (const file of palettes) {
    const bytes = await load(join(DATA, file));
    const pal = parsePalette(bytes);
    const colors = Array.from({ length: bytes.length / 3 }, (_, i) => [pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]]);
    await Bun.write(join(outDir, "palettes", `${file.replace(/\.pal$/i, "")}.json`), JSON.stringify(colors));
  }

  let sheets = 0;
  for (const file of readdirSync(join(AGA, "aga")).sort()) {
    const name = basename(file, ".aga");
    const sets = parseAgaShapeFile(await load(join(AGA, "aga", file)));
    for (const set of sets) {
      const { screen, rects } = shapeSheet(set.root);
      const alpha = new Uint8Array(screen.pixels.length);
      const frames = allFrames(set.root);
      frames.forEach(({ frame }, i) => {
        const r = rects[i];
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) if (frame.mask![y * frame.width + x]) alpha[(r.y + y) * screen.width + r.x + x] = 255;
        }
      });
      const out = sets.length > 1 ? `${name}-${set.id}` : name;
      await Bun.write(join(outDir, "sprites", `${out}.png`), encodePNG(screen.width, screen.height, indexedRGBA(screen.pixels, dgen, alpha)));
      const meta = rects.map((r, i) => ({ ...r, originX: frames[i].frame.x, originY: frames[i].frame.y }));
      await Bun.write(join(outDir, "sprites", `${out}.json`), JSON.stringify({ id: set.id, frames: meta }, null, 1));
      sheets++;
    }
  }

  const deltaFiles = readdirSync(DATA).filter((f) => /^DLTSET\d+\.DAT$/.test(f));
  for (const file of deltaFiles) {
    const { screen, rects } = deltaSheet(parseDeltaSet(await load(join(DATA, file))));
    await Bun.write(join(outDir, "deltas", `${basename(file, ".DAT")}.png`), encodePNG(screen.width, screen.height, screen.toRGBA(dgen, true)));
    await Bun.write(join(outDir, "deltas", `${basename(file, ".DAT")}.json`), JSON.stringify({ frames: rects }, null, 1));
  }

  // h0:cbc8: BACK1.DAT is 320x100 chunky, shown through delta color 0xfc.
  const back = unlzw(await load(join(DATA, "BACK1.DAT")));
  await Bun.write(join(outDir, "images", "BACK1.png"), encodePNG(VIM_WIDTH, back.length / VIM_WIDTH, indexedRGBA(back, dgen)));

  // h0:cc28 loads <name>.vim with a 256-color <name>.pal; scene backdrops (h0:1250) load 48 colors over
  // DGEN 32..79 except scene 58, which has a full palette.
  const vims = readdirSync(DATA).filter((f) => /\.vim$/i.test(f));
  for (const file of vims) {
    const name = file.replace(/\.vim$/i, "");
    const palPath = findData(`${name}.pal`);
    if (!palPath) throw new Error(`no palette for ${file}`);
    const palBytes = await load(palPath);
    const pal = palBytes.length === 256 * 3 ? parsePalette(palBytes) : withScheme(dgen, parsePalette(palBytes));
    if (palBytes.length !== 256 * 3 && palBytes.length !== 48 * 3) throw new Error(`${palPath}: unexpected size`);
    const pixels = decodeVim(await load(join(DATA, file)));
    await Bun.write(join(outDir, "images", `${name}.png`), encodePNG(VIM_WIDTH, VIM_HEIGHT, indexedRGBA(pixels, pal)));
  }

  // Samples are written at the rate of the first sound that plays them (period 407 for unused samples).
  const samples = parseAmigaEffects(await load(join(AGA, "amiga.eff")));
  const rateOf = (period: number) => Math.round(PAULA_CLOCK / period);
  for (const [i, sample] of samples.entries()) {
    const period = AMIGA_SOUNDS.find((s) => s.sample === i)?.period ?? 407;
    await Bun.write(join(outDir, "sfx", `sample${String(i).padStart(2, "0")}.wav`), encodeWAV(sample.data, rateOf(period)));
  }
  await Bun.write(
    join(outDir, "sfx", "sounds.json"),
    JSON.stringify(
      {
        samples: samples.map(({ offset, length }, i) => ({ index: i, offset, length, used: AMIGA_SOUNDS.some((s) => s.sample === i) })),
        sounds: AMIGA_SOUNDS.map((s) => ({ ...s, rate: rateOf(s.period) })),
      },
      null,
      1,
    ),
  );

  console.log(
    `wrote ${palettes.length} palettes, ${sheets} sprite sheets, ${deltaFiles.length} delta sheets, ${vims.length + 1} images, ${samples.length} samples to ${outDir}`,
  );
}

await extractAgaAssets(join(ROOT, "out", "aga"));
