import { waitTick } from "../dos/hardware.ts";
import { call, register } from "../dispatch.ts";
import { cellAt } from "../geometry/room.ts";
import { drawToFront, drawToPanel, restoreDrawTarget } from "../geometry/draw.ts";
import { offsetRows, saveVideoMode } from "../geometry/math.ts";
import type { Memory } from "../memory.ts";
import {
  free,
  malloc,
  memset,
  sprintf,
  strcmp,
  strncmp,
  timerAlloc,
  timerEnable,
  timerFree,
  timerFreeze,
  timerGet,
  timerSet,
  timerThaw,
} from "../runtime.ts";
import { setPalette } from "../vga.ts";

const ROOM = 0x337e; // current room
const LOADED_SCENE = 0x1990;
const DATA_DIR = 0x199b; // path prefix for data files
const VISITED = 0x3414; // 150 bytes, one per room
const GAME_TIMER = 0x33f4;
const SCENE_CHUNKS = 0x5f64; // 3 malloc'd type 0x0e chunks
const MAP_ROWS = 0x5f72; // 3 maps of 13 rows x 11 bytes

const s8 = (v: number) => ((v & 0xff) << 24) >> 24;

// 0:2587 showBuffers(): VGA path: copies the full screen with 0:0bc6 and 0:0c81.
export function showBuffers(m: Memory): void {
  call(m, "0:0bc6", 0, 0, m.u16(0x30be), m.u16(0x309c));
  call(m, "0:0c81", 0, 0, m.u16(0x30be), m.u16(0x309c));
}

// 0:2d2e resetCells(): clears DS:5de4 and runs 0:d5fb on every cell of the 10x13 grid.
export function resetCells(m: Memory): void {
  memset(m, 0x5de4, 0, 0x17a);
  const cursor = m.push(0x1e);
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 10; col++) {
      m.set8(cursor + 0x10, col);
      m.set8(cursor + 0x11, row);
      cellAt(m, cursor);
      m.set8(0x5f5e, 0xff);
      call(m, "0:d5fb", cursor);
    }
  }
  m.pop(0x1e);
}

// 0:3085 fadeOut(): fades DAC color 0 (palette DS:4a6) from 0x3f to black, one step per tick.
export function fadeOut(m: Memory): void {
  if (!m.u16(0x2e5c)) return;
  setPalette(m, 0x4a9, 0, 1);
  for (let v = 0x3f; v > 0; v -= 2) {
    m.set8(0x4a6, v);
    m.set8(0x4a8, v);
    delay(m, 1, 0);
    setPalette(m, 0x4a6, 0, 1);
  }
}

// 0:30f8 startGame(argc, argv): installs timers and keyboard, parses the command line, loads everything.
export function startGame(m: Memory, argc: number, argv: number): void {
  saveVideoMode(m);
  call(m, "0:e3b3");
  call(m, "0:b7d4");
  m.set16(0x5f60, 0);
  call(m, "0:d02f");
  m.set8(GAME_TIMER, timerAlloc(m));
  timerSet(m, s8(m.u8(GAME_TIMER)), 0);
  timerEnable(m, s8(m.u8(GAME_TIMER)), 0);
  timerFreeze(m, s8(m.u8(GAME_TIMER)));
  m.set8(0x3412, timerAlloc(m));
  m.set8(0x5f62, timerAlloc(m));
  m.set8(0x3382, timerAlloc(m));
  timerSet(m, s8(m.u8(0x3382)), 0xa);
  timerEnable(m, s8(m.u8(0x3382)), 1);
  timerFreeze(m, s8(m.u8(0x3382)));
  m.set8(0x340b, timerAlloc(m));
  timerSet(m, s8(m.u8(0x340b)), 0xc8);
  timerEnable(m, s8(m.u8(0x340b)), 1);
  call(m, "fff:0e2f");
  call(m, "0:c75b");
  for (let i = 0; i < 3; i++) m.set16(SCENE_CHUNKS + i * 2, 0);
  init(m, argc, argv);
  call(m, "0:e5fb");
  memset(m, VISITED, 0, 0x96);
  call(m, "0:2107", 1);
  call(m, "0:1fb7");
  m.set16(0x5f6a, 0x4ad);
  m.set16(0x5f6c, 0x4ad);
}

// 0:31fd shutdown(): restores the timer, keyboard and video mode.
export function shutdown(m: Memory): void {
  call(m, "0:e41f");
  call(m, "0:e62b");
  call(m, "fff:2bd5");
}

// 0:3209 init(argc, argv): command line (-h -c -e -d -v -m -q -i -kN), display detection, shape sets
// (names at DS:4af), title sequence, first scene.
export function init(m: Memory, argc: number, argv: number): void {
  let debug = 0;
  m.set16(0x2e5c, 0);
  m.set16(0x2e5e, 0);
  m.set16(0x2f0a, 0);
  m.set16(0x2f08, 0);
  m.set16(0x8f, 1);
  for (let i = 1; i < ((argc << 16) >> 16); i++) {
    const arg = m.u16(argv + i * 2);
    if (!strcmp(m, arg, 0x56a)) m.set16(0x2f0a, 1);
    if (!strcmp(m, arg, 0x56d)) m.set16(0x2f08, 1);
    if (!strcmp(m, arg, 0x570)) m.set16(0x2e5e, 1);
    if (!strcmp(m, arg, 0x573)) debug = 1;
    if (!strcmp(m, arg, 0x576)) m.set16(0x2e5c, 1);
    if (!strcmp(m, arg, 0x579)) {
      m.set16(0x2f08, 1);
      m.set16(0x5f6e, 1);
    }
    if (!strcmp(m, arg, 0x57c)) m.set16(0x19ec, 1);
    if (!strcmp(m, arg, 0x57f)) m.set16(0x8f, 0);
    if (!strncmp(m, arg, 0x582, 2)) m.set8(0x4ac, m.u8(arg + 2) - 0x30);
  }
  if (m.u16(0x2e5c)) {
    m.set16(0x2f0a, 0);
    m.set16(0x2f08, 0);
    m.set16(0x2e5e, 0);
  } else if (m.u16(0x2e5e)) {
    m.set16(0x2f0a, 0);
    m.set16(0x2f08, 0);
    m.set16(0x2e5c, 0);
  }
  let adapter = call(m, "14fd:000a") & 0xffff;
  if (!(adapter & 0xff)) {
    if (adapter & 0xff00) adapter = s8(adapter >> 8) & 0xffff;
    adapter &= 0xff;
  }
  if (adapter === 2 || adapter === 1) m.set16(0x18f9, 1);
  else if (adapter === 3) m.set16(0x18f7, 1);
  if (!m.u16(0x2f08) && !m.u16(0x2f0a) && !m.u16(0x2e5e) && !m.u16(0x2e5c)) {
    if (adapter === 1 || adapter === 2) m.set16(0x2e5c, 1);
    else if (adapter === 3) m.set16(0x2e5e, 1);
    else if (adapter === 4) m.set16(0x2f08, 1);
    else if (adapter === 5) m.set16(0x2f0a, 1);
    // Adapter 0 jumps past the push of the message and passes stack garbage instead.
    else call(m, "0:02f8", 0, 0x585);
  }
  call(m, "0:08b1", debug);
  call(m, "0:0947");
  if (call(m, "0:04fa")) call(m, "0:02f8", 0xa, 0);
  call(m, "0:6bd2");
  call(m, "0:0339");
  call(m, "0:03b6");
  call(m, "0:04a8");
  loadMaps(m);
  m.set16(0x2f00, m.u16(0x2ee2));
  m.set16(0x2f02, m.u16(0x2ee4));
  let i = 0;
  for (; i < 0x19; i++) call(m, "0:0000", m.u16(0x4af + i * 2));
  drawToFront(m);
  m.set16(0x2f04, m.u16(0x2e60));
  m.set16(0x2f06, m.u16(0x2e62));
  restoreDrawTarget(m);
  for (const v of [1, 0, 3, 2]) call(m, "0:06ea", v);
  m.set8(0x1955, 0);
  title(m);
  call(m, "0:06ea", 0);
  drawToPanel(m);
  m.set16(0x2f00, m.u16(0x2ef4));
  m.set16(0x2f02, m.u16(0x2ef6));
  m.set8(0x1955, 1);
  while (i < 0x1b) call(m, "0:0000", m.u16(0x4af + i++ * 2));
  m.set16(0x2efc, m.u16(0x2e60));
  m.set16(0x2efe, m.u16(0x2e62));
  call(m, "0:0000", m.u16(0x2f08) | m.u16(0x2f0a) ? 0x5a0 : 0x5a4);
  if (!m.u16(0x2e5c)) call(m, "0:0000", 0x5aa);
  restoreDrawTarget(m);
  m.set16(0x5f70, call(m, "0:c739"));
  loadScene(m, m.u8(ROOM));
  call(m, "0:c6c6", 1);
  m.set8(0x1955, 0);
  call(m, "0:06a6", 0);
}

// 0:354e loadScene(scene): reads SCENEn.DLT (n = scene + 1): 0x430-byte header at DS:34e4, then chunks
// {type, size, data}: 0x0b -> DS:197b (count DS:1979 = size/8), 0x0a -> DS:1973 (DS:1971 = size/5),
// 0x11 -> DS:1977 (DS:1975 = size/10), 0x0e -> up to three relocated chunks at DS:5f64.
export function loadScene(m: Memory, scene: number): void {
  const name = m.push(0x14);
  const header = m.push(4);
  scene &= 0xff;
  sprintf(m, name, 0x5b0, m.u16(DATA_DIR), scene + 1);
  if (scene !== m.u16(LOADED_SCENE)) {
    m.set16(LOADED_SCENE, scene);
    const fd = call(m, "0:f99c", name, 0) & 0xffff;
    if (fd === 0xffff) {
      call(m, "0:02f8", 0xd, name);
    } else {
      if ((call(m, "0:fd5d", fd, 0x34e4, 0x430) & 0xffff) !== 0x430) call(m, "0:02f8", 0xd, name);
      for (const p of [0x1977, 0x1973, 0x197b]) if (m.u16(p)) free(m, m.u16(p));
      for (let i = 0; i < 3; i++) {
        const p = SCENE_CHUNKS + i * 2;
        if (m.u16(p)) free(m, m.u16(p));
        m.set16(p, 0);
      }
      let chunks = 0;
      for (const p of [0x197b, 0x1973, 0x1977, 0x1979, 0x1971, 0x1975]) m.set16(p, 0);
      while ((call(m, "0:fd5d", fd, header, 4) & 0xffff) === 4) {
        const type = m.u16(header);
        const size = m.u16(header + 2);
        if (type === 0xb) {
          const buf = malloc(m, size);
          m.set16(0x197b, buf);
          if (buf && (call(m, "0:fd5d", fd, buf, size) & 0xffff) === size) m.set16(0x1979, size >> 3);
        }
        if (type === 0xa) {
          const buf = malloc(m, size);
          m.set16(0x1973, buf);
          if (buf && (call(m, "0:fd5d", fd, buf, size) & 0xffff) === size) m.set16(0x1971, Math.floor(size / 5));
        }
        if (type === 0x11) {
          const buf = malloc(m, size);
          m.set16(0x1977, buf);
          if (buf && (call(m, "0:fd5d", fd, buf, size) & 0xffff) === size) m.set16(0x1975, Math.floor(size / 10));
        }
        if (type === 0xe && chunks < 3) {
          const p = SCENE_CHUNKS + chunks * 2;
          const buf = malloc(m, size);
          m.set16(p, buf);
          if (buf) {
            if ((call(m, "0:fd5d", fd, buf, size) & 0xffff) === size) {
              relocateChunk(m, buf);
              chunks++;
            } else {
              free(m, buf);
              m.set16(p, 0);
            }
          }
        }
      }
    }
    call(m, "0:fd93", fd);
  }
  m.pop(4);
  m.pop(0x14);
}

// 0:3771 relocateChunk(chunk): turns the file offsets of a type 0x0e chunk into pointers. Layout: 20 entries of
// 12 bytes at +0x0c (pointer + up to 5 record indexes), pointers at +0xfc/+0xfe, record count at +0x100,
// records of 26 bytes at +0x102 (pointer + up to 6 more), data after the records.
export function relocateChunk(m: Memory, chunk: number): void {
  const count = m.u16(chunk + 0x100);
  const records = (chunk + 0x102) & 0xffff;
  const delta = (records + count * 26 - 1) & 0xffff;
  const fix = (p: number) => m.set16(p, m.u16(p) + delta);
  if (m.u16(chunk + 0xfc)) fix(chunk + 0xfc);
  if (m.u16(chunk + 0xfe)) fix(chunk + 0xfe);
  for (let i = 0; i < 20; i++) {
    const e = chunk + 0xc + i * 12;
    if (!m.u16(e)) break;
    fix(e);
    for (let j = 0; j < 5; j++) {
      const p = e + 2 + j * 2;
      if (!m.u16(p)) break;
      m.set16(p, m.u16(p) * 26 + records - 26);
    }
  }
  for (let i = 0; i < ((count << 16) >> 16); i++) {
    const r = records + i * 26;
    fix(r);
    for (let j = 0; j < 6; j++) {
      if (!m.u16(r + 2 + j * 2)) break;
      fix(r + 2 + j * 2);
    }
  }
}

// 0:38b0 title(): title screen or the next demo entry of the attract loop (DS:198d indexes DS:5f6), or the game
// start when DS:198f is set.
export function title(m: Memory): void {
  const savedTarget = m.u16(0x282b);
  m.set16(0x282b, m.u16(0x2829));
  const saved3a7e = m.u16(0x3a7e);
  m.set16(0x3a7e, m.u16(0x309e));
  call(m, "0:0ab1");
  if (m.u8(0x198f)) {
    m.set8(0x198f, 0);
    newGame(m);
    m.set16(0x282b, savedTarget);
    return;
  }
  const entry = m.u16(0x5f6 + m.u16(0x198d) * 2);
  let started = false;
  if (!m.u16(0x198d)) {
    call(m, "0:0dcc", 0x606, 0x2f9c, 0xff);
    call(m, "0:c570", 0x15);
    call(m, "0:c244", 0, 0, (m.u16(0x196d) + m.u16(m.u16(0x196b))) & 0xffff, m.u16(0x196f));
    m.set8(0x1954, 0xff);
    if (m.u16(0x2e5c)) {
      m.set16(0x196f, 0);
      m.set16(0x196d, 0);
    }
    call(m, "0:0dcc", m.u16(0x19ad), 0x2f9c, 0xff);
    setPalette(m, m.u16(0x30c0), 0, 0x100);
    call(m, "0:0bc6", 0, 0, m.u16(0x30be), m.u16(0x309c));
    if (delay(m, 0x118, 1)) {
      newGame(m);
      started = true;
    }
  }
  if (!started) {
    m.set8(0x1989, 1);
    m.set8(0x1987, 0);
    call(m, "0:bf21", s8(m.u8(entry + 1)) & 0xffff);
    const row = m.push(2);
    const col = m.push(2);
    const room = (m.u8(entry) - 1) & 0xff;
    m.set8(ROOM, room);
    call(m, "0:bd8c", room, row, col);
    m.set8(0x337c, m.u8(row));
    m.set8(0x337d, m.u8(col));
    m.pop(2);
    m.pop(2);
    m.set8(0x3362, 5);
    m.set8(0x3363, 0);
    m.set8(0x3368, m.u8(entry + 2));
    m.set8(0x3369, m.u8(entry + 3));
    m.set8(0x336a, m.u8(entry + 4));
    m.set16(0x33f2, 1);
    memset(m, VISITED, 0, 0x96);
    m.set16(0x198d, m.u16(0x198d) + 1);
    if (m.u16(0x5f6 + m.u16(0x198d) * 2) === 0x5f1) m.set16(0x198d, 0);
  }
  m.set16(0x282b, savedTarget);
  call(m, "0:0b79");
  call(m, "0:0bc6", 0, 0, m.u16(0x30be), m.u16(0x309c));
  setPalette(m, m.u16(0x30c2), 0, 0x100);
  m.set16(0x3a7e, saved3a7e);
}

// 0:3a71 newGame(): resets the game state and starts in room 0 at its start cell (4,3 if none).
export function newGame(m: Memory): void {
  m.set8(0x1987, 0);
  m.set16(0x33f2, 1);
  call(m, "0:b748");
  call(m, "0:1f87");
  memset(m, VISITED, 0, 0x96);
  m.set8(ROOM, 0);
  m.set8(0x3381, 0);
  m.set8(0x3368, 0);
  call(m, "0:0ab1");
  const col = m.push(2);
  const row = m.push(2);
  if (call(m, "0:bd8c", 0, row, col)) {
    m.set8(0x337c, m.u8(row));
    m.set8(0x337d, m.u8(col));
  } else {
    m.set8(0x337c, 4);
    m.set8(0x337d, 3);
  }
  m.pop(2);
  m.pop(2);
  call(m, "0:1e76");
}

// 0:3ae1 delay(ticks, interruptible): waits on a fresh timer with the game timer running; a key or fire
// button ends it early when interruptible. Returns 1 if interrupted.
export function delay(m: Memory, ticks: number, interruptible: number): number {
  let interrupted = 0;
  timerThaw(m, s8(m.u8(GAME_TIMER)));
  const slot = s8(timerAlloc(m));
  if ((slot & 0xff) === 0xff) call(m, "0:02f8", 0x14, 0);
  timerSet(m, slot, ticks);
  timerEnable(m, slot, 1);
  timerFreeze(m, slot);
  for (;;) {
    if (interruptible) {
      if (call(m, "0:c77b", 0) === 2 || call(m, "0:c77b", 1) === 2) {
        interrupted = 1;
        break;
      }
      if ((call(m, "0:e732") & 0xffff) !== 0xffff) {
        call(m, "0:e719");
        interrupted = 1;
        break;
      }
    }
    waitTick(m);
    if (((timerGet(m, slot) << 16) >> 16) <= 0) break;
  }
  timerThaw(m, slot);
  timerFree(m, slot);
  timerFreeze(m, s8(m.u8(GAME_TIMER)));
  return interrupted;
}

// 0:3b9c loadMaps(): reads MAPMTX0..2.DAT (13 rows x 11 bytes each) into DS:5f72 and offsets their room numbers.
export function loadMaps(m: Memory): void {
  const name = m.push(0x1e);
  for (let i = 0; i < 3; i++) {
    sprintf(m, name, 0x60c, m.u16(DATA_DIR), i);
    const fd = call(m, "0:f99c", name, 0) & 0xffff;
    if (fd === 0xffff) {
      call(m, "0:02f8", 0xe, 0);
      break;
    }
    call(m, "0:fd5d", fd, MAP_ROWS + i * 143, 0x8f);
    offsetRows(m, i);
    call(m, "0:fd93", fd);
  }
  m.pop(0x1e);
}

register("0:2587", showBuffers);
register("0:2d2e", resetCells);
register("0:3085", fadeOut);
register("0:30f8", startGame);
register("0:31fd", shutdown);
register("0:3209", init);
register("0:354e", loadScene);
register("0:3771", relocateChunk);
register("0:38b0", title);
register("0:3a71", newGame);
register("0:3ae1", delay);
register("0:3b9c", loadMaps);
