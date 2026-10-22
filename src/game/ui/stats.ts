import type { Game } from "../core/game.ts";
import { s8 } from "../core/int.ts";
import { showMessage, updateMessages } from "../core/messages.ts";

// printf "%Nd": right-aligned decimal in N columns.
function pad(value: number, width: number): string {
  return String(value).padStart(width, " ");
}

// h0:b830 (DOS 0:d05e) showStats(): the g:1e98 status block for six seconds at style 2, drawn at once (h0:b746).
// The bytes are sign-extended (ext.w) before formatting; the pushed bomber minutes g:d95c have no conversion.
export function statsText(game: Game): string {
  const state = game.state;
  return `  @@@Lives: ${pad(s8(state.lives), 2)}{4  @Grenades: ${pad(s8(state.ammo), 2)}{9@@Floor: ${pad(s8(state.buildingFloor), 3)}\n`
    + `Rescued: ${pad(s8(state.rescuedCount), 2)}{4 @@Sec Level: ${pad(s8(state.bombsFound), 2)}{9Scene: ${pad(state.sceneIndex + 1, 3)}`;
}

export function showStats(game: Game): void {
  showMessage(game.context, statsText(game), 6, 2);
  updateMessages(game.context, slot => game.pollTimer(slot));
}
