import { Music, type Track } from "./audio/music.ts";
import { parseFloor, type Floor } from "./formats/level.ts";
import type { Palette } from "./formats/palette.ts";
import { HostAudio } from "./game/host/audio.ts";
import { FLOOR_FILES } from "./game/host/files.ts";
import { type AgaHandle, startAga } from "./game/host/host.ts";
import { loadAgaAssets, type AgaAssets } from "./game/render/assets.ts";
import { drawRoom, roomDeltaSet, roomImage, roomPalette, type Scheme } from "./game/render/room.ts";
import { Screen } from "./render/screen.ts";
import { deltaSheet, shapeSheet, type SheetRect } from "./render/sheet.ts";

type Mode = "play" | "rooms" | "sprites" | "deltas";
type AgaMode = "attract" | "new";

interface Item {
  value: string;
  label: string;
  group?: string;
}

const MODES: { mode: Mode; label: string; scale: number }[] = [
  { mode: "play", label: "Play", scale: 3 },
  { mode: "rooms", label: "Rooms", scale: 3 },
  { mode: "sprites", label: "Sprites", scale: 3 },
  { mode: "deltas", label: "Delta sets", scale: 2 },
];

// "room" is the room's own palette (./src/game/render/room.ts roomPalette); the others put BLUE/GREEN/RED.PAL
// over DGEN.PAL colours 32..79 or show TITLE.PAL.
const PALETTES = [
  { value: "room", label: "Room palette" },
  { value: "blue", label: "DGEN + blue" },
  { value: "green", label: "DGEN + green" },
  { value: "red", label: "DGEN + red" },
  { value: "title", label: "TITLE" },
];
const SCHEME_NAMES: Record<Scheme, string> = { 0: "BLUE", 1: "GREEN", 3: "RED", 4: "SCENE" };

// The AGA viewer data: ./amiga/aga files (served as /amiga/aga) and the ./levels floors, bundled as text.
let viewerData: Promise<{ assets: AgaAssets; floors: Floor[] }> | null = null;
function loadViewerData() {
  viewerData ??= (async () => {
    const assets = loadAgaAssets(async (path) => {
      const res = await fetch(`/amiga/aga/${path}`);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });
    const files = Object.keys(FLOOR_FILES).sort();
    const floors = await Promise.all(files.map(async (file) => parseFloor(await FLOOR_FILES[file]())));
    return { assets: await assets, floors };
  })();
  return viewerData;
}

const music = new Music();
const AGA_SOUND_SETTING = "d-generation-aga-sound";
let agaSound = localStorage.getItem(AGA_SOUND_SETTING) !== "off";
let agaAudio: HostAudio | null = null;
let aga: AgaHandle | null = null;
let agaShown = false;
const AGA_ITEMS: { value: AgaMode; label: string }[] = [
  { value: "attract", label: "Title and attract" },
  { value: "new", label: "New game" },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = $<HTMLDivElement>("tabs");
const itemSelect = $<HTMLSelectElement>("item");
const paletteSelect = $<HTMLSelectElement>("palette");
const musicButton = $<HTMLButtonElement>("music");
const canvas = $<HTMLCanvasElement>("view");
const agaBox = $<HTMLDivElement>("aga-box");
const agaCanvas = $<HTMLCanvasElement>("aga");
const stopped = $<HTMLDivElement>("stopped");
const status = $<HTMLDivElement>("status");
const ctx = canvas.getContext("2d")!;

let mode: Mode = "rooms";
let rects: SheetRect[] = [];
let summary = "";
let renderId = 0;

function modeInfo() {
  return MODES.find((m) => m.mode === mode)!;
}

function fill(select: HTMLSelectElement, items: Item[], value: string) {
  const groups = new Map<string, HTMLOptGroupElement>();
  select.replaceChildren(
    ...items.flatMap((item) => {
      const option = new Option(item.label, item.value);
      if (item.group === undefined) return [option];
      let group = groups.get(item.group);
      if (group) {
        group.append(option);
        return [];
      }
      group = document.createElement("optgroup");
      group.label = item.group;
      group.append(option);
      groups.set(item.group, group);
      return [group];
    }),
  );
  select.value = items.some((i) => i.value === value) ? value : items[0].value;
}

async function modeItems(): Promise<Item[]> {
  const { assets, floors } = await loadViewerData();
  if (mode === "rooms") {
    return floors.flatMap((floor) =>
      floor.rooms.map((room) => ({
        value: `${floor.floor}-${room.scene}`,
        label: `Scene ${room.scene}${room.message ? `  ${room.message}` : ""}`,
        group: `L${floor.floor}.SCN  floor ${floor.buildingFloor}`,
      })),
    );
  }
  if (mode === "sprites") {
    return [...assets.banks].flatMap(([bank, sets]) =>
      [...sets.keys()].map((id) => ({ value: `${bank}.${id}`, label: `${bank} set ${id}`, group: `${bank.toLowerCase()}.aga` })),
    );
  }
  return [...assets.deltaSets.keys()].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `DLTSET${n}` }));
}

// DGEN.PAL with a colour scheme over 32..79, or TITLE.PAL.
function overlayPalette(assets: AgaAssets, choice: string): Palette {
  const { palettes } = assets;
  if (choice === "title") return palettes.title;
  const pal = palettes.dgen.slice();
  pal.set(choice === "green" ? palettes.green : choice === "red" ? palettes.red : palettes.blue, 32 * 3);
  return pal;
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
    const { assets, floors } = await loadViewerData();
    if (mode === "rooms") {
      const [floorNumber, scene] = item.split("-").map(Number);
      const floor = floors.find((f) => f.floor === floorNumber)!;
      const room = floor.rooms.find((r) => r.scene === scene)!;
      const image = roomImage(scene);
      if (image) await assets.vim(image);
      const screen = new Screen();
      const scheme = drawRoom(screen, room, assets, scene);
      const choice = paletteSelect.value;
      const palette = choice === "room" ? roomPalette(assets, scene, scheme) : overlayPalette(assets, choice);
      if (id !== renderId) return;
      show(screen, palette, false);
      rects = [];
      const pieces = room.chunks.reduce((n, c) => n + (c.kind === "pieces" ? c.pieces.length : 0), 0);
      const source = image ? `${image}.vim` : `DLTSET${roomDeltaSet(scene)}`;
      summary = `L${floorNumber}.SCN  scene ${scene}  scheme ${SCHEME_NAMES[scheme]}  ${source}  ${pieces} pieces${room.message ? `  "${room.message}"` : ""}`;
    } else {
      let sheet;
      if (mode === "sprites") {
        const [bank, id] = item.split(".");
        sheet = shapeSheet(assets.banks.get(bank)!.get(Number(id))!);
      } else {
        sheet = deltaSheet(assets.deltaSets.get(Number(item))!);
      }
      const palette = overlayPalette(assets, paletteSelect.value);
      if (id !== renderId) return;
      show(sheet.screen, palette, false);
      rects = sheet.rects;
      summary = mode === "sprites" ? `aga/${item.split(".")[0].toLowerCase()}.aga set ${item.split(".")[1]}  ${rects.length} frames` : `DLTSET${item}.DAT  ${rects.length} entries`;
    }
    status.textContent = summary;
  } catch (err) {
    if (id === renderId) status.textContent = String(err);
  }
}

// Play runs the native game in a paced worker: Attract or New game, chosen in the item list.
function showAga(on: boolean, choice = itemSelect.value) {
  stopped.hidden = true;
  aga?.stop();
  aga = null;
  if (!on) {
    if (agaShown) musicButton.textContent = "Music: off";
    agaShown = false;
    return;
  }
  agaShown = true;
  music.stop();
  musicButton.textContent = `Sound: ${agaSound ? "on" : "off"}`;
  fill(itemSelect, AGA_ITEMS, choice);
  agaCanvas.getContext("2d")!.clearRect(0, 0, agaCanvas.width, agaCanvas.height);
  void startAgaMode(itemSelect.value as AgaMode);
}

async function startAgaMode(choice: AgaMode) {
  const id = ++renderId;
  location.hash = `play/${choice}`;
  status.textContent = "Loading...";
  try {
    const { assets } = await loadViewerData();
    if (id !== renderId || mode !== "play") return;
    agaAudio ??= new HostAudio(assets.sounds, music, !agaSound);
    const handle = await startAga({
      canvas: agaCanvas,
      box: agaBox,
      audio: agaAudio,
      demo: choice === "attract",
      onStatus: (text) => (status.textContent = text),
      onStop: (err) => {
        aga = null;
        showStop(err);
      },
    });
    if (id !== renderId || mode !== "play") return handle.stop();
    aga = handle;
  } catch (err) {
    if (id !== renderId) return;
    status.textContent = "";
    showStop(err);
  }
}

// The engine stops at the first thing it has not ported ("... not ported") or any other error: say so plainly.
function showStop(err: unknown) {
  console.error(err);
  stopped.textContent = `Game stopped: ${err instanceof Error ? err.message : String(err)}`;
  stopped.hidden = false;
}

async function selectMode(next: Mode, item?: string) {
  mode = next;
  for (const button of tabs.children) button.setAttribute("aria-pressed", String((button as HTMLElement).dataset.mode === mode));
  const playing = mode === "play";
  document.body.classList.toggle("play", playing);
  agaBox.hidden = !playing;
  canvas.hidden = playing;
  paletteSelect.hidden = playing;
  showAga(playing, item);
  if (playing) return;
  const id = ++renderId;
  status.textContent = "Loading...";
  let items: Item[];
  try {
    items = await modeItems();
  } catch (err) {
    if (id === renderId) status.textContent = String(err);
    return;
  }
  if (id !== renderId) return;
  fill(itemSelect, items, item ?? items[0].value);
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

itemSelect.addEventListener("change", () => {
  if (mode !== "play") return render();
  itemSelect.blur();
  showAga(true);
});
paletteSelect.addEventListener("change", render);

document.addEventListener("keydown", (e) => {
  if (mode === "play") return; // ./src/game/host/input.ts has the keyboard
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
  if (mode === "play") {
    agaSound = !agaSound;
    localStorage.setItem(AGA_SOUND_SETTING, agaSound ? "on" : "off");
    agaAudio?.setMuted(!agaSound);
    agaAudio?.unlock();
    musicButton.textContent = `Sound: ${agaSound ? "on" : "off"}`;
    return;
  }
  const next = TRACKS[(TRACKS.indexOf(music.track) + 1) % TRACKS.length];
  if (next) await music.play(next);
  else music.stop();
  musicButton.textContent = `Music: ${next ?? "off"}`;
});

const [hashMode, hashItem] = location.hash.slice(1).split("/");
selectMode(MODES.some((m) => m.mode === hashMode) ? (hashMode as Mode) : "play", hashItem);
