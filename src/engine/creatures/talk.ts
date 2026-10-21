import { resetAttackTimer } from "./chase.ts";
import { register } from "../dispatch.ts";
import type { Memory } from "../memory.ts";
import { setMessage, messageBox } from "../misc/hud.ts";
import {
  applyCountCodes,
  applyFlagCodes,
  buildVisibleItems,
  findTalker,
  MENU_STACK,
  MENU_TABLE,
  menuSelect,
  PLAYER_STATE,
  popEmptyMenus,
  VISIBLE_COUNT,
} from "../misc/menu.ts";
import { fn_0_b4d2 } from "../misc/room.ts";
import { PLAYER, SCENE } from "../props/common.ts";
import { sprintf } from "../runtime.ts";

// Conversation with a survivor (class 9): DS:6e96 is the talker, +0xa6 its menu table, +0xb2 the current menu,
// +0xb5 the answers it still gives, +0xb6/+0xb8 the 32 bits of menus already answered, +0xa0 its patience.

function popMenu(m: Memory): void {
  m.set16(MENU_STACK, m.u16(MENU_STACK) - 1);
  m.set16(m.u16(PLAYER_STATE) + 0xb2, m.u16((MENU_STACK + m.u16(MENU_STACK) * 2) & 0xffff));
}

// 0:a3ee talk(): one menu of the conversation with the survivor listening to topic 0x19; 1 while it goes on.
export function talk(m: Memory): number {
  if (m.u16(PLAYER) === 0) return 0;
  const who = findTalker(m, 0x19);
  m.set16(PLAYER_STATE, who);
  if (who === 0) {
    setMessage(m, m.u8(0x6e9b) !== 0 ? 0x165b : 0x1685, 3, 0x10);
    return 0;
  }
  if (m.u8(who + 0x8c) !== 0 || (m.u8(who + 0x8b) === 0 && m.u8(who + 0xa8) === 0)) return 0;
  if (m.u8(who + 0xb5) === 0) {
    resetAttackTimer(m, who);
    return 0;
  }
  const talker = (): number => m.u16(PLAYER_STATE);
  m.set16(MENU_TABLE, m.u16(talker() + 0xa6));
  buildVisibleItems(m, m.u16(talker() + 0xb2));
  if (m.u8(VISIBLE_COUNT) === 0) {
    if (m.u16(talker() + 0xb2) === 0) {
      m.set16(talker() + 0xb2, m.u16(talker() + 0xb2) + 1);
      buildVisibleItems(m, 1);
    } else {
      popMenu(m);
      popEmptyMenus(m);
    }
  }
  const sel = menuSelect(m, m.u16(talker() + 0xb2));
  if (fn_0_b4d2(m) !== 0) {
    messageBox(m, 0x15eb, 0x83, 0, 1);
    m.set16(talker() + 0xb2, 0);
    return 0;
  }
  if (sel === 0) {
    if (m.u16(MENU_STACK) === 0) {
      m.set16(talker() + 0xb2, 0);
      return 0;
    }
    popMenu(m);
    return 1;
  }
  m.set16(talker() + 0xb2, sel);
  m.set16((MENU_STACK + 2 + m.u16(MENU_STACK) * 2) & 0xffff, sel);
  m.set16(MENU_STACK, m.u16(MENU_STACK) + 1);
  if (m.u8(SCENE) === 0x53 && m.u16(talker() + 0xb2) === 2) {
    const buf = m.push(0x4a);
    sprintf(m, buf, 0x1612, m.u16((0x8ba + m.s8(0x6224) * 2) & 0xffff));
    messageBox(m, buf, 0x83, 0, 1);
    m.pop(0x4a);
    return 1;
  }
  const entry = (m.u16(MENU_TABLE) + sel * 12 + 0xc) & 0xffff;
  let skip = applyCountCodes(m, m.u16(entry));
  const flags = applyFlagCodes(m, m.u16(entry));
  if (flags > skip) skip = flags;
  m.set8(talker() + 0xb5, m.u8(talker() + 0xb5) - 1);
  const lo = sel < 16 ? 1 << sel : 0;
  const hi = sel >= 16 && sel < 32 ? 1 << (sel - 16) : 0;
  if (m.u8(talker() + 0xa0) < 0x14 && ((m.u16(talker() + 0xb8) & hi) !== 0 || (m.u16(talker() + 0xb6) & lo) !== 0)) {
    messageBox(m, 0x1642, 0x83, 0, 1);
    return 1;
  }
  m.set16(talker() + 0xb6, m.u16(talker() + 0xb6) | lo);
  m.set16(talker() + 0xb8, m.u16(talker() + 0xb8) | hi);
  const text = (m.u16((m.u16(MENU_TABLE) + sel * 12 + 0xc) & 0xffff) + skip) & 0xffff;
  return messageBox(m, text, 0x83, 0, 1) !== 0 ? 1 : 0;
}

register("0:a3ee", talk);
