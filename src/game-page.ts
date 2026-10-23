// The game on its own (./game.html, the page `bun run build` ships): boots into the story, title and attract
// like the original; a key or the fire button starts a game.
import { Music } from "./audio/music.ts";
import { parseAmigaEffects } from "./formats/aga.ts";
import { HostAudio } from "./game/host/audio.ts";
import { type AgaHandle, startAga } from "./game/host/host.ts";

const SOUND_SETTING = "d-generation-aga-sound";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const saveButton = $<HTMLButtonElement>("save");
const restoreButton = $<HTMLButtonElement>("restore");
const soundButton = $<HTMLButtonElement>("sound");
const stopped = $<HTMLDivElement>("stopped");
const status = $<HTMLDivElement>("status");

let sound = localStorage.getItem(SOUND_SETTING) !== "off";
soundButton.textContent = `Sound: ${sound ? "on" : "off"}`;
let game: AgaHandle | null = null;
let audio: HostAudio | null = null;

function showStop(err: unknown) {
  console.error(err);
  stopped.textContent = `Game stopped: ${err instanceof Error ? err.message : String(err)}`;
  stopped.hidden = false;
}

// Buttons give the keyboard back to the game (Space would press them again).
saveButton.addEventListener("click", () => {
  saveButton.blur();
  game?.save();
});
restoreButton.addEventListener("click", () => {
  restoreButton.blur();
  game?.restore();
});
soundButton.addEventListener("click", () => {
  soundButton.blur();
  sound = !sound;
  localStorage.setItem(SOUND_SETTING, sound ? "on" : "off");
  soundButton.textContent = `Sound: ${sound ? "on" : "off"}`;
  audio?.setMuted(!sound);
  audio?.unlock();
});

// Static hosts such as GitHub Pages send no COOP/COEP headers: let ./coi-sw.js add them and reload once through
// it. The session flag stops a reload loop where service workers are unavailable (e.g. private browsing).
const ISOLATION_RELOAD = "d-generation-isolation-reload";
if (crossOriginIsolated) sessionStorage.removeItem(ISOLATION_RELOAD);
else if ("serviceWorker" in navigator && isSecureContext && !sessionStorage.getItem(ISOLATION_RELOAD)) {
  sessionStorage.setItem(ISOLATION_RELOAD, "1");
  status.textContent = "Enabling cross-origin isolation...";
  await navigator.serviceWorker.register("coi-sw.js");
  await navigator.serviceWorker.ready;
  location.reload();
  await new Promise(() => {}); // the reload replaces this page
}

try {
  status.textContent = "Loading...";
  const effects = await fetch("amiga/aga/amiga.eff");
  if (!effects.ok) throw new Error(`amiga.eff: HTTP ${effects.status}`);
  audio = new HostAudio(parseAmigaEffects(new Uint8Array(await effects.arrayBuffer())), new Music(), !sound);
  game = await startAga({
    canvas: $<HTMLCanvasElement>("game"),
    box: $<HTMLDivElement>("box"),
    audio,
    demo: true,
    onStatus: (text) => (status.textContent = text),
    onStop: (err) => {
      game = null;
      showStop(err);
    },
  });
} catch (err) {
  status.textContent = "";
  showStop(err);
}
