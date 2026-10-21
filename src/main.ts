import { Music } from "./audio/music.ts";
import { withScheme, type Palette } from "./formats/palette.ts";
import { deltaSetFor, SCENE_NUMBERS } from "./formats/scene.ts";
import { DELTA_SET_NUMBERS, GameData, SCHEME_PALETTES, SHAPE_NAMES, type PaletteName } from "./game-data.ts";
import { renderRoom } from "./render/room.ts";
import { Screen } from "./render/screen.ts";
import { deltaSheet, shapeSheet, type SheetRect } from "./render/sheet.ts";

type Mode = "rooms" | "sprites" | "deltas";

const MODES: { mode: Mode; label: string; scale: number; items: string[] }[] = [
  { mode: "rooms", label: "Rooms", scale: 3, items: SCENE_NUMBERS.map(String) },
  { mode: "sprites", label: "Sprites", scale: 3, items: SHAPE_NAMES },
  { mode: "deltas", label: "Delta sets", scale: 2, items: DELTA_SET_NUMBERS.map(String) },
];

// "scheme" follows the room's own color scheme; other entries put RED/GREEN/BLUE over DGEN.PAL.
const PALETTES = [
  { value: "scheme", label: "Room scheme" },
  { value: "BLUE", label: "DGEN + blue" },
  { value: "GREEN", label: "DGEN + green" },
  { value: "RED", label: "DGEN + red" },
  { value: "TITLE", label: "TITLE" },
];

const data = new GameData(async (path) => {
  const res = await fetch(`/dgener/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
});
const music = new Music();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = $<HTMLDivElement>("tabs");
const itemSelect = $<HTMLSelectElement>("item");
const paletteSelect = $<HTMLSelectElement>("palette");
const musicButton = $<HTMLButtonElement>("music");
const canvas = $<HTMLCanvasElement>("view");
const status = $<HTMLDivElement>("status");
const ctx = canvas.getContext("2d")!;

let mode: Mode = "rooms";
let rects: SheetRect[] = [];
let summary = "";
let renderId = 0;

function modeInfo() {
  return MODES.find((m) => m.mode === mode)!;
}

function fill(select: HTMLSelectElement, options: { value: string; label: string }[], value: string) {
  select.replaceChildren(...options.map((o) => new Option(o.label, o.value)));
  select.value = options.some((o) => o.value === value) ? value : options[0].value;
}

async function paletteFor(scheme: 0 | 1 | 3): Promise<Palette> {
  const choice = paletteSelect.value;
  if (choice === "TITLE") return data.palette("TITLE");
  const name = (choice === "scheme" ? SCHEME_PALETTES[scheme] : choice) as PaletteName;
  return withScheme(await data.palette("DGEN"), await data.palette(name));
}

function show(screen: Screen, palette: Palette, transparentZero: boolean) {
  const { scale } = modeInfo();
  canvas.width = screen.width;
  canvas.height = screen.height;
  canvas.style.width = `${screen.width * scale}px`;
  canvas.style.height = `${screen.height * scale}px`;
  const image = ctx.createImageData(screen.width, screen.height);
  screen.toRGBA(palette, transparentZero, image.data);
  ctx.putImageData(image, 0, 0);
}

async function render() {
  const id = ++renderId;
  const item = itemSelect.value;
  location.hash = `${mode}/${item}`;
  try {
    if (mode === "rooms") {
      const n = Number(item);
      const [scene, assets] = await Promise.all([data.scene(n), data.roomAssets(n)]);
      const screen = new Screen();
      const scheme = renderRoom(screen, scene, n, assets);
      const palette = await paletteFor(scheme);
      if (id !== renderId) return;
      show(screen, palette, false);
      rects = [];
      summary = `SCENE${n}.DLT  scheme ${SCHEME_PALETTES[scheme]}  DLTSET${deltaSetFor(n)}  ${scene.pieces.length} pieces${scene.message ? `  "${scene.message}"` : ""}`;
    } else {
      const sheet = mode === "sprites" ? shapeSheet((await data.shapes(item))[0].root) : deltaSheet(await data.deltaSet(Number(item)));
      const palette = await paletteFor(0);
      if (id !== renderId) return;
      show(sheet.screen, palette, false);
      rects = sheet.rects;
      summary = mode === "sprites" ? `VGA/${item}.VGA  ${rects.length} frames` : `DLTSET${item}.DAT  ${rects.length} entries`;
    }
    status.textContent = summary;
  } catch (err) {
    if (id === renderId) status.textContent = String(err);
  }
}

function selectMode(next: Mode, item?: string) {
  mode = next;
  for (const button of tabs.children) button.setAttribute("aria-pressed", String((button as HTMLElement).dataset.mode === mode));
  const info = modeInfo();
  fill(itemSelect, info.items.map((i) => ({ value: i, label: mode === "rooms" ? `Scene ${i}` : mode === "deltas" ? `DLTSET${i}` : i })), item ?? info.items[0]);
  const palettes = mode === "rooms" ? PALETTES : PALETTES.slice(1);
  fill(paletteSelect, palettes, paletteSelect.value);
  render();
}

for (const m of MODES) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = m.label;
  button.dataset.mode = m.mode;
  button.addEventListener("click", () => selectMode(m.mode));
  tabs.append(button);
}

itemSelect.addEventListener("change", render);
paletteSelect.addEventListener("change", render);

document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const options = itemSelect.options;
  const next = itemSelect.selectedIndex + (e.key === "ArrowRight" ? 1 : -1);
  if (next < 0 || next >= options.length) return;
  itemSelect.selectedIndex = next;
  e.preventDefault();
  render();
});

canvas.addEventListener("mousemove", (e) => {
  if (!rects.length) return;
  const box = canvas.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * canvas.width;
  const y = ((e.clientY - box.top) / box.height) * canvas.height;
  const hit = rects.find((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  status.textContent = hit ? `${summary}  |  ${hit.label}: ${hit.width}x${hit.height}` : summary;
});

const TRACKS = [null, "dgen", "dgen2"] as const;
musicButton.addEventListener("click", async () => {
  const next = TRACKS[(TRACKS.indexOf(music.track) + 1) % TRACKS.length];
  if (next) await music.play(next);
  else music.stop();
  musicButton.textContent = `Music: ${next ?? "off"}`;
});

const [hashMode, hashItem] = location.hash.slice(1).split("/");
selectMode(MODES.some((m) => m.mode === hashMode) ? (hashMode as Mode) : "rooms", hashItem);
