import type { Actor, ActorClass, ActorContext } from "../core/model.ts";
import { s8, s16, u8, u16 } from "../core/int.ts";
import { countDown, drawPart, objectRecord, spawnRemains } from "./shared.ts";
import { flash } from "./cgen.ts";

// Class 16, ELC: the sparking body left when a floor panel electrocutes the player or a survivor (h0:52fa).
// AGA +9a lifetime, +9e class of the victim (0, the player, also flashes the screen), +9f colour scheme of the
// extra spark part, +a0 zap timer. `elcFlickerScheme` is the scheme h0:8afc draws the body with this pass.
export interface ElcActor extends Actor {
  elcTime: number;
  elcVictimClass: number;
  elcSparkScheme: number;
  elcZapTime: number;
  elcFlickerScheme: number;
}

const SEQUENCE = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 255]; // g:3f06
const SPARKS = [0, 0, 1, 0, 0, 2, 3, 4, 0, 1]; // g:3f11: 0 = none, else the spark part's scheme / 4 + 1

// h0:524a case 14 -> h0:52fa: the victim's record 80 x y becomes an ELC with the victim's colours.
export function spawnElectricDeath(ctx: ActorContext, victim: Actor): void {
  const elc = ctx.objects.spawn(objectRecord(0x80, victim.x >>> 8, victim.y >>> 8, 0)) as ElcActor | null;
  if (!elc) throw new Error("AGA h0:52fa writes the ELC it could not create");
  elc.spriteScheme = victim.spriteScheme;
  elc.elcVictimClass = victim.classId;
}

export const elcClass: ActorClass<ElcActor> = {
  id: 16,
  name: "elc",
  createState: () => ({ elcTime: 0, elcVictimClass: 0, elcSparkScheme: 0, elcZapTime: 0, elcFlickerScheme: 0 }),
  // h0:8a28 (DOS 0:8088) init(record, object): the record byte 3 is not read.
  init(_ctx, a) {
    a.elcTime = 0x3200;
  },
  // h0:8a3e (DOS 0:809c): zap at random intervals, then become remains when the lifetime ends.
  update(ctx, a) {
    // h0:8a48 (DOS 0:80a3).
    a.elcZapTime = u16(a.elcZapTime - ctx.state.frameTicks);
    if (s16(a.elcZapTime) < 0) {
      a.elcZapTime = u16((ctx.random.next(7) + 4) << 7);
      ctx.emit({ type: "sound", id: 11 });
      if (!a.elcVictimClass) flash(ctx, 3, 2);
    }
    // h0:8a8e.
    const time = countDown(ctx, a.elcTime);
    a.elcTime = time.value;
    if (time.expired) spawnRemains(ctx, a, -1, s8(a.direction), a.speed);
  },
  // h0:8abe (DOS 0:811e): every message returns 1.
  message() { return 1; },
  // h0:8af6 -> h0:9538 -> h0:11126 (DOS 0:8163): one frame per pass; on some frames a spark (child 1) is drawn first
  // and the body moves to part 1.
  post(_ctx, a) {
    a.frame = u8(a.frame + 1);
    let shape = SEQUENCE[s8(a.frame)];
    if (shape === undefined || shape === 255) {
      a.frame = 0;
      shape = SEQUENCE[0]!;
    }
    const spark = SPARKS[s8(a.frame)]!;
    const body = spark ? 1 : 0;
    a.spriteEnabled[1] = body;
    if (spark) {
      a.spritePaths[0] = [1, shape];
      a.elcSparkScheme = u8((spark - 1) << 2);
    }
    a.spritePaths[body] = [0, shape];
    a.spriteOffsetX[1] = a.spriteOffsetX[body] = -6;
    a.spriteOffsetY[1] = a.spriteOffsetY[body] = 0;
  },
  // h0:8afc (DOS 0:8169) draw-pass state: the body keeps its scheme three times in four, else takes random(4) * 4.
  prepareDraw(ctx, a) {
    a.elcFlickerScheme = ctx.random.next(4) ? a.spriteScheme : u8(ctx.random.next(4) << 2);
  },
  // h0:8afc: the spark with its own scheme, then the body with the flicker scheme chosen in the draw pass.
  draw(ctx, a, gfx) {
    if (a.spriteEnabled[1]) drawPart(ctx, a, gfx, 0);
    drawPart(ctx, a, gfx, a.spriteEnabled[1] ? 1 : 0);
  },
};
