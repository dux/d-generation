import { call, register } from "../dispatch.ts";
import { drawTitleBar, stepCrtcScripts } from "../geometry/draw.ts";
import { clearObjectFlag35, shuffleNames } from "../geometry/math.ts";
import { updateBox } from "../geometry/objects.ts";
import { drawAllLowWalls, drawAllTallWalls } from "../geometry/room.ts";
import type { Memory } from "../memory.ts";
import { waitTick } from "../dos/hardware.ts";
import { memcpy, memset, reset61a8, sprintf, timerEnable, timerExchange, timerFreeze, timerGet, timerSet, timerThaw } from "../runtime.ts";
import { setPalette } from "../vga.ts";
import {
  clearBack,
  clearFront,
  endFlash,
  loadPanelShapes,
  restoreBackgrounds,
  selectFloorPalette,
  setRoomPalette,
  showDirtyRects,
} from "./display.ts";
import { checkRoomCleared, collectClass8, spawnObjects, updateObjects } from "./objects.ts";

export const ROOM = 0x337e; // current room number (byte)
export const ROOM_CHANGE = 0x33f2; // set to rebuild the room at the top of the next frame
export const FRAME_TIMER = 0x33f4; // timer slot paced by frameSync
export const FRAME_STEP = 0x3408; // movement per frame (ticks * 40, max 0x300), 0 when paused
export const PLAYER_STATE = 0x3362; // 25 bytes: lives (+0), ...; saved at DS:34b2 (room entry) and DS:34cb (checkpoint)
export const ROOM_TIMER = 0x340b; // timer slot of the room's time limit
export const PALETTE_TIMER = 0x3382;

// 0:15a7 cyclePalette(): every 8 ticks steps the palette animation scripts (DS:38c, 3 or 4 lists of
// { first, count, rgb... } pointers ending with 0x1e2) and loads the current entries.
export function cyclePalette(m: Memory): void {
  if (m.u8(0x337a)) return;
  const room = (m.u8(ROOM) + 1) & 0xff;
  const lists = room === 1 || room === 0x33 || room === 0x65 ? 4 : 3;
  if (timerGet(m, m.s8(PALETTE_TIMER))) return;
  m.set16(0x1994, m.u16(0x1994) + 1);
  if (m.u16(m.u16(0x38c) + m.u16(0x1994) * 2) === 0x1e2) m.set16(0x1994, 0);
  for (let k = 0; k < lists; k++) {
    const p = m.u16(m.u16(0x38c + k * 2) + m.u16(0x1994) * 2);
    if (p) setPalette(m, p + 2, m.s8(p) & 0xffff, m.s8(p + 1) & 0xffff);
  }
  timerSet(m, m.s8(PALETTE_TIMER), 8);
}

// 0:1e76 saveRoomPosition(): DS:337c..3381 to DS:34aa.
export function saveRoomPosition(m: Memory): void {
  memcpy(m, 0x34aa, 0x337c, 6);
}

// 0:1e8d restoreRoomPosition()
export function restoreRoomPosition(m: Memory): void {
  memcpy(m, 0x337c, 0x34aa, 6);
}

// 0:1f87 resetPlayerState(): 5 lives, 0x50 at +2.
export function resetPlayerState(m: Memory): void {
  m.set8(0x3362, 5);
  m.set8(0x3366, 0);
  m.set8(0x3365, 0);
  m.set8(0x3368, 0);
  m.set8(0x3363, 0);
  m.set8(0x3364, 0x50);
}

// 0:1fa2 savePlayerState(): to DS:34b2 (room entry copy).
export function savePlayerState(m: Memory): void {
  memcpy(m, 0x34b2, PLAYER_STATE, 25);
}

// 0:1fb7 saveCheckpoint(): to DS:34cb.
export function saveCheckpoint(m: Memory): void {
  memcpy(m, 0x34cb, PLAYER_STATE, 25);
}

// 0:1fcc restorePlayerState()
export function restorePlayerState(m: Memory): void {
  memcpy(m, PLAYER_STATE, 0x34b2, 25);
}

// 0:1fe1 restoreCheckpoint()
export function restoreCheckpoint(m: Memory): void {
  memcpy(m, PLAYER_STATE, 0x34cb, 25);
}

// 0:1e58 restartFromCheckpoint(): room, position and player state from the checkpoint; clears the visited rooms
// (DS:3414, 150 bytes) and the respawn point.
export function restartFromCheckpoint(m: Memory): void {
  restoreRoomPosition(m);
  restoreCheckpoint(m);
  memset(m, 0x3414, 0, 0x96);
  m.set8(0x33ee, 0);
}

// 0:1ed8 placeRespawn(): with a player (DS:3400) and a respawn point (DS:33ee room, 33ef/33f0 position, or the
// player state position DS:3368 in another room), creates the player marker object (type 0x86, 0x8a with
// DS:3c3 bit 0); keeps it if 0:d424 finds no collision and, in another room, 0:414b accepts it. On success the
// point moves to DS:340c.
export function placeRespawn(m: Memory): void {
  if (!m.u16(0x3400) || !m.u8(0x33ee)) return;
  const local = m.push(8);
  const record = local + 4;
  m.set8(record, (m.u8(0x3c3) << 7) & 0xff ? 0x8a : 0x86);
  if (m.u8(ROOM) !== m.u8(0x33ee)) {
    m.set8(record + 1, m.u8(0x3368));
    m.set8(record + 2, m.u8(0x3369));
  } else {
    m.set8(record + 1, m.u8(0x33ef));
    m.set8(record + 2, m.u8(0x33f0));
  }
  const obj = call(m, "0:2818", record) & 0xffff;
  m.set16(0x34b0, obj);
  if (
    obj &&
    !(call(m, "0:d424", obj, local + 1) & 0xffff) &&
    (m.u8(ROOM) === m.u8(0x33ee) || !(call(m, "0:414b", m.u16(0x3400), 0x1e) & 0xffff))
  ) {
    m.set8(0x340c, m.u8(0x33ee));
    m.set8(0x33ee, 0);
  } else {
    call(m, "0:2656", obj);
  }
  m.pop(8);
}

// 0:1ff6 frameSync(): the frame boundary. Waits until the frame timer reaches 2 ticks per frame (the original spins
// here while the timer interrupt counts; see waitTick); every second frame turns the elapsed ticks (1..25) into the movement
// step DS:3408 = ticks * 40 (max 0x300, halved while DS:3370 slow motion, 0 while DS:337a paused), DS:3402 unhalved.
export function frameSync(m: Memory): void {
  m.set16(0x41e, m.u16(0x41e) + 1);
  const target = (((m.u16(0x41e) * 4) << 16) >> 16) / 2 | 0;
  do waitTick(m);
  while (((timerGet(m, m.s8(FRAME_TIMER)) << 16) >> 16) < target);
  if (m.s16(0x41e) <= 1) return;
  m.set16(0x41e, 0);
  let ticks = (timerExchange(m, m.s8(FRAME_TIMER), 0) << 16) >> 16;
  if (ticks > 0x19) ticks = 0x19;
  else if (ticks < 1) ticks = 1;
  m.set16(FRAME_STEP, Math.min(ticks * 40, 0x300));
  m.set16(0x3402, m.u16(FRAME_STEP));
  if (m.u8(0x3370)) m.set16(FRAME_STEP, m.s16(FRAME_STEP) >> 1);
  if (m.u8(0x337a)) m.set16(FRAME_STEP, 0);
}

// 0:2319 showRoomName(room): first visit (DS:3414[room] clear) of a named room (DS:355a): prints it.
export function showRoomName(m: Memory, room: number): void {
  if (m.u8(0x3414 + room) || !m.u8(0x355a)) return;
  const text = m.push(0x28);
  sprintf(m, text, 0x46c, 0x355a);
  call(m, "0:cff8", text, 6, 0x10);
  m.pop(0x28);
}

// 0:238a drawRoom(full): room palette from the DS:470/484 table (default 1, 2 above room 0x32), walls (room 0x89
// has none and uses palette 3), floor and panels; full also clears the front buffer and sets the room palette.
export function drawRoom(m: Memory, full: number): void {
  let i = 0;
  let entry: number;
  let palette = 0;
  for (;;) {
    entry = (m.u16(0x470 + i * 2) - 1) & 0xffff;
    if (entry === 0xffff) break;
    if (m.u8(ROOM) === entry) {
      palette = m.u16(0x484 + i * 2);
      break;
    }
    i++;
  }
  if (!m.u8(ROOM)) {
    setPalette(m, m.u16(0x30c2), 0, 0x100);
    m.set16(0x1994, 0);
    m.set8(0x1993, m.u8(0x1992) ? 1 : 0);
  } else {
    m.set8(0x1993, 0);
  }
  const listed = entry !== 0xffff;
  call(m, "0:c570", listed ? palette : m.u8(ROOM) > 0x32 ? 2 : 1);
  m.set16(0x3924, 0);
  call(m, "0:e2f6");
  call(m, "0:e2c0");
  call(m, "0:c174", 0);
  if (!listed || m.u8(ROOM) !== 0x89) {
    drawAllLowWalls(m);
    drawAllTallWalls(m);
  } else {
    m.set16(0x272e, 3);
  }
  call(m, "0:bfe7");
  call(m, "0:c093");
  call(m, "0:c174", 1);
  if (listed) drawTitleBar(m, 1);
  if (full & 0xff) {
    clearFront(m);
    setRoomPalette(m, m.u16(0x272e));
  }
  call(m, "0:2587");
}

function resetDemo(m: Memory): void {
  m.set16(0x1984, 0);
  m.set16(0x1982, 0);
  m.set8(0x3918, 0);
  m.set8(0x3919, 0);
  m.set8(0x391e, 0);
  m.set16(0x3920, 0);
  m.set16(0x198a, 0);
  m.set16(0x3922, 0);
}

// 0:2107 enterRoom(full): builds the current room: room timer (0xf0 ticks), objects from the room record
// (DS:3502), class 8 positions, special rooms (0x79 start, 0x8d timed, 0x89, 0), the player (0:2770 into DS:3400),
// player state saved for a restart, pending messages, demo playback/recording start (DS:1988/1989).
export function enterRoom(m: Memory, full: number): void {
  const slot = m.s8(ROOM_TIMER);
  m.set16(ROOM_CHANGE, 0);
  timerThaw(m, slot);
  timerSet(m, slot, 0xf0);
  timerEnable(m, slot, 1);
  call(m, "0:26d3");
  reset61a8(m);
  loadPanelShapes(m, m.s8(0x3375) & 0xffff);
  m.set16(0x191b, 0);
  if (full) call(m, "0:2d2e");
  drawRoom(m, full);
  call(m, "0:3056");
  spawnObjects(m, 0x3502, 1);
  collectClass8(m);
  call(m, "0:25f1");
  selectFloorPalette(m, 0);
  if (!m.u8(0x3c3) && m.u8(ROOM) === 0x79) call(m, "0:2539", 0);
  if (m.u8(ROOM) === 0x8d) {
    call(m, "0:2565");
    timerSet(m, slot, 0x12c);
    timerFreeze(m, slot);
  }
  if (m.u8(0x3c4) && m.u8(ROOM) === 0x79) {
    const obj = call(m, "0:2539", 1) & 0xffff;
    m.set8(obj + 8, 0x7b);
    m.set8(obj + 0xa, 0x89);
    updateBox(m, obj);
    m.set8(0x3c4, 0);
  }
  if (!m.u8(0x1992) && !m.u8(ROOM)) {
    m.set8(0x1992, 1);
    m.set8(0x1993, 0);
    call(m, "0:24de");
  } else if (!m.u8(0x420) && m.u8(ROOM) !== 0x8d) {
    m.set16(0x3400, call(m, "0:2770"));
  }
  savePlayerState(m);
  if (m.u8(ROOM) === 0x89) call(m, "0:2500");
  if (m.u8(0x3c1)) {
    call(m, "0:cff8", 0x421, 3, 0x5c);
    m.set8(0x3c1, 0);
  }
  if (m.u8(0x197f)) {
    call(m, "0:bfd3");
    m.set8(0x197f, 0);
  }
  m.set8(0x1987, 0);
  m.set8(0x1986, 0);
  if (m.u8(0x1988)) {
    m.set8(0x1988, 0);
    m.set8(0x1986, 1);
    resetDemo(m);
  }
  if (m.u8(0x1989)) {
    m.set8(0x1989, 0);
    m.set8(0x1987, 1);
    resetDemo(m);
  }
  call(m, "0:cd0e", m.u16(0x1980));
  if (m.u8(0x3c0)) {
    m.set8(0x3c0, 0);
    showRoomName(m, m.u8(ROOM));
  }
  if (m.u8(0x3c2)) {
    call(m, "0:cff8", 0x445, 6, 0x10);
    m.set8(0x3c2, 0);
  }
}

// Subtracts the signed word at step from the dword at counter; true when it went negative.
function countDown(m: Memory, counter: number, step: number): boolean {
  const v = ((m.u16(counter) | (m.u16(counter + 2) << 16)) - m.s16(step)) | 0;
  m.set16(counter, v & 0xffff);
  m.set16(counter + 2, v >>> 16);
  return v < 0;
}

// 0:1a9c main(argc, argv) is `init; do frame while !quit; shutdown (0:31fd)`. The port splits it into gameInit and
// gameFrame; the host calls gameFrame until it returns nonzero, then 0:31fd. Frame order (one pass of the loop):
//  1. demo/menu requests (DS:198c 0:38b0, DS:1987 0:c77b, DS:198f 0:3a71);
//  2. room change (DS:33f2): restart from the checkpoint when out of lives, 0:b7d4, clear the back buffer, 0:6b96,
//     0:354e(room), enterRoom(1), reset the frame timer, checkRoomCleared(0);
//  3. placeRespawn, 0:b662 input, clear object flag +0x35, frameSync (the wait: the frame boundary inside the body),
//     updateObjects, 0:cfa6, 0:2b75, 0:2bc1, 0:2d8d;
//  4. drawing: restoreBackgrounds, endFlash, 0:2bb9, 0:266f (objects), title bar, showDirtyRects, endFlash, CRTC
//     scripts, cyclePalette, joystick read (14c8:01e9 into DS:33fe);
//  5. timers driven by DS:3408/3402: slow motion (DS:3371), countdown (DS:3404 per 0x56400, DS:340a steps with
//     messages), panel shapes timeout (DS:3376); room timer expiry: lose a life and rebuild the room;
//  6. 0:b805 (keys, returns quit), frame counter DS:3410, demo clock DS:1982 += step while a demo runs.

// 0:1a9c (prologue) gameInit(argc, argv)
export function gameInit(m: Memory, argc: number, argv: number): void {
  resetPlayerState(m);
  m.set8(0x33ee, 0);
  m.set8(0x1968, 0);
  call(m, "0:30f8", argc, argv);
  saveRoomPosition(m);
  shuffleNames(m);
  setPalette(m, m.u16(0x21d0), 0xc0, 4);
}

// 0:1adc (loop body of 0:1a9c) gameFrame(): one frame; returns nonzero when the game should quit.
export function gameFrame(m: Memory): number {
  if (m.u8(0x198c)) {
    m.set8(0x198c, 0);
    call(m, "0:38b0");
  }
  if (m.u8(0x1987)) {
    m.set8(0x1987, 0);
    if ((call(m, "0:c77b", 0) & 0xffff) === 1 || (call(m, "0:c77b", 1) & 0xffff) === 1) m.set8(0x198f, 1);
    else m.set8(0x1987, 1);
  }
  if (m.u8(0x198f)) {
    m.set8(0x198f, 0);
    call(m, "0:3a71");
  }
  if (m.u16(ROOM_CHANGE)) {
    if (!m.u8(PLAYER_STATE)) restartFromCheckpoint(m);
    m.set16(ROOM_CHANGE, 0);
    call(m, "0:b7d4");
    clearBack(m);
    call(m, "0:6b96");
    call(m, "0:354e", m.u8(ROOM));
    enterRoom(m, 1);
    timerSet(m, m.s8(FRAME_TIMER), 0);
    checkRoomCleared(m, 0);
  }
  placeRespawn(m);
  call(m, "0:b662");
  clearObjectFlag35(m);
  frameSync(m);
  updateObjects(m);
  call(m, "0:cfa6");
  call(m, "0:2b75");
  call(m, "0:2bc1");
  call(m, "0:2d8d");
  restoreBackgrounds(m);
  endFlash(m);
  call(m, "0:2bb9");
  call(m, "0:266f");
  drawTitleBar(m, 0);
  showDirtyRects(m);
  endFlash(m);
  stepCrtcScripts(m);
  cyclePalette(m);
  m.set16(0x33fe, call(m, "14c8:01e9", 0x33fa, 0x33f6));
  if (m.u16(0x3400) && m.u8(0x3370) && countDown(m, 0x3371, 0x3402)) {
    m.set8(0x337a, 0);
    m.set8(0x3370, 0);
    call(m, "0:b5c3", 0x1bf6);
  }
  if (m.u8(0x199a) && countDown(m, 0x3404, FRAME_STEP)) {
    const v = (m.u16(0x3404) | (m.u16(0x3406) << 16)) + 0x56400;
    m.set16(0x3404, v & 0xffff);
    m.set16(0x3406, v >>> 16);
    m.set8(0x340a, m.u8(0x340a) - 1);
    if (!m.u8(0x340a)) {
      call(m, "0:cff8", 0x3c6, 4, 0x10);
      call(m, "0:3085");
      call(m, "0:b5c3", 0x1a4e);
      call(m, "0:b5c3", 0x1a76);
      call(m, "0:3ae1", 1, 0);
      m.set8(0x199a, 0);
    } else {
      const text = m.push(0x34) + 2;
      const left = m.s8(0x340a);
      sprintf(m, text, 0x3d1, left & 0xffff, left > 1 ? 0x3ff : 0x401);
      call(m, "0:cff8", text, 3, 4);
      m.pop(0x34);
    }
  }
  if (m.u16(0x3400) && m.u8(0x3375) && countDown(m, 0x3376, FRAME_STEP)) {
    m.set8(0x3375, 0);
    loadPanelShapes(m, 0);
    call(m, "0:b5c3", 0x1cf2);
  }
  if (!timerGet(m, m.s8(ROOM_TIMER))) {
    m.set16(ROOM_CHANGE, 1);
    restorePlayerState(m);
    m.set8(0x33ee, m.u8(0x340c));
    m.set8(PLAYER_STATE, m.u8(PLAYER_STATE) - 1);
    if (m.u8(PLAYER_STATE) === 1 && m.u8(0x3364) !== 0x59) {
      m.set8(0x3c1, 1);
      m.set8(0x3c5, 0);
      m.set8(0x3c4, 0);
      m.set8(0x3c3, 0);
    }
    if (m.u8(0x1987)) {
      m.set8(0x1987, 0);
      m.set8(0x198c, 1);
      call(m, "0:b748");
    }
  }
  const quit = call(m, "0:b805") & 0xffff;
  m.set16(0x3410, m.u16(0x3410) + 1);
  if (m.u8(0x1986) || m.u8(0x1987)) {
    const v = (m.u16(0x1982) | (m.u16(0x1984) << 16)) + m.s16(FRAME_STEP);
    m.set16(0x1982, v & 0xffff);
    m.set16(0x1984, v >>> 16);
  }
  return quit;
}

register("0:15a7", cyclePalette);
register("0:1e76", saveRoomPosition);
register("0:1e8d", restoreRoomPosition);
register("0:1f87", resetPlayerState);
register("0:1fa2", savePlayerState);
register("0:1fb7", saveCheckpoint);
register("0:1fcc", restorePlayerState);
register("0:1fe1", restoreCheckpoint);
register("0:1e58", restartFromCheckpoint);
register("0:1ed8", placeRespawn);
register("0:1ff6", frameSync);
register("0:2319", showRoomName);
register("0:238a", drawRoom);
register("0:2107", enterRoom);
