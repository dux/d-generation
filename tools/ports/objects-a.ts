import * as h from "../../src/engine/actors/helpers.ts";
import { class8Init } from "../../src/engine/objects/class8.ts";
import * as ply from "../../src/engine/objects/player.ts";
import * as gre from "../../src/engine/objects/gre.ts";
import * as laser from "../../src/engine/objects/laser.ts";
import * as squ from "../../src/engine/objects/squ.ts";
import * as ven from "../../src/engine/objects/ven.ts";
import type { Port } from "../ports.ts";

export const ports: Record<string, Port> = {
  // shared helpers
  "0:3e23": { fn: (m, list) => h.roomInList(m, list), returns: "ax" },
  "0:3e5f": { fn: (m, px, py, n) => h.moveCurrent(m, px, py, n), returns: "ax" },
  "0:3e95": { fn: (m, px, py, n) => h.resolveMove(m, px, py, n), returns: "ax" },
  "0:3f81": { fn: (m, obj, part) => h.drawObjectPart(m, obj, part) },
  "0:4027": { fn: (m, t, r, s) => h.chase(m, t, r, s), returns: "ax" },
  "0:4043": { fn: (m, t, r, d, s) => h.moveToward(m, t, r, d, s), returns: "ax" },
  "0:414b": { fn: (m, o, r) => h.inRange(m, o, r), returns: "ax" },
  "0:41c6": { fn: (m, dx, dy, n, t) => h.probeMove(m, dx, dy, n, t), returns: "ax" },
  "0:4242": { fn: (m, pos) => h.teleportTo(m, pos), returns: "ax" },
  "0:42bd": { fn: (m, src, owner, dir, speed) => h.spawnFrom(m, src, owner, dir, speed), returns: "ax" },
  "0:434f": { fn: (m, a, b) => h.angleBetween(m, a, b), returns: "ax" },
  "0:4385": { fn: (m, obj, exit) => h.leaveRoom(m, obj, exit), returns: "ax" },
  "0:4407": { fn: (m, loc) => h.nextRoom(m, loc), returns: "ax" },
  "0:44ca": { fn: (m, obj, exit) => h.setEntry(m, obj, exit) },
  "0:44e4": { fn: (m, src) => h.setTargetPos(m, src) },
  "0:4505": { fn: (m, obj, bits) => h.setCellWalls(m, obj, bits) },
  "0:45f7": { fn: (m, col, row, mask, bits) => h.setCellBits(m, col, row, mask, bits) },
  "0:4642": { fn: (m, obj, rec) => h.writeRecord(m, obj, rec) },
  "0:4693": { fn: (m, obj, rec) => h.writeRecordFine(m, obj, rec) },
  "0:471d": { fn: (m, obj, rec) => h.readRecordFine(m, obj, rec) },
  "0:4757": { fn: (m, obj, v) => h.setSpeed(m, obj, v) },
  "0:478e": { fn: (m, a, b) => h.objectDistance(m, a, b), returns: "ax" },
  "0:47e7": { fn: (m, p) => h.countDown(m, p), returns: "ax" },
  "0:481a": { fn: (m, room) => h.startGame(m, room) },
  "0:486f": { fn: (m, n) => h.enterRoom(m, n) },
  "0:48da": { fn: (m) => h.startLifts(m) },
  "0:4909": { fn: (m) => h.countHostiles(m), returns: "ax" },
  "0:491b": { fn: (m, obj) => h.countHostile(m, obj), returns: "ax" },
  "0:4945": { fn: (m, a) => h.angleToFacing(m, a), returns: "ax" },
  "0:4979": { fn: (m, obj) => h.nudge(m, obj), returns: "ax" },
  "0:54f3": { fn: (m, obj, dx, dy) => h.animateWalk(m, obj, dx, dy) },
  "0:59cd": { fn: (m, dir, low) => h.spawnAhead(m, dir, low), returns: "ax" },
  "0:5bd0": { fn: (m, cls, list) => h.classInList(m, cls, list), returns: "ax" },
  "0:5fa8": { fn: (m, v) => h.alertSurveillance(m, v) },
  "0:5fbd": { fn: (m, obj) => h.alertOne(m, obj), returns: "ax" },
  "0:5fe8": { fn: (m) => h.removeDeadSurveillance(m) },
  "0:5ff1": { fn: (m, obj) => h.removeIfDead(m, obj), returns: "ax" },

  // class 0, PLY
  "0:3c2f": { fn: (m, record, obj) => ply.plyInit(m, record, obj) },
  "0:51ee": { fn: (m) => ply.plyUpdate(m) },
  "0:5220": { fn: (m) => ply.plyInvulnerable(m) },
  "0:5248": { fn: (m, msg, arg) => ply.plyMessage(m, msg, arg), returns: "ax" },
  "0:52b1": { fn: (m) => ply.plyLifted(m), returns: "ax" },
  "0:52d2": { fn: (m) => ply.plyMove(m) },
  "0:5334": { fn: (m) => ply.plyControl(m) },
  "0:5355": { fn: (m) => ply.plyInput(m) },
  "0:544f": { fn: (m, info) => ply.plyCollide(m, info), returns: "ax" },
  "0:54d4": { fn: (m) => ply.plyPostUpdate(m) },
  "0:54da": { fn: (m) => ply.plyDraw(m) },
  "0:55c0": { fn: (m, dir) => ply.plyPushed(m, dir), returns: "ax" },
  "0:5604": { fn: (m) => ply.plyFire(m) },
  "0:5673": { fn: (m) => ply.plyUse(m) },
  "0:5716": { fn: (m) => ply.plyHit(m), returns: "ax" },
  "0:5792": { fn: (m) => ply.plyDie(m) },
  "0:592a": { fn: (m) => ply.plyThrow(m) },

  // class 8
  "0:3c49": { fn: (m, record, obj) => class8Init(m, record, obj) },

  // class 5, SQU
  "0:4e30": { fn: (m, record, obj) => squ.squInit(m, record, obj) },
  "0:4e4a": { fn: (m) => squ.squUpdate(m) },
  "0:4e4b": { fn: (m, msg, arg) => squ.squMessage(m, msg, arg), returns: "ax" },
  "0:4e93": { fn: (m) => squ.squHit(m), returns: "ax" },
  "0:4ea8": { fn: (m) => squ.squPostUpdate(m) },
  "0:4f49": { fn: (m) => squ.squDraw(m) },

  // class 13, VEN
  "0:4f58": { fn: (m, record, obj) => ven.venInit(m, record, obj) },
  "0:4fd0": { fn: (m, obj, record) => ven.venSave(m, obj, record) },
  "0:501f": { fn: (m) => ven.venUpdate(m) },
  "0:5023": { fn: (m) => ven.venDispense(m) },
  "0:5109": { fn: (m, msg, arg) => ven.venMessage(m, msg, arg), returns: "ax" },
  "0:5151": { fn: (m) => ven.venTouched(m), returns: "ax" },
  "0:5183": { fn: (m) => ven.venPostUpdate(m) },
  "0:51df": { fn: (m) => ven.venDraw(m) },

  // class 19, GRE
  "0:3cc4": { fn: (m, record, obj) => gre.greInit(m, record, obj) },
  "0:3d40": { fn: (m, obj, record) => gre.greSave(m, obj, record) },
  "0:5d78": { fn: (m) => gre.greUpdate(m) },
  "0:5db0": { fn: (m) => gre.greFollowPath(m) },
  "0:5e66": { fn: (m) => gre.greRoll(m) },
  "0:5eb5": { fn: (m, msg, arg) => gre.greMessage(m, msg, arg), returns: "ax" },
  "0:5f15": { fn: (m) => gre.greCollide(m), returns: "ax" },
  "0:5f5d": { fn: (m) => gre.greHit(m), returns: "ax" },
  "0:5f79": { fn: (m) => void gre.greExplode(m) },
  "0:5f64": { fn: (m) => gre.grePostUpdate(m) },
  "0:5f6a": { fn: (m) => gre.greDraw(m) },

  // class 20, LASER
  "0:3c9f": { fn: (m, record, obj) => laser.laserInit(m, record, obj) },
  "0:5a36": { fn: (m) => laser.laserUpdate(m) },
  "0:5aee": { fn: (m, msg, arg) => laser.laserMessage(m, msg, arg), returns: "ax" },
  "0:5c04": { fn: (m, info) => laser.laserReflect(m, info), returns: "ax" },
  "0:5c31": { fn: (m) => laser.laserBounce(m) },
  "0:5c73": { fn: (m) => laser.laserPostUpdate(m) },
  "0:5d30": { fn: (m) => laser.laserDraw(m) },
  "0:5d3f": { fn: (m) => laser.laserExplosionFrame(m), returns: "ax" },
};
