import type { Floor, Room } from "../../formats/level.ts";
import { s32, u8 } from "./int.ts";

export interface WorldPosition {
  row: number;
  column: number;
  scene: number;
  exitDirection: number;
  spawnDirection: number;
  entrySlot: number;
}

// h0:e6a..eb8 copy g:85d4..85f1, including the two alignment bytes.
export interface PlayerCheckpoint {
  lives: number;
  rescuedCount: number;
  buildingFloor: number;
  ammo: number;
  throwableAvailable: number;
  bombsFound: number;
  spawnX: number;
  spawnY: number;
  spawnDirection: number;
  portableLaserCount: number;
  slowMotionCount: number;
  shieldCount: number;
  carriedBombs: number;
  inventoryAvailability: number;
  slowMotion: number;
  playerPadding: number;
  slowMotionTime: number;
  invulnerable: number;
  shieldPadding: number;
  invulnerabilityTime: number;
  paused: number;
  specialItemCollected: number;
  floorSecurityState: number;
  floorSecurityCode: number;
}

export interface WorldState {
  currentFloor: number;
  position: WorldPosition;
  checkpointPosition: WorldPosition | null;
  roomEntryPlayer: PlayerCheckpoint | null;
  checkpointPlayer: PlayerCheckpoint | null;
  visited: boolean[];
  respawnScene: number;
}

export class World {
  readonly floors: Floor[];
  readonly state: WorldState;
  private readonly grid: (number | null)[][];

  // h0:c4cc concatenates the three thirteen-row map banks in bank order.
  constructor(floors: Floor[]) {
    if (floors.length === 0) throw new Error("World requires at least one AGA floor");
    this.floors = [...floors].sort((a, b) => a.floor - b.floor);
    this.grid = Array.from({ length: 39 }, () => Array<number | null>(11).fill(null));
    const banks = new Set<number>();
    for (const floor of this.floors) {
      if (banks.has(floor.map.bank)) continue;
      banks.add(floor.map.bank);
      for (let row = 0; row < 13; row++) {
        for (let column = 0; column < 11; column++) {
          this.grid[floor.map.bank * 13 + row][column] = floor.map.rows[row][column];
        }
      }
    }
    const first = this.floors[0];
    const position = this.gridPosition(first.start);
    this.state = {
      currentFloor: first.floor,
      position: { row: position?.row ?? 39, column: position?.column ?? 11, scene: first.start, exitDirection: 0, spawnDirection: 0, entrySlot: 0 },
      checkpointPosition: null,
      roomEntryPlayer: null,
      checkpointPlayer: null,
      visited: Array<boolean>(150).fill(false),
      respawnScene: 0,
    };
  }

  get currentFloor(): number { return this.state.currentFloor; }
  get floor(): Floor { return this.floors.find(floor => floor.floor === this.state.currentFloor)!; }
  get position(): WorldPosition { return this.state.position; }

  // h0:bdfc first checks the resident directory; h0:bdaa then searches floor lists.
  getRoom(scene: number): Room {
    const resident = this.floor.rooms.find(room => room.scene === scene);
    if (resident) return resident;
    for (const floor of this.floors) {
      if (!floor.lookupScenes.includes(scene)) continue;
      const room = floor.rooms.find(room => room.scene === scene);
      if (!room) throw new Error(`AGA floor ${floor.floor} lists missing scene ${scene}`);
      this.state.currentFloor = floor.floor;
      return room;
    }
    throw new Error(`AGA scene ${scene} does not exist`);
  }

  // h0:bdaa(scene): the first floor whose g:293a scene list holds the scene becomes resident (h0:bcb8).
  loadFloorOf(scene: number): void {
    const floor = this.floors.find(floor => floor.lookupScenes.includes(scene));
    if (floor) this.state.currentFloor = floor.floor;
  }

  // h0:3650: first match in the 39-by-11 map, preserving unmapped-room failure.
  gridPosition(scene: number): { row: number; column: number } | null {
    for (let row = 0; row < 39; row++) {
      for (let column = 0; column < 11; column++) {
        if (this.grid[row][column] === scene) return { row, column };
      }
    }
    return null;
  }

  // h0:3f54: raw d2300201 uses column-table index d0.w*2+1 (extension 0201).
  gridDestination(scene: number, direction: number): number | null {
    const position = this.gridPosition(scene);
    if (!position) return null;
    direction = u8(direction);
    if (direction > 3) throw new Error(`AGA grid direction ${direction} is outside the direction table`);
    const row = position.row + (direction === 0 ? -1 : direction === 2 ? 1 : 0);
    const column = position.column + (direction === 1 ? 1 : direction === 3 ? -1 : 0);
    if (row < 0 || row >= 39 || column < 0 || column >= 11) return null;
    return this.grid[row][column];
  }

  // h0:784a and h0:12c26: room metadata includes scene 137's selector-33 override.
  liftDestination(scene: number, objectIndex: number): number | null {
    const room = this.getRoom(scene);
    const object = room.objects[objectIndex];
    if (!object || object.class !== "lift" || object.params.arrival) return null;
    const connection = this.floor.connections.find(edge => edge.kind === "lift" && edge.from === scene && edge.object === objectIndex);
    if (connection) return connection.to;
    const selector = scene === 137 ? 33 : object.params.destination;
    return 50 * Math.trunc((scene - 1) / 50) + selector + (selector === 1 ? 50 : 0);
  }

  // h0:44e0 -> h0:bdfc: load the room of a scene; the map row and column (g:8a22/23) are left as the caller set
  // them (h0:3edc exits, h0:43a6, the title and new game set them; a plain room change does not).
  enterRoom(scene: number): Room {
    const room = this.getRoom(scene);
    this.state.position.scene = scene;
    return room;
  }

  // h0:d38: save all six room-position bytes, not just scene and coordinates.
  saveRoomPosition(position: WorldPosition = this.state.position): void {
    this.state.checkpointPosition = copyPosition(position);
  }

  // h0:d4a: restoration does not itself load a pack or rebuild room objects.
  restoreRoomPosition(): WorldPosition {
    if (!this.state.checkpointPosition) throw new Error("AGA room checkpoint has not been saved");
    this.state.position = copyPosition(this.state.checkpointPosition);
    return this.state.position;
  }

  // h0:e6a: room-entry copy, distinct from the floor checkpoint at g:8610.
  savePlayerState(player: PlayerCheckpoint): void {
    this.state.roomEntryPlayer = copyPlayer(player);
  }

  // h0:e92: restore the most recent room-entry player state.
  restorePlayerState(player: PlayerCheckpoint): void {
    if (!this.state.roomEntryPlayer) throw new Error("AGA room-entry player state has not been saved");
    Object.assign(player, this.state.roomEntryPlayer);
  }

  // h0:e7e: only player globals are copied; room position has its own save call.
  saveCheckpoint(player: PlayerCheckpoint): void {
    this.state.checkpointPlayer = copyPlayer(player);
  }

  // h0:ea6: restore all thirty bytes of the floor's player checkpoint.
  restoreCheckpoint(player: PlayerCheckpoint): void {
    if (!this.state.checkpointPlayer) throw new Error("AGA player checkpoint has not been saved");
    Object.assign(player, this.state.checkpointPlayer);
  }

  // h0:d0c: restore checkpoint position/inventory and reset room visitation.
  restartFromCheckpoint(player: PlayerCheckpoint): WorldPosition {
    const position = this.restoreRoomPosition();
    this.restoreCheckpoint(player);
    this.state.visited.fill(false);
    this.state.respawnScene = 0;
    return position;
  }
}

// h0:d38/d4a: the scene byte is zero-based in AGA; public room numbers are one-based.
function copyPosition(position: WorldPosition): WorldPosition {
  return {
    row: u8(position.row), column: u8(position.column), scene: u8(position.scene - 1) + 1,
    exitDirection: u8(position.exitDirection), spawnDirection: u8(position.spawnDirection), entrySlot: u8(position.entrySlot),
  };
}

// h0:e6a/e7e: explicit named fields retain original byte and long widths.
function copyPlayer(player: PlayerCheckpoint): PlayerCheckpoint {
  return {
    lives: u8(player.lives), rescuedCount: u8(player.rescuedCount), buildingFloor: u8(player.buildingFloor),
    ammo: u8(player.ammo), throwableAvailable: u8(player.throwableAvailable), bombsFound: u8(player.bombsFound),
    spawnX: u8(player.spawnX), spawnY: u8(player.spawnY), spawnDirection: u8(player.spawnDirection),
    portableLaserCount: u8(player.portableLaserCount), slowMotionCount: u8(player.slowMotionCount), shieldCount: u8(player.shieldCount), carriedBombs: u8(player.carriedBombs),
    inventoryAvailability: u8(player.inventoryAvailability), slowMotion: u8(player.slowMotion), playerPadding: u8(player.playerPadding),
    slowMotionTime: s32(player.slowMotionTime), invulnerable: u8(player.invulnerable), shieldPadding: u8(player.shieldPadding),
    invulnerabilityTime: s32(player.invulnerabilityTime), paused: u8(player.paused), specialItemCollected: u8(player.specialItemCollected),
    floorSecurityState: u8(player.floorSecurityState), floorSecurityCode: u8(player.floorSecurityCode),
  };
}
