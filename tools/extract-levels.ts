import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  decodeMap, decodeRoomBlock, encodeMap, encodeRoomBlock, parseFloor, stringifyFloor,
  type Floor, type Room,
} from "../src/formats/level.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `${root}amiga/aga/DATA`;
const destination = `${root}levels`;
const maps = await Promise.all([0, 1, 2].map(async bank => {
  const original = new Uint8Array(await readFile(`${source}/MAPMTX${bank}.DAT`));
  return { original, map: decodeMap(original, bank) };
}));

function assertBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length) throw new Error(`${label}: size ${actual.length} != ${expected.length}`);
  for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) throw new Error(`${label}: byte 0x${i.toString(16)}: ${actual[i]} != ${expected[i]}`);
}

const floors: { floor: Floor; original: Uint8Array; blocks: Uint8Array[] }[] = [];
for (let number = 1; number <= 10; number++) {
  const original = new Uint8Array(await readFile(`${source}/L${number}.SCN`));
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const count = view.getUint16(0, true);
  if (count < 1 || count > 20 || 2 + count * 6 > original.length) throw new Error(`L${number}: invalid scene directory`);
  const directory = Array.from({ length: count }, (_, i) => ({ scene: view.getUint16(2 + i * 6, true), offset: view.getUint32(4 + i * 6, true) }));
  const blocks: Uint8Array[] = [], rooms: Room[] = [];
  for (const [i, entry] of directory.entries()) {
    const end = directory[i + 1]?.offset ?? original.length;
    if (entry.offset < 2 + count * 6 || end <= entry.offset || end > original.length) throw new Error(`L${number}: invalid scene ${entry.scene} extent`);
    const bytes = original.subarray(entry.offset, end), room = decodeRoomBlock(bytes);
    room.scene = entry.scene; rooms.push(room); blocks.push(bytes);
  }
  const bank = number <= 4 ? 0 : number <= 7 ? 1 : 2;
  const starts = rooms.filter(room => room.objects.some(obj => obj.class === "lift" && obj.params.arrival)).map(room => room.scene);
  if (number === 1) starts.unshift(1);
  // h0:bdaa searches h11:293a, whose ten scene lists match these directory lists exactly.
  const floor: Floor = {
    format: "d-generation-aga-floor", floor: number, buildingFloor: 79 + number,
    start: starts[0], starts, lookupScenes: directory.map(entry => entry.scene),
    map: maps[bank].map, connections: [], rooms,
  };
  if (!floor.start) throw new Error(`Floor ${number}: no start room`);
  floors.push({ floor, original, blocks });
}

const combinedMap = maps.flatMap(({ map }) => map.rows);
const steps = [[-1, 0], [0, 1], [1, 0], [0, -1]];
for (const { floor } of floors) {
  for (const room of floor.rooms) {
    // h0:3f54: map candidates; room collision and doors still gate crossing a boundary.
    const row = combinedMap.findIndex(row => row.includes(room.scene));
    if (row >= 0) {
      const col = combinedMap[row].indexOf(room.scene);
      for (const [direction, [dr, dc]] of steps.entries()) {
        const to = combinedMap[row + dr]?.[col + dc];
        if (to != null) floor.connections.push({ kind: "grid", from: room.scene, direction, to });
      }
    }
    for (const [object, obj] of room.objects.entries()) {
      if (obj.class !== "lift" || obj.params.arrival) continue;
      // AGA h0:12c00 overrides the selector in scene137; DOS uses a different value.
      const selector = room.scene === 137 ? 33 : obj.params.destination;
      const to = Math.trunc((room.scene - 1) / 50) * 50 + selector + (selector === 1 ? 50 : 0);
      floor.connections.push({ kind: "lift", from: room.scene, object, selector, to });
    }
    if (room.scene === 114) floor.connections.push({ kind: "special-exit", from: 114, to: 133 });
  }
}

await mkdir(destination, { recursive: true });
let roomCount = 0, bytesCount = 0;
for (const { floor, original, blocks } of floors) {
  const text = stringifyFloor(floor), path = `${destination}/floor${String(floor.floor).padStart(2, "0")}.json5`;
  await writeFile(path, text);
  // Read the emitted file back: assertions exercise the actual on-disk JSON5, not just the decoder.
  const parsed = parseFloor(await readFile(path, "utf8"));
  const encoded = parsed.rooms.map(encodeRoomBlock);
  encoded.forEach((block, i) => assertBytes(block, blocks[i], `floor${floor.floor} scene${parsed.rooms[i].scene}`));
  assertBytes(encodeMap(parsed.map), maps[parsed.map.bank].original, `floor${floor.floor} MAPMTX${parsed.map.bank}`);
  // Rebuild the entire pack, including count, scene order, directory offsets and post-terminator padding.
  const pack = new Uint8Array(2 + parsed.rooms.length * 6 + encoded.reduce((size, bytes) => size + bytes.length, 0));
  const view = new DataView(pack.buffer); view.setUint16(0, parsed.rooms.length, true);
  let offset = 2 + parsed.rooms.length * 6;
  encoded.forEach((block, i) => {
    view.setUint16(2 + i * 6, parsed.rooms[i].scene, true); view.setUint32(4 + i * 6, offset, true);
    pack.set(block, offset); offset += block.length;
  });
  assertBytes(pack, original, `L${floor.floor}.SCN`);
  roomCount += parsed.rooms.length; bytesCount += original.length;
  console.log(`floor${String(floor.floor).padStart(2, "0")}: ${parsed.rooms.length} rooms, ${original.length} SCN bytes identical; MAPMTX${parsed.map.bank} ${maps[parsed.map.bank].original.length} bytes identical; start ${parsed.start}${parsed.starts.length > 1 ? ` (entries ${parsed.starts.join(", ")})` : ""}`);
}
for (const { original, map } of maps) assertBytes(encodeMap(map), original, `MAPMTX${map.bank}`);
const shared = floors.filter(({ floor }) => floor.rooms.some(room => room.scene === 103)).map(({ floor }) => encodeRoomBlock(floor.rooms.find(room => room.scene === 103)!));
for (const block of shared) assertBytes(block, shared[0], "shared scene103");
console.log(`PASS: ${roomCount} room occurrences, 10 complete SCN packs (${bytesCount} bytes), 3 complete MAPMTX files (768 bytes), shared scene103 identical in floors 8/9/10.`);
