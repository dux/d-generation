import type { Actor, ActorContext } from "./model.ts";
import { s8, s16, u16 } from "./int.ts";
import { showMessage } from "./messages.ts";

// h0:d020/d030: exact signed 8.8 trigonometric tables at g:2d88/g:2e08.
const SIN = [0,25,50,74,98,121,142,162,181,198,213,226,237,245,251,255,256,255,251,245,237,226,213,198,181,162,142,121,98,74,50,25,0,-25,-50,-74,-98,-121,-142,-162,-181,-198,-213,-226,-237,-245,-251,-255,-256,-255,-251,-245,-237,-226,-213,-198,-181,-162,-142,-121,-98,-74,-50,-25];
const DX = [0,1,1,1,0,-1,-1,-1];
const DY = [-1,-1,0,1,1,1,0,-1];
const WALL_PAIRS = [[3,-2,3,-1],[4,0,5,0],[3,1,3,2],[1,0,2,0]];
const SPAWN = [-6,0,-4,4,0,6,4,4,6,0,4,-4,0,-6,-4,-4];
const WALK_FRAMES = [8,10,10,10,8,10,10,10];
const WALK_STEP = [400,470,430,470,400,470,430,470];
const GENERATOR_STEP = [420,495,450,495,420,495,450,495];
const WALK_SOUND_A = [2,3,2,3,2,3,2,3];
const WALK_SOUND_B = [6,8,7,8,6,8,7,8];

// h0:dbca: class collision footprints from the AGA class descriptors g:426.
const INNER_RADIUS: Readonly<Record<number, number>> = {0:335,1:400,2:256,3:300,4:512,5:335,6:512,7:360,8:335,9:335,10:360,11:384,12:335,13:768,14:620,15:360,16:335,17:335,18:400,19:320,20:320,21:360,22:385,23:335,24:335,25:385,26:385,27:335};
const OUTER_RADIUS: Readonly<Record<number, number>> = {...INNER_RADIUS,3:512,13:600,14:500,18:512};
const SOLID_CLASSES = new Set([0,6,9,10,11,15,16,19,21,22,23,25,26,27]);

// h0:dbca (DOS fff:0322): integer-position rotated collision and depth boxes.
export function updateBounds(actor: Actor): void {
  const r = INNER_RADIUS[actor.classId];
  if (r === undefined) throw new Error(`AGA collision bounds for class ${actor.classId} not ported`);
  const x = actor.x >>> 8, y = actor.y >>> 8;
  const u = u16((x + y) << 7), v = u16((y - x + 256) << 7);
  let rx = r, ry = r;
  if (actor.classId === 2) {rx = actor.facing < 2 ? 256 : 1280;ry = actor.facing < 2 ? 1280 : 256;}
  if (actor.classId === 4) {rx = actor.facing & 2 ? 512 : 1280;ry = actor.facing & 2 ? 1280 : 512;}
  actor.boundsLeft = u16(u - (actor.classId === 7 && actor.facing === 1 ? 700 : rx));
  actor.boundsTop = u16(v - ry);
  actor.boundsRight = u16(u + (actor.classId === 7 && actor.facing === 1 ? 1000 : rx));
  actor.boundsBottom = u16(v + ry);
  const outerX = actor.classId === 2 || actor.classId === 4 ? rx : OUTER_RADIUS[actor.classId];
  const outerY = actor.classId === 2 || actor.classId === 4 ? ry : OUTER_RADIUS[actor.classId];
  actor.outerLeft = u16(u - outerX);
  actor.outerTop = u16(v - outerY);
  actor.outerRight = u16(u + outerX);
  actor.outerBottom = u16(v + outerY);
}

// h0:f90e (DOS fff:27b4): comparisons use unsigned high bytes, inclusively.
export function boxesOverlap(a: Actor, b: Actor): boolean {
  return (a.boundsLeft >>> 8) <= (b.boundsRight >>> 8) && (b.boundsLeft >>> 8) <= (a.boundsRight >>> 8)
    && (a.boundsTop >>> 8) <= (b.boundsBottom >>> 8) && (b.boundsTop >>> 8) <= (a.boundsBottom >>> 8);
}

// h0:1f14: SAS/C extracts the middle word after each signed multiplication.
export function movementDelta(ctx: ActorContext, actor: Actor, steps: number): { dx: number; dy: number } {
  let scale = Math.imul(s16(ctx.state.frameTicks * s8(steps)), actor.speed);
  if (s8(actor.movementHeading) !== -1) {
    const heading = actor.movementHeading & 63;
    const magnitude = s16(scale >> 8);
    return { dx: s16(Math.imul(SIN[heading], magnitude) >> 8), dy: s16(Math.imul(-SIN[(heading + 16) & 63], magnitude) >> 8) };
  }
  if (actor.direction & 1) scale = Math.imul(s16(scale >> 8), 181);
  const magnitude = Math.abs(s16(scale >> 8));
  return { dx: s16(DX[actor.direction & 7] * magnitude), dy: s16(DY[actor.direction & 7] * magnitude) };
}

// h0:1a7c (DOS 0:29b3): save the prior position before applying a signed delta.
export function applyStep(_ctx: ActorContext, actor: Actor, dx: number, dy: number): boolean {
  if (actor.noTurn || actor.removed) return false;
  actor.previousX = actor.x;
  actor.previousY = actor.y;
  actor.x = u16(actor.x + dx);
  actor.y = u16(actor.y + dy);
  if (actor.x === actor.previousX && actor.y === actor.previousY) return false;
  actor.moved = 1;
  return true;
}

// h0:1a34: compute and apply a movement delta.
export function stepActor(ctx: ActorContext, actor: Actor, steps = 1): {dx: number; dy: number; moved: boolean} {
  if (actor.noTurn || actor.removed) return { dx: 0, dy: 0, moved: false };
  const d = movementDelta(ctx, actor, steps);
  return { ...d, moved: applyStep(ctx, actor, d.dx, d.dy) };
}

// h0:1b9c: rollback also refreshes boxes if either integer coordinate changed.
export function restorePosition(actor: Actor): void {
  const changed = (actor.x >>> 8) !== (actor.previousX >>> 8) || (actor.y >>> 8) !== (actor.previousY >>> 8);
  actor.x = actor.previousX;
  actor.y = actor.previousY;
  if (changed) updateBounds(actor);
}

// h0:4294 (DOS 0:3e5f): odd facings use truncating 180/128 speed scaling.
export function setSpeed(actor: Actor, speed: number): void {
  actor.speed = (actor.facing & 1 ? (s16(speed) * 180) >> 7 : speed) & 255;
}

// h0:9f9c: g:2c65 maps rotated integer coordinates to occupancy cells.
export function cellCoordinate(pixel: number): number {
  const p = pixel & 255;
  if (p >= 32) return Math.max(0, Math.floor((p - 35) * 2 / 7));
  // The table's first 32 entries overlap the preceding disk prompt in the AGA data hunk.
  return "se insert disk %d in any drive.\0".charCodeAt(p);
}

// h0:a1f4: write one logical occupancy bit (56 columns, 54 rows).
export function setCell(ctx: ActorContext, x: number, y: number, value: number): void {
  const index = y * 56 + x;
  if (index >= 0 && index < ctx.state.occupancy.length) ctx.state.occupancy[index] = value ? 1 : 0;
}

// h0:1ca4/a11e: construct occupancy from the authored room wall footprints.
export function initializeOccupancy(ctx: ActorContext): void {
  ctx.state.occupancy.fill(0);
  ctx.state.occupancyScene = ctx.room.scene;
  for (let row = 0; row < 13; row++) {
    const names = ctx.room.cells[row].trim().split(/\s+/);
    for (let col = 0; col < 10; col++) {
      const cell = ctx.room.cellLegend[names[col]];
      if (!cell.walls.length) continue;
      const sx = col * 14 + 57, sy = row * 14 + 36;
      const x = cellCoordinate(u16(((sx + sy) << 7) + 128) >>> 8) - 1;
      const y = cellCoordinate(u16(((sy - sx) << 7) + 0x8080) >>> 8);
      for (const side of cell.walls) {
        const pairs = WALL_PAIRS[side];
        setCell(ctx, x + pairs[0], y + pairs[1], 1);
        setCell(ctx, x + pairs[2], y + pairs[3], 1);
      }
      setCell(ctx, x + 3, y, 1);
    }
  }
}

// h0:9f9c: enumerate occupied cells under the collision rectangle.
export function occupiedCells(ctx: ActorContext, actor: Actor): {x: number; y: number}[] {
  if (ctx.state.occupancyScene !== ctx.room.scene) initializeOccupancy(ctx);
  const artKind = (actor as Actor & {artKind: number}).artKind;
  if (actor.classId === 11 && artKind !== 5 && artKind !== 7) return [];
  const cells: {x: number; y: number}[] = [];
  const left = cellCoordinate(actor.boundsLeft >>> 8), right = cellCoordinate(actor.boundsRight >>> 8);
  const top = cellCoordinate(actor.boundsTop >>> 8), bottom = cellCoordinate(actor.boundsBottom >>> 8);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (ctx.state.occupancy[y * 56 + x]) cells.push({x,y});
  }
  return cells;
}

// h0:f060/f12c: occupied path cells for doors and wall switches.
function actorPath(actor: Actor): {x:number;y:number}[] {
  const x = actor.x >>> 8, y = actor.y >>> 8;
  const cx = cellCoordinate(u16((x + y) << 7) >>> 8), cy = cellCoordinate(u16((y - x + 256) << 7) >>> 8);
  // g:3bef/3bf7 with their next two bytes: facing 0 reads pair 4. Extension 0x5201 scales X's index by two.
  const steps = actor.classId === 4 ? [0,-1,0,1,-1,0,1,0,1,2] : [-1,0,1,0,0,-1,0,1,0,-1];
  const cells = [{x:cx&127,y:cy&127}];
  for (let n = 0, d = (s8(actor.facing) - 1) & 3; n < 2; n++, d++) {
    cells.push({x:(cx+steps[d*2+1])&127,y:(cy+steps[d*2])&127});
  }
  return cells;
}

// h0:a620: write the active path cells into the occupancy map.
export function setCellOccupancy(ctx: ActorContext, actor: Actor, value: number): void {
  if (ctx.state.occupancyScene !== ctx.room.scene) initializeOccupancy(ctx);
  for (const cell of actorPath(actor)) {
    if (!cell.x) break;
    setCell(ctx,cell.x,cell.y,value);
  }
}

// h0:a712: test the room occupancy against live solid actor classes.
export function occupiedActorCell(ctx: ActorContext): boolean {
  return ctx.objects.slots.some(a => a !== null && SOLID_CLASSES.has(a.classId) && occupiedCells(ctx, a).length !== 0);
}

// h0:f84a (DOS fff:26c9): preserve slot order and owner/team filtering.
export function findCollision(ctx: ActorContext, actor: Actor): Actor | null {
  if (actor.triggerOnly) return null;
  for (const other of ctx.objects.slots) {
    if (!other || other.classId === 4 || other.classId === 2 || other.id === actor.ownerId
      || (actor.classId === 21 && other.classId === 21) || other.id === actor.id || other.ownerId === actor.id
      || other.classId === actor.ignoredClass || other.ignoredClass === actor.classId
      || other.removed || other.triggerOnly || other.collisionDisabled) continue;
    if (boxesOverlap(actor, other)) return other;
  }
  return null;
}

// h0:11956: room box established at h0:ada2; positions are integer high bytes.
export function roomEdge(ctx: ActorContext, actor: Actor): number {
  const x = actor.x >>> 8, y = actor.y >>> 8;
  if (y - actor.height < s16(ctx.state.scrollY + 4)) return 0x21;
  if (y >= s16(ctx.state.scrollY + ctx.state.roomHeight - 10)) return 0x23;
  if (x < s16(ctx.state.scrollX + 8)) return 0x24;
  if (x >= s16(ctx.state.scrollX + ctx.state.roomWidth - 8)) return 0x22;
  return 0;
}

// h0:9f58 (DOS 0:d424): first actor, then occupancy, then room edge.
export function blocked(ctx: ActorContext, actor: Actor): number {
  if (actor.collisionDisabled || actor.removed) return 0;
  const other = findCollision(ctx, actor);
  if (other) return 0x60 + other.classId;
  if (occupiedCells(ctx, actor).length) return 1;
  return roomEdge(ctx,actor);
}

// h0:a788: collision message 0 goes first to the moving actor, then to the other; both directions are taken before either send.
export function hitPair(ctx: ActorContext, actor: Actor, other: Actor): number {
  if (actor.removed) return 0;
  const toActor = other.speed ? other.direction : (actor.direction + 4) & 7, toOther = actor.direction;
  const r1 = ctx.objects.send(actor, {type:0,sender:other,direction:toActor});
  const r2 = ctx.objects.send(other, {type:0,sender:actor,direction:toOther});
  return r1 | r2;
}

// h0:f572: reflect a direction against an occupied cell; odd headings reverse.
function reflect(actor: Actor, cell: {x:number;y:number}): {direction:number; reversed:boolean} {
  let d = actor.direction, reversed = false;
  const l = cellCoordinate(actor.boundsLeft >>> 8), r = cellCoordinate(actor.boundsRight >>> 8);
  const t = cellCoordinate(actor.boundsTop >>> 8), b = cellCoordinate(actor.boundsBottom >>> 8);
  if (d & 1) d += 4;
  else if (d === 0) { if (t <= cell.y) d += 2; else if (l <= cell.x) d -= 2; else {d += 4; reversed = true;} }
  else if (d === 2) { if (t <= cell.y) d -= 2; else if (r >= cell.x) d += 2; else {d += 4; reversed = true;} }
  else if (d === 4) { if (b >= cell.y) d += 2; else if (r >= cell.x) d -= 2; else {d += 4; reversed = true;} }
  else if (d === 6) { if (b >= cell.y) d -= 2; else if (l <= cell.x) d += 2; else {d += 4; reversed = true;} }
  return {direction:d & 7,reversed};
}

// h0:a2f8: dispatch a collision according to its high three bits.
export function collide(ctx: ActorContext, actor: Actor, code: number, collidedActor: Actor | null = null): number {
  if ((code & 0xe0) === 0x60) {
    const other = collidedActor ?? findCollision(ctx, actor);
    if (!other || actor.removed || actor.collisionDisabled || actor.triggerOnly || !boxesOverlap(actor,other)) return 0;
    restorePosition(actor);
    return hitPair(ctx, actor, other);
  }
  if ((code & 0xe0) === 0) {
    const cells = occupiedCells(ctx, actor);
    if (!cells.length) return 0;
    for (const block of ctx.objects.slots) {
      if (block && block.classId === 4 && actorPath(block).some(path => cells.some(cell => cell.x === path.x && cell.y === path.y))) {
        ctx.objects.send(block,{type:0,sender:actor,direction:actor.direction});
      }
    }
    actor.x = (actor.x & 0xff00) | 128;
    actor.y = (actor.y & 0xff00) | 128;
    restorePosition(actor);
    let direction = actor.direction;
    for (const cell of cells) {
      const r = reflect(actor, cell);
      direction = r.direction;
      if (!r.reversed) break;
    }
    ctx.objects.send(actor,{type:8,sender:null,direction});
    return 1;
  }
  if ((code & 0xe0) !== 0x20) return 0;
  const edge = roomEdge(ctx,actor) & 15;
  if (!edge) return 0;
  // h0:a3da..a3fc: leaving scene index 0x84 (the jet-pack roof) before the D/Generation creature appeared starts
  // the jet-pack exit: use is disabled (g:23e) and the story transition h0:7c94 goes to scene 0x8a.
  if (ctx.state.sceneIndex === 0x84 && !ctx.state.generatorOverride) {
    ctx.state.useDisabled = 1;
    ctx.storyTransition(0x8a);
    return 0;
  }
  restorePosition(actor);
  let direction = actor.direction;
  if (!(direction & 1)) direction += 4;
  else if (edge === 1) direction += direction === 7 ? -2 : 2;
  else if (edge === 2) direction += direction === 3 ? 2 : -2;
  else if (edge === 3) direction += direction === 3 ? -2 : 2;
  else direction += direction === 7 ? 2 : -2;
  if (actor.classId === 19 || actor.classId === 20) actor.removed = 2;
  ctx.state.roomChange = 0;
  if (actor.classId === 0) {
    // h0:3edc runs its object passes before h0:3f54 knows whether the map has a neighbour.
    const next = ctx.world.gridDestination(ctx.room.scene, edge - 1);
    if (next !== null) {
      ctx.world.position.entrySlot = [2,3,0,1][edge - 1];
      ctx.world.position.spawnDirection = actor.facing;
      ctx.world.position.exitDirection = edge - 1;
    }
    ctx.exitRoom(next);
  } else if (actor.classId === 9) {
    if ((actor as Actor & {surTargetId:number}).surTargetId === edge - 1) {
      actor.removed = ctx.state.round;
      ctx.state.rescuedCount = (ctx.state.rescuedCount + 1) & 255;
      ctx.state.lives = (ctx.state.lives + 1) & 255;
      const count = s8(ctx.state.rescuedCount);
      showMessage(ctx, `\`${count} ${count === 1 ? "Person" : "People"} Rescued!`, 4, 3);
      ctx.emit({type:"sound",id:28});
    }
  }
  ctx.objects.send(actor,{type:8,sender:null,direction:direction & 7});
  return 1;
}

// h0:a286: trigger-only overlaps send message 6 to both sides.
export function bumpObjects(ctx: ActorContext, actor: Actor): void {
  for (const other of ctx.objects.slots) {
    if (!other || other.classId === 4 || other.classId === 2 || (!actor.collisionDisabled && !other.collisionDisabled)
      || actor.id === other.id || actor.classId === other.ignoredClass || other.removed || !boxesOverlap(actor,other)) continue;
    ctx.objects.send(other,{type:6,sender:actor});
    ctx.objects.send(actor,{type:6,sender:other});
  }
}

// h0:3a4c (DOS 0:3e95): retry movement one substep at a time after rollback.
export function resolveMove(ctx: ActorContext, actor: Actor, dx: number, dy: number, steps: number): {dx:number;dy:number;collision:number} {
  let code = 0, collision = 0;
  if (!actor.removed) {
    updateBounds(actor);
    code = blocked(ctx, actor);
    const collidedActor = code >= 0x60 ? findCollision(ctx, actor) : null;
    if (code) {
      collision = 1;
      restorePosition(actor);
      for (let n = steps & 255; n > 0; n--) {
        const d = stepActor(ctx, actor, 1);
        dx = d.dx; dy = d.dy;
        if (!d.moved) continue;
        updateBounds(actor);
        if (collide(ctx,actor,code,collidedActor)) { restorePosition(actor); break; }
      }
    }
    bumpObjects(ctx,actor);
  }
  return {dx,dy,collision:((code << 8) | collision) & 65535};
}

// h0:3a16 (DOS 0:3e5f): movement followed by collision resolution.
export function moveActor(ctx: ActorContext, actor: Actor, steps = 6): {dx:number;dy:number;collision:number} {
  const d = stepActor(ctx,actor,steps);
  return d.moved ? resolveMove(ctx,actor,d.dx,d.dy,steps) : {dx:d.dx,dy:d.dy,collision:0};
}

// h0:3dc0 (DOS 0:4242): teleport only when the destination is not blocked.
export function teleportActor(ctx: ActorContext, actor: Actor, x: number, y: number): boolean {
  const oldX = actor.x, oldY = actor.y;
  actor.x = u16(x); actor.y = u16(y);
  updateBounds(actor);
  if (blocked(ctx,actor)) { actor.x = oldX; actor.y = oldY; updateBounds(actor); return false; }
  actor.moved = 0;
  updateBounds(actor);
  return true;
}

// h0:44e8 (DOS 0:4979): accumulated retry turns and distances are intentional.
export function nudge(ctx: ActorContext, actor: Actor): boolean {
  const ticks = ctx.state.frameTicks, x = actor.x, y = actor.y, direction = actor.direction, speed = actor.speed;
  ctx.state.frameTicks = 256;
  actor.movementHeading = 255; actor.speed = 181; actor.direction ^= 4;
  const turns = [0,2,4,4,4,4], steps = [2,2,4,6,8,10];
  let freed = false;
  for (let n = 0; n < turns.length; n++) {
    actor.direction = (actor.direction + turns[n]) & 7;
    stepActor(ctx,actor,steps[n]); updateBounds(actor);
    if (!blocked(ctx,actor)) {
      actor.x = (actor.x & 0xff00) | 128; actor.y = (actor.y & 0xff00) | 128;
      actor.direction = direction ^ 4; freed = true; break;
    }
  }
  if (!freed) {actor.x=x;actor.y=y;actor.direction=direction;updateBounds(actor);}
  actor.speed=speed;ctx.state.frameTicks=ticks;
  return freed;
}

// h0:4f70 (DOS 0:54f3): animation distance (+98 word of walking classes) uses the AGA's fixed tables.
export function animateWalk(ctx: ActorContext, actor: Actor & { walkDistance: number }, dx: number, dy: number): void {
  const d = actor.facing & 7;
  const travelled = Math.min(400,Math.abs(s16((d !== 0 && d !== 4) ? dx : dy)));
  actor.walkDistance = u16(actor.walkDistance + travelled);
  const step = (actor.classId === 22 || actor.classId === 26 ? GENERATOR_STEP : WALK_STEP)[d];
  let frame = s8(actor.frame);
  while (s16(actor.walkDistance) > step) {
    actor.walkDistance = u16(actor.walkDistance - step);
    if (++frame > WALK_FRAMES[d]) frame = 1;
    if (frame === WALK_SOUND_A[d] || frame === WALK_SOUND_B[d]) ctx.emit({type:"sound",id:23});
  }
  actor.frame = frame & 255;
}

// h0:e5bc (DOS fff:0cdc): tangent-sector search, integer division toward zero.
export function angle(dx: number, dy: number): number {
  dx=s16(dx);dy=s16(dy);
  const right=dx>0,up=!(dy>0);
  if (!dy) return right?16:48;
  const ratio=Math.trunc(Math.abs(dx)*256/Math.abs(dy));
  const tangents=[13,38,64,92,121,153,190,232,282,345,427,541,715,766,1726,5211];
  let n=0;
  while(n<16 && tangents[n]<ratio)n++;
  if(up!==right)n=32-n;
  if(!right)n+=32;
  return n&63;
}

// h0:3eae (DOS 0:434f): angle of a minus b in signed 16-bit coordinates.
export function angleBetween(a: Actor,b: Actor): number {return angle(a.x-b.x,a.y-b.y);}

// h0:3cd2 (DOS 0:414b): inclusive square range, using position high bytes.
export function inRange(a: Actor,b: Actor|null,range: number): boolean {
  return b!==null && Math.abs((a.x>>>8)-(b.x>>>8))<=s16(range) && Math.abs((a.y>>>8)-(b.y>>>8))<=s16(range);
}
export const nearActor = inRange;

// h0:3d36 (DOS 0:41c6): probe occupancy, not actors or room edges.
function probeMove(ctx: ActorContext,a: Actor,target: Actor,dx:number,dy:number,count:number): number {
  do {
    a.previousX=a.x;a.previousY=a.y;a.x=u16(a.x+dx);a.y=u16(a.y+dy);updateBounds(a);
    if(occupiedCells(ctx,a).length)return boxesOverlap(a,target)?3:2;
    if(boxesOverlap(a,target))return 1;
  }while(--count>0);
  return 0;
}

// h0:3bb8 (DOS 0:4043): LOS probe restores position but keeps previous position writes.
export function moveToward(ctx: ActorContext,a: Actor,target: Actor|null,range:number,heading:number,speed:number): number {
  if(!target || !inRange(a,target,range))return -1;
  const x=a.x,y=a.y,d=heading===-1?angleBetween(target,a):heading;
  const dx=SIN[d&63],dy=-SIN[(d+16)&63];
  const steps=[0,84,42,28,17,14,12,10];
  let result=-1;
  const r=probeMove(ctx,a,target,s16(speed*dx),s16(speed*dy),steps[speed]??0);
  if(r===1)result=d;
  else if(r===3){restorePosition(a);const r2=probeMove(ctx,a,target,dx,dy,speed);if(r2===1||r2===3)result=d;}
  a.previousX=x;a.previousY=y;restorePosition(a);
  return result;
}

// h0:3b94 (DOS 0:4027): aim at a target through the room occupancy.
export function chase(ctx: ActorContext,a: Actor,target: Actor|null,range:number,speed:number): number {return moveToward(ctx,a,target,range,-1,speed);}
export const targetAim=chase;
export const sightActor=chase;

// h0:db40/dae8 (DOS fff:0067): 16-bit sum of squares and bounded Newton iteration.
export function distance(dx:number,dy:number): number {
  const sum=(dx*dx+dy*dy)&65535;
  if(sum===65535)return 255;
  let g=(sum>>4)|1,delta=0;
  for(let n=0;n<20;n++){const q=Math.floor(sum/g);delta=Math.abs(g-q)>>1;g+=q<g?-delta:delta;if(delta<=1)break;}
  return g&65535;
}

// h0:5518 (DOS 0:59cd): place the shot at the facing's signed offset.
export function spawnAhead(ctx: ActorContext,source: Actor,classId:number,direction:number): Actor|null {
  const d=direction&7;
  return ctx.objects.spawn(classId,{class:`unknown-${classId}`,x:((source.x>>>8)+SPAWN[d*2+1])&255,y:((source.y>>>8)+SPAWN[d*2])&255,params:{orientation:d,facing:d}});
}
