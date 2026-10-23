import type { Game } from "../../core/game.ts";
import { blocked, collide, findCollision } from "../../core/geometry.ts";
import { s8, u8 } from "../../core/int.ts";
import { heldDirection } from "../../core/input.ts";
import { showMessage } from "../../core/messages.ts";
import { objectRecord } from "../../actors/shared.ts";
import { drawLine, finishDelay, messageBox, restoreDisplay, startDelay } from "./box.ts";

const NOTHING = "`You have nothing to use."; // g:43c2
const PACKAGE = "The package is sealed with an electronic lock.  It is addressed to J. Derrida, Genoq Biotech, Singapore.  The return address reads Genoq Neural Research, Jyvaskyla, Finland.  No other markings are visible."; // g:43dc
const SLOT_Y = 0xaa, SLOT_COLOR = 0x95, SELECTED_COLOR = 0x67, COUNT_COLOR = 0x6c;
// g:948: x/y offsets in front of an actor per facing (h0:5518).
const AHEAD = [-6, 0, -4, 4, 0, 6, 4, 4, 6, 0, 4, -4, 0, -6, -4, -4];

// Item ids index g:85dd: bomb ("1 Bomb!" pickups, kept in `portableLaserCount`), freezer, shield, barrier ("1 Barrier!"
// pickups, kept in `carriedBombs`), the package.
function itemCount(game: Game, id: number): number {
  const s = game.state;
  const counts = [s.portableLaserCount, s.slowMotionCount, s.shieldCount, s.carriedBombs, s.inventoryAvailability];
  const count = counts[id];
  if (count === undefined) throw new Error(`AGA inventory item ${id} outside g:85dd`);
  return count;
}

// h0:126a2 listItems(): the ids with a non-zero count, 0xff terminated in g:de0d.
function listItems(game: Game): number {
  const talk = game.state.talk;
  talk.itemCount = 0;
  for (let id = 0; id < 5; id++) if (itemCount(game, id)) talk.items[talk.itemCount++] = id;
  talk.items[talk.itemCount] = 0xff;
  return talk.itemCount;
}

// h0:13f12 drawSlot(index, y, color, item): an h0:f3f0 box 22 pixels apart, the item icon (h0:13f68) and, except
// for the package, its count as one digit character.
function drawSlot(game: Game, index: number, y: number, color: number, item: number): void {
  const state = game.state, display = state.talk.display;
  const x = index * 22 + 3;
  display.push({ op: "slot", x, y, color });
  display.push({ op: "icon", item, x: x + 2, y: y + 2 });
  const count = s8(itemCount(game, item));
  if (count <= 0 || item === 4) return;
  state.textColor = COUNT_COLOR;
  drawLine(game, x + 8, y + 17, String.fromCharCode(u8(0x30 + count))); // g:43c0
}

// h0:141e4 selectItem(): a row of slots at y 0xaa; left/right move, Enter picks, Esc or U cancels (-1).
function selectItem(game: Game): number {
  const state = game.state, talk = state.talk, input = state.input;
  const savedClip = state.clipBottom;
  state.clipBottom = 199;
  let selected = 0, previous = 0, result: number;
  const frameTime = game.pollTimer(state.frameTimer);
  for (let i = 0; talk.items[i] !== 0xff; i++) drawSlot(game, i, SLOT_Y, SLOT_COLOR, talk.items[i]!); // h0:13eb2
  drawSlot(game, selected, SLOT_Y, SELECTED_COLOR, talk.items[selected]!);
  state.waitSteps = 0;
  while (game.readButton(0) < 3 || game.readButton(1) < 3) game.waitStep();
  while (game.pendingKey()) game.consumeKey();
  input.textEntry = 1;
  for (;;) {
    game.vblank(); // the harness tick at h0:14282
    if (state.demoRecording || state.demoPlayback) throw new Error("AGA inventory during demo playback (h0:1428e) not ported");
    const direction = heldDirection(input);
    if (direction !== -1) startDelay(game, 15);
    const key = game.pendingKey() ? u8(game.consumeKey()) : 0;
    if (key === 0x1b || game.readButton(0) === 2 || key === 0x55) { result = -1; break; }
    if (key === 0x0d || game.readButton(1) === 2) {
      result = selected;
      game.sound(0x13);
      break;
    }
    if (direction === -1) continue;
    if (direction === 2 && selected < talk.itemCount - 1) selected++;
    if (direction === 6 && selected > 0) selected--;
    if (selected === previous) continue;
    game.sound(0x18);
    drawSlot(game, previous, SLOT_Y, SLOT_COLOR, talk.items[previous]!);
    drawSlot(game, selected, SLOT_Y, SELECTED_COLOR, talk.items[selected]!);
    previous = selected;
    finishDelay(game);
  }
  state.waitSteps = 0;
  while (game.readButton(0) === 1 || game.readButton(1) === 1) game.waitStep();
  input.textEntry = 0;
  state.clipBottom = savedClip;
  restoreDisplay(game); // h0:e1a8(0xaa, 0)
  game.timers.set(state.frameTimer, frameTime);
  state.forceRedraw = 1;
  return result;
}

// h0:1400c (via h0:3706, key U) useItem(): pick an item and use it. In scene 133 before the generator room the
// key instead leaves through h0:7c94(0x8a).
export function useItem(game: Game): void {
  const state = game.state, ctx = game.context, player = state.player;
  if (!player || state.useDisabled) return;
  if (state.sceneIndex === 0x84 && !state.generatorOverride) {
    state.useDisabled = 1;
    game.storyTransition(0x8a); // h0:1444a -> h0:7c94
    return;
  }
  game.sound(0x13);
  if (!listItems(game)) {
    showMessage(ctx, NOTHING, 3, 2); // h0:14474
    return;
  }
  const selected = selectItem(game);
  if (selected === -1) return;
  const id = state.talk.items[selected]!;
  if (id === 3 && state.carriedBombs) {
    // h0:14468 -> h0:5518(facing, 0x85): a barrier record in front of the player, owned by him while it is placed.
    state.currentObject = player;
    const facing = s8(player.facing);
    const barrier = game.objects.spawn(objectRecord(u8((facing << 4) | 0x85), (player.x >>> 8) + AHEAD[facing * 2 + 1]!, (player.y >>> 8) + AHEAD[facing * 2]!, facing));
    state.spawned = barrier;
    if (barrier) {
      barrier.ownerId = player.id;
      const other = findCollision(ctx, barrier);
      if (other) {
        collide(ctx, barrier, 0x60 + other.classId, other); // h0:144a4 -> h0:a2f8
        state.carriedBombs = u8(state.carriedBombs - 1);
      } else if (blocked(ctx, barrier)) {
        game.objects.remove(barrier); // h0:1445c -> h0:16ba
        game.sound(2);
      } else {
        barrier.ownerId = 0xffff;
        game.sound(1);
        state.carriedBombs = u8(state.carriedBombs - 1);
      }
    }
  }
  if (id === 2 && state.shieldCount) {
    // The h3 pointer writes and h0:6a0(1) switch the player to the SHPLY bank, which renders from `invulnerable`.
    state.invulnerable = 1;
    state.invulnerabilityTime = 0x12c00;
    state.shieldCount = u8(state.shieldCount - 1);
  }
  if (id === 1 && state.slowMotionCount) {
    state.paused = state.slowMotion = 1;
    state.slowMotionTime = 0xc800;
    state.slowMotionCount = u8(state.slowMotionCount - 1);
    game.sound(0x0d);
  }
  if (id === 0 && state.portableLaserCount) {
    // h0:1448c -> h0:1878: an ART record (class 11, kind 7) at the player.
    if (game.objects.spawn(objectRecord(0x0b, player.x >>> 8, player.y >>> 8, 7))) state.portableLaserCount = u8(state.portableLaserCount - 1);
  }
  if (id === 4) messageBox(game, PACKAGE, 0, 0, 1, 1); // h0:14492
}
