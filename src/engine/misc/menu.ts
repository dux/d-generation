import { call, register } from "../dispatch.ts";
import { drawBox, drawTallBox, drawText, drawToPanel, restoreDrawTarget } from "../geometry/draw.ts";
import { blit } from "../geometry/room.ts";
import { forEachObject } from "../core/objects.ts";
import type { Memory } from "../memory.ts";
import { farBuffer, strlen } from "../runtime.ts";

// Menus: DS:6e98 points at the menu table (12 bytes per menu at +0xe: up to 6 item pointers). An item is a
// pointer to a word list: label string, then option strings. Labels starting with '#' or '~' plus a digit are
// conditional on the inventory flags (DS:6e96 + 0xb4) masked with DS:15b4[digit].
export const MENU_TABLE = 0x6e98;
export const PLAYER_STATE = 0x6e96;
export const VISIBLE_COUNT = 0x6e9a;
// Visible item indices of the current menu, 0xff-terminated.
export const VISIBLE_ITEMS = 0x6e9c;
// Inventory counters (4 bytes) changed by '_' codes.
export const ITEM_COUNTS = 0x336b;
export const MENU_STACK = 0x3954;

function menuItem(m: Memory, menu: number, item: number): number {
  return m.u16((m.u16(MENU_TABLE) + menu * 12 + item * 2 + 0xe) & 0xffff);
}

// 0:a6a9 buildVisibleItems(menu): list the items of a menu whose condition holds; returns their count.
export function buildVisibleItems(m: Memory, menu: number): number {
  m.set8(VISIBLE_COUNT, 0);
  const flags = m.s8(m.u16(PLAYER_STATE) + 0xb4);
  for (let i = 0; i < 5; i++) {
    const label = m.u16(menuItem(m, menu, i));
    if (label === 0) continue;
    const c = m.u8(label);
    let show = true;
    if (c === 0x23) show = (m.s8(0x15b4 + m.s8(label + 1)) & flags) === 0;
    else if (c === 0x7e) show = (m.s8(0x15b4 + m.s8(label + 1)) & flags) !== 0;
    if (show) {
      const n = m.u8(VISIBLE_COUNT);
      m.set8(VISIBLE_COUNT, n + 1);
      m.set8((VISIBLE_ITEMS + ((n << 24) >> 24)) & 0xffff, i);
    }
  }
  const n = m.s8(VISIBLE_COUNT);
  m.set8((VISIBLE_ITEMS + n) & 0xffff, 0xff);
  return n & 0xffff;
}

// 0:a790 applyCountCodes(str): '_' kd codes add d to counter k (DS:336b..336e); returns index after the last code.
export function applyCountCodes(m: Memory, str: number): number {
  let result = 0;
  for (let si = 0; strlen(m, str) > si; si++) {
    if (m.u8(str + si) !== 0x5f) continue;
    si++;
    const k = (m.u8(str + si) + 0xd0) & 0xff;
    si++;
    const d = (m.u8(str + si) + 0xd0) & 0xff;
    result = (si + 1) & 0xffff;
    const ks = (k << 24) >> 24;
    if (ks >= 0 && ks <= 3) m.set8(ITEM_COUNTS + ks, m.u8(ITEM_COUNTS + ks) + d);
  }
  return result;
}

// 0:a819 applyFlagCodes(str): '~d' sets, '#d' clears flag DS:15e4[d] in player +0xb4; '&d' lowers player +0xb5 by d.
export function applyFlagCodes(m: Memory, str: number): number {
  let result = 0;
  const p = m.u16(PLAYER_STATE);
  for (let si = 0; strlen(m, str) > si; si++) {
    const c = m.u8(str + si);
    if (c === 0x7e) {
      si++;
      const d = ((m.u8(str + si) + 0xd0) << 24) >> 24;
      m.set8(p + 0xb4, m.u8(p + 0xb4) | m.u8((0x15e4 + d) & 0xffff));
      result = (si + 1) & 0xffff;
    } else if (c === 0x23) {
      si++;
      const d = ((m.u8(str + si) + 0xd0) << 24) >> 24;
      m.set8(p + 0xb4, m.s8(p + 0xb4) & (m.s8((0x15e4 + d) & 0xffff) ^ 0xff));
      result = (si + 1) & 0xffff;
    } else if (c === 0x26) {
      si++;
      const d = (m.s8(str + si) - 0x30) & 0xffff;
      m.set8(p + 0xb5, m.s8(p + 0xb5) - d);
      if (m.s8(p + 0xb5) < 0) m.set8(p + 0xb5, 0);
      result = (si + 1) & 0xffff;
    }
  }
  return result;
}

// 0:a8e2 popEmptyMenus(): pop the menu stack while the current menu has fewer than 2 visible items.
export function popEmptyMenus(m: Memory): void {
  while (m.s16(MENU_STACK) >= 0) {
    if (m.s16(buildVisibleItems(m, m.u16((MENU_STACK + m.u16(MENU_STACK) * 2) & 0xffff))) >= 2) break;
    m.set16(MENU_STACK, m.u16(MENU_STACK) - 1);
    m.set16(m.u16(PLAYER_STATE) + 0xb2, m.u16((MENU_STACK + m.u16(MENU_STACK) * 2) & 0xffff));
  }
  if (m.s16(MENU_STACK) < 0) {
    m.set16(m.u16(PLAYER_STATE) + 0xb2, 0);
    m.set16(MENU_STACK, 0);
  }
  if (m.u8(VISIBLE_COUNT) === 0 && m.u16(m.u16(PLAYER_STATE) + 0xb2) === 0) {
    m.set16(m.u16(PLAYER_STATE) + 0xb2, 1);
    buildVisibleItems(m, 1);
  }
}

// 0:ad5a optionCount(menu, item): number of option strings (up to 6) of a menu item.
export function optionCount(m: Memory, menu: number, item: number): number {
  const list = menuItem(m, menu, item);
  let n = 0;
  while (n < 6 && m.u16((list + n * 2 + 0xe) & 0xffff) !== 0) n++;
  return n;
}

// 0:adf7 drawMenuItem(menu, row, x, y, width, color, option): boxed row with its label (shadowed) and option,
// or '...' (DS:16ae) when option is -1 and the item has more than one option.
export function drawMenuItem(m: Memory, menu: number, row: number, x: number, y: number, width: number, color: number,
  option: number): void {
  const a = (menu << 24) >> 24;
  const r = (row << 24) >> 24;
  drawBox(m, x, (r * 13 + y) & 0xffff, width, (color << 24) >> 24 & 0xffff);
  const item = m.s8((VISIBLE_ITEMS + r) & 0xffff);
  const list = menuItem(m, a, item);
  const sel = (option << 24) >> 24;
  for (let i = 0; i < 2; i++) {
    let label = m.u16(list);
    if (m.u8(label) === 0x7e || m.u8(label) === 0x23) label = (label + 2) & 0xffff;
    m.set8(0x6225, m.u8(0x1ff8 + i));
    const ty = (r * 13 + y + 3 - i) & 0xffff;
    let tx = drawTextAtPos(m, (x + 8 - i) & 0xffff, ty, label, (1 - i) & 0xffff);
    if ((option & 0xff) === 0xff) {
      if (m.s16(optionCount(m, a, item)) > 1) drawTextAtPos(m, tx, ty, 0x16ae, (1 - i) & 0xffff);
    } else {
      tx = (tx + 5) & 0xffff;
      drawTextAtPos(m, tx, ty, m.u16((list + sel * 2 + 2) & 0xffff), (1 - i) & 0xffff);
    }
  }
}

function drawTextAtPos(m: Memory, x: number, y: number, str: number, skipColors: number): number {
  const pos = m.push(4);
  m.set16(pos, x);
  m.set16(pos + 2, y);
  const r = drawText(m, pos, str, skipColors);
  m.pop(4);
  return r;
}

// 0:ada4 drawMenuRows(menu, x, y, width, color): draw every visible row of a menu into the buffer DS:309e.
export function drawMenuRows(m: Memory, menu: number, x: number, y: number, width: number, color: number): void {
  const saved = m.u16(0x3a7e);
  m.set16(0x3a7e, m.u16(0x309e));
  for (let i = 0; i < m.s8(VISIBLE_COUNT); i++) {
    drawMenuItem(m, ((menu << 24) >> 24) & 0xffff, i, x, y & 0xff, width, ((color << 24) >> 24) & 0xffff, 0xffff);
  }
  m.set16(0x3a7e, saved);
}

// 0:af60 drawInventory(y, color): one icon box per entry of the 0xff-terminated list DS:6ea6.
export function drawInventory(m: Memory, y: number, color: number): void {
  const yy = y & 0xff;
  const saved = m.u16(0x3a7e);
  m.set16(0x3a7e, m.u16(0x309e));
  for (let i = 0; ; i++) {
    const v = m.u8(0x6ea6 + i);
    if (v === 0xff) break;
    drawInventoryBox(m, i, yy, ((color << 24) >> 24) & 0xffff, ((v << 24) >> 24) & 0xffff);
  }
  m.set16(0x3a7e, saved);
}

// 0:afaf drawInventoryBox(slot, y, color, item): tall box at x = 46 slot + 3 with the item icon.
export function drawInventoryBox(m: Memory, slot: number, y: number, color: number, item: number): void {
  const x = (slot * 46 + 3) & 0xffff;
  drawTallBox(m, x, y, 0x14, color);
  drawItemIcon(m, item, (x + 2) & 0xffff, (y + 2) & 0xffff);
}

// 0:b043 drawItemIcon(item, x, y): icon frame from the bank at DS:2ebc on the panel layer, count digit if > 0.
export function drawItemIcon(m: Memory, item: number, x: number, y: number): void {
  drawToPanel(m);
  const bank = m.u16(0x2ebc);
  const ptr = farBuffer(m, m.u16((bank + item * 2 + 2) & 0xffff));
  const off = ptr & 0xffff;
  const seg = ptr >>> 16;
  m.set16(0x6122, seg);
  m.set16(0x6120, off);
  const dx = m.farU8(seg, off);
  const dy = m.farU8(seg, off + 1);
  blit(m, (dx + x + 1) & 0xffff, (dy + y) & 0xffff, (off + 2) & 0xffff, seg, 0, 0, 0);
  restoreDrawTarget(m);
  const count = m.s8((item + ITEM_COUNTS) & 0xffff);
  if (count > 0) {
    const s = m.push(2);
    m.set8(s, count + 0x30);
    m.set8(s + 1, 0);
    drawTextAtPos(m, (x + 6) & 0xffff, (y + 0xf) & 0xffff, s, 0);
    m.pop(2);
  }
}

register("0:a6a9", buildVisibleItems);
register("0:a790", applyCountCodes);
register("0:a819", applyFlagCodes);
register("0:a8e2", popEmptyMenus);
register("0:ad5a", optionCount);
register("0:adf7", drawMenuItem);
register("0:ada4", drawMenuRows);
register("0:af60", drawInventory);
register("0:afaf", drawInventoryBox);
register("0:b043", drawItemIcon);

// 0:bdec saveSettings(): write DS:34aa (6 bytes) and DS:34cb (25 bytes) to the file named from format DS:1f09.
export function saveSettings(m: Memory): void {
  transferFile(m, 0x1f09, m.u16(0x19a2), 0x1f0f, "0:f23b", [[0x34aa, 6, 1], [0x34cb, 0x19, 1]]);
}

// 0:be50 loadSettings(): read back what saveSettings wrote (format DS:1f11).
export function loadSettings(m: Memory): void {
  transferFile(m, 0x1f11, m.u16(0x19a2), 0x1f17, "0:e7b1", [[0x34aa, 6, 1], [0x34cb, 0x19, 1]]);
}

// 0:beb4 saveGame(slot): write DS:623c (500 x 6) and DS:8556 (900 x 5); prints DS:1f29 when the file can't be opened.
export function saveGame(m: Memory, slot: number): void {
  if (!transferFile(m, 0x1f19, slot, 0x1f27, "0:f23b", [[0x623c, 6, 0x1f4], [0x8556, 5, 0x384]])) {
    call(m, "0:f27d", 0x1f29);
  }
}

// 0:bf21 loadGame(slot): read back what saveGame wrote.
export function loadGame(m: Memory, slot: number): void {
  transferFile(m, 0x1f3e, slot, 0x1f4c, "0:e7b1", [[0x623c, 6, 0x1f4], [0x8556, 5, 0x384]]);
}

function transferFile(m: Memory, format: number, arg: number, mode: number, io: string, blocks: number[][]): boolean {
  const name = m.push(0x20);
  call(m, "0:ef18", name, format, m.u16(0x199b), arg);
  const f = call(m, "0:f1b3", name, mode);
  if (f !== 0) {
    for (const [buf, size, count] of blocks) call(m, io, buf, size, count, f);
    call(m, "0:f326", f);
  }
  m.pop(0x20);
  return f !== 0;
}

// 0:bf84 printFreeMemory(): DOS 48h with BX=ffff, prints the largest free block in bytes (format DS:1f4e).
export function printFreeMemory(m: Memory): void {
  const regs = m.push(0x24);
  const inr = regs + 0x10;
  m.set16(inr, 0x4800);
  m.set16(inr + 2, 0xffff);
  call(m, "0:f04e", 0x21, inr, regs);
  const paras = m.u16(regs + 2);
  call(m, "0:f27d", 0x1f4e, (paras << 4) & 0xffff, paras >>> 12);
  m.pop(0x24);
}

register("0:bdec", saveSettings);
register("0:be50", loadSettings);
register("0:beb4", saveGame);
register("0:bf21", loadGame);
register("0:bf84", printFreeMemory);

// 0:b805 handleKey(): one pending key (or the pause request DS:1e56): debug/cheat keys, pause menu, save/load;
// other keys go to DS:397f with DS:6133 = 1. Returns 1 for ctrl-Q.
export function handleKey(m: Memory): number {
  let result = 0;
  if (call(m, "0:e732") === 0xffff && m.u8(0x1e56) === 0) return 0;
  let key = call(m, "0:e719");
  m.set8(0x6133, 0);
  if (((key << 16) >> 16) >= 0x61 && ((key << 16) >> 16) <= 0x7a) key = (key - 0x20) & 0xffff;
  if (key === 0x55) call(m, "0:b0f3");
  if (key === 0x13) {
    if (m.u16(0x19ec) !== 0) m.set16(0x19ec, 0);
    else {
      m.set16(0x19ec, 1);
      call(m, "0:b7d4");
      call(m, "0:b748");
    }
  } else if (m.u8(0x1987) !== 0) {
    m.set8(0x198f, 1);
    return 0;
  } else if (key === 0xac) printFreeMemory(m);
  else if (key === 0x9f) {
    saveSettings(m);
    call(m, "0:cff8", 0x1e5a, 3, 0x10);
  } else if (key === 0x98) {
    loadSettings(m);
    m.set16(0x33f2, 1);
    call(m, "0:1e58");
    m.set8(0x3c2, 1);
  }
  if (key & 0x80) {
    if (key === 0xa5) call(m, "14c8:02df");
    else if (key === 0xad) call(m, "14c8:032a");
    else if (key === 0x94) {
      const room = m.u16(0x3400);
      call(m, "0:f27d", 0x1e79, m.u8(room + 8), m.u8(room + 0xa));
    } else if (key === 0xae) debugWarp(m);
    return result;
  }
  if (key === 0x1b || m.u8(0x1e56) !== 0) {
    call(m, "0:cff8", 0x1e9c, 1, 0x5c);
    call(m, "0:cfa6");
    m.set8(0x1e56, call(m, "0:bc9d") === 0x1b ? 1 : 0);
  } else if (key === 1) {
    m.set16(0x33f2, 1);
    m.set8(0x33ee, m.u8(0x340c));
    call(m, "0:1fcc");
    m.set8(0x3362, m.u8(0x3362) - 1);
  } else if (key === 2) {
    for (let row = 0; row < 0x27; row++) {
      call(m, "0:f27d", 0x1ebc);
      for (let col = 0; col < 0xb; col++) {
        const v = m.u8(0x5f72 + row * 11 + col);
        if (v === 0xff) call(m, "0:f27d", 0x1ebe);
        else call(m, "0:f27d", 0x1ec4, v + 1);
      }
    }
  } else if (key === 0x53) call(m, "0:d05e");
  else if (key === 0x16) call(m, "0:bfd3");
  else if (key === 0xa) call(m, "fff:0de9");
  else if (key === 9) {
    m.set8(0x3362, m.u8(0x3362) + 0xa);
    m.set8(0x34b2, m.u8(0x34b2) + 0xa);
  } else if (key === 3) {
    const n = m.push(2);
    call(m, "0:f27d", 0x1eca);
    call(m, "0:e802", 0x1ed9, 0x61d4);
    call(m, "0:ea58", 0x61d4, 0x1edc, n);
    call(m, "23ac:003b", m.u16((0x21cc + m.u16(n) * 2) & 0xffff), 0xc0, 4);
    m.pop(2);
  } else if (key === 7) {
    for (const [a, d] of [[0x3365, 10], [0x34b5, 10], [0x34ce, 10], [0x336b, 5], [0x336c, 5], [0x336d, 5], [0x336e, 5]]) {
      m.set8(a, m.u8(a) + d);
    }
  } else if (key === 0xd) {
    m.set8(0x1997, 1);
    while (call(m, "0:a3ee") !== 0);
    m.set8(0x1997, 0);
  } else if (key === 0xb) {
    m.set8(0x3367, 0xa);
    m.set8(0x34b7, 0xa);
    m.set8(0x34d0, 0xa);
  } else if (key === 4) {
    m.set8(0x1989, 1);
    m.set8(0x1987, 0);
    m.set8(0x1986, 0);
    m.set16(0x33f2, 1);
    call(m, "0:1fcc");
    loadGame(m, 0);
  } else if (key === 0xf) {
    m.set8(0x1986, 0);
    m.set8(0x1987, 0);
    m.set8(0x1988, 1);
    m.set16(0x33f2, 1);
    call(m, "0:1fcc");
  } else if (key === 0x17) {
    call(m, "0:f27d", 0x1edf);
    m.set8(0x1986, 0);
    let entry = (m.u16(0x198a) * 6) & 0xffff;
    m.set8(entry + 0x6240, 0x64);
    m.set16(entry + 0x623e, m.u16(0x1984));
    m.set16(entry + 0x623c, m.u16(0x1982));
    const t = (m.u16(0x1982) + (m.u16(0x1984) << 16) + 0x2710) >>> 0;
    m.set16(0x198a, m.u16(0x198a) + 1);
    entry = (m.u16(0x198a) * 6) & 0xffff;
    m.set16(entry + 0x623e, t >>> 16);
    m.set16(entry + 0x623c, t & 0xffff);
    const rec = (m.u16(0x3920) * 5) & 0xffff;
    m.set16(rec - 0x7aa8, t >>> 16);
    m.set16(rec - 0x7aaa, t & 0xffff);
    call(m, "0:f27d", 0x1eea, m.u16(0x198a), m.u16(0x3920));
    saveGame(m, 0);
  } else if (key === 0x11) {
    result = 1;
    call(m, "0:b748");
  } else {
    m.set8(0x397f, key);
    m.set8(0x6133, 1);
  }
  return result;
}

// Debug key 0xae: read a room number and an entry from the console and warp there.
function debugWarp(m: Memory): void {
  const locals = m.push(8);
  const room = locals;
  const entry = locals + 2;
  const x = locals + 4;
  const y = locals + 6;
  call(m, "0:f27d", 0x1e81);
  call(m, "0:e802", 0x1e89, 0x61d4);
  call(m, "0:ea58", 0x61d4, 0x1e8c, room);
  call(m, "0:f27d", 0x1e8f);
  call(m, "0:e802", 0x1e96, 0x61d4);
  call(m, "0:ea58", 0x61d4, 0x1e99, entry);
  if (m.s16(room) > 0x82) {
    m.set8(0x3362, 1);
    m.set8(0x3364, 0x59);
  }
  m.set16(room, m.u16(room) - 1);
  if (m.s16(room) < 0x96 && call(m, "0:bd8c", m.u16(room), x, y) !== 0) {
    m.set8(0x337c, m.u8(x));
    m.set8(0x337d, m.u8(y));
    m.set8(0x337e, m.u8(room));
    m.set8(0x3381, m.u8(entry));
    m.set16(0x33f2, 1);
    m.set8(0x3368, 0);
    m.set8(0x1968, 0);
  }
  m.pop(8);
}

register("0:b805", handleKey);

interface DialogState {
  buffer: number;
  scene: number;
  target: number;
  timer: number;
}

// Shared by the menu and inventory dialogs: draw into the back buffer, freeze the game timer DS:33f4.
function openDialog(m: Memory): DialogState {
  const buffer = m.u16(0x27cc);
  if (m.u16(0x2f0a) === 0) m.set16(0x27cc, m.u16(0x27ca));
  const scene = m.u16(0x282b);
  m.set16(0x282b, m.u16(0x2829));
  const target = m.u16(0x3a7e);
  m.set16(0x3a7e, m.u16(0x309e));
  const timer = call(m, "0:e55a", m.s8(0x33f4) & 0xffff);
  return { buffer, scene, target, timer };
}

function closeDialog(m: Memory, s: DialogState, y: number): void {
  m.set16(0x1998, 0);
  while (call(m, "0:c77b", 0) === 1 || call(m, "0:c77b", 1) === 1) call(m, "0:bd5c");
  call(m, "0:b662");
  m.set16(0x3a7e, s.target);
  call(m, "0:cd0e", y);
  m.set16(0x27cc, s.buffer);
  m.set16(0x282b, s.scene);
  call(m, "0:e4c6", m.s8(0x33f4) & 0xffff, s.timer);
  m.set8(0x1996, 1);
}

function waitButtonsReleased(m: Memory): void {
  m.set16(0x1998, 0);
  while (((call(m, "0:c77b", 0) << 16) >> 16) < 3 || ((call(m, "0:c77b", 1) << 16) >> 16) < 3) call(m, "0:bd5c");
}

// One poll of the dialog loop: play time keeps counting in timed modes; returns the direction (0xff none)
// and the key typed (0 none).
function pollDialog(m: Memory, keyClick: number): { dir: number; key: number } {
  if (m.u8(0x1986) !== 0 || m.u8(0x1987) !== 0) {
    const n = m.u16(0x1998);
    m.set16(0x1998, n + 1);
    if (n === 0x19) {
      call(m, "0:1ff6");
      m.set16(0x1998, 0);
      const t = (m.u16(0x1982) + m.u16(0x1984) * 0x10000 + m.s16(0x3408)) >>> 0;
      m.set16(0x1982, t & 0xffff);
      m.set16(0x1984, t >>> 16);
    }
  }
  call(m, "0:b662");
  m.set16(0x33fe, call(m, "14c8:01e9", 0x33fa, 0x33f6));
  let dir = call(m, "fff:0b90") & 0xff;
  if (dir !== 0xff) call(m, "0:d3ee", keyClick);
  else {
    dir = call(m, "fff:1dc0") & 0xff;
    if (m.s16(0x612e) < 0x1f) dir = 0xff;
    else if (dir !== 0xff) call(m, "0:d3ee", 0x14);
  }
  const key = call(m, "0:e732") !== 0xffff ? call(m, "0:e719") & 0xff : 0;
  return { dir, key };
}

function waitFrameTimer(m: Memory): void {
  while (call(m, "0:e55a", m.s8(0x5f62) & 0xffff) !== 0);
}

// 0:a9bc menuSelect(menu): modal menu at the bottom of the screen; up/down picks a row, left/right its option.
// Returns the chosen value (item word list +0xe + option), 0 when cancelled.
export function menuSelect(m: Memory, menu: number): number {
  const width = 0x122;
  let result = 0;
  const y = (0xc7 - m.s8(VISIBLE_COUNT) * 13) & 0xffff;
  const x = 3;
  const s = openDialog(m);
  let row = 0;
  let prev = 0;
  let changed = false;
  let opt = -1;
  const draw = (r: number, color: number, o: number) =>
    drawMenuItem(m, menu, r, x, y, width, color, o & 0xffff);
  drawMenuRows(m, menu, x, y, width, 0x95);
  draw(row, 0x94, -1);
  let count = (optionCount(m, menu, m.s8(VISIBLE_ITEMS + row) & 0xffff) << 24) >> 24;
  waitButtonsReleased(m);
  for (;;) {
    const { dir, key } = pollDialog(m, 0xa);
    if (key === 0x1b || call(m, "0:c77b", 0) === 2) break;
    if (key === 0xd || call(m, "0:c77b", 1) === 2) {
      if (opt === -1) {
        if (count > 1) break;
        opt = 0;
      }
      const list = menuItem(m, menu, m.s8(VISIBLE_ITEMS + row));
      result = m.u16((list + opt * 2 + 0xe) & 0xffff);
      call(m, "0:b5c3", 0x1c3e);
      break;
    }
    if (dir === 0xff) continue;
    if (dir === 2 && count > 1 && opt < count - 1) {
      opt++;
      changed = true;
    }
    if (dir === 6 && count > 1 && opt > 0) {
      opt--;
      changed = true;
    }
    if (dir === 0 && row !== 0) {
      row--;
      call(m, "0:b5c3", 0x1c46);
    }
    if (dir === 4 && row !== m.s8(VISIBLE_COUNT) - 1) {
      row++;
      call(m, "0:b5c3", 0x1c46);
    }
    if (changed) {
      call(m, "0:b5c3", 0x1c46);
      draw(row, 0x94, opt);
      waitFrameTimer(m);
      changed = false;
    } else if (row !== prev) {
      count = (optionCount(m, menu, m.s8(VISIBLE_ITEMS + row) & 0xffff) << 24) >> 24;
      opt = -1;
      draw(prev, 0x95, -1);
      draw(row, 0x94, opt);
      prev = row;
      waitFrameTimer(m);
    }
  }
  closeDialog(m, s, y);
  return result;
}

// 0:b280 inventorySelect(): modal row of item boxes; returns the chosen slot, -1 when cancelled.
export function inventorySelect(m: Memory): number {
  const y = 0xaa;
  let result: number;
  const s = openDialog(m);
  let sel = 0;
  let prev = 0;
  drawInventory(m, y, 0x95);
  drawInventoryBox(m, sel, y, 0x67, m.s8(0x6ea6 + sel) & 0xffff);
  waitButtonsReleased(m);
  for (;;) {
    const { dir, key } = pollDialog(m, 0xf);
    if (key === 0x1b || call(m, "0:c77b", 0) === 2) {
      result = 0xffff;
      break;
    }
    if (key === 0xd || call(m, "0:c77b", 1) === 2) {
      result = sel;
      call(m, "0:b5c3", 0x1c3e);
      break;
    }
    if (dir === 0xff) continue;
    if (dir === 2 && sel < m.s8(0x6eac) - 1) sel++;
    if (dir === 6 && sel > 0) sel--;
    if (sel !== prev) {
      call(m, "0:b5c3", 0x1c46);
      drawInventoryBox(m, prev, y, 0x95, m.s8(0x6ea6 + prev) & 0xffff);
      drawInventoryBox(m, sel, y, 0x67, m.s8(0x6ea6 + sel) & 0xffff);
      prev = sel;
      waitFrameTimer(m);
    }
  }
  closeDialog(m, s, y);
  return result;
}

register("0:a9bc", menuSelect);
register("0:b280", inventorySelect);

// 0:a94e findTalker(topic): first class-9 object (DS:6e9b set if any) whose list at +0xa6 holds the topic
// (0:4027(obj, topic, 4) != -1); stored in DS:6ea4 and returned (0 when none).
export function findTalker(m: Memory, topic: number): number {
  m.set16(0x6ea2, topic);
  m.set8(0x6e9b, 0);
  m.set16(0x6ea4, 0);
  m.set16(0x34b0, m.u16(0x3400));
  if (m.u16(0x3400) !== 0) forEachObject(m, 0xa97e);
  return m.u16(0x6ea4);
}

// 0:a97e findTalker callback(obj).
export function findTalkerVisit(m: Memory, obj: number): number {
  if (m.u8(obj + 2) !== 9) return 0;
  m.set8(0x6e9b, 1);
  if (m.u16(obj + 0xa6) === 0 || call(m, "0:4027", obj, m.u16(0x6ea2), 4) === 0xffff) return 0;
  m.set16(0x6ea4, obj);
  return 1;
}

register("0:a94e", findTalker);
register("0:a97e", findTalkerVisit);
