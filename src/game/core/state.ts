import { createScreenState } from "../ui/screen.ts";
import { createTalkState } from "../ui/talk/state.ts";
import { createInputState } from "./input.ts";
import type { GameState } from "./model.ts";
import { AgaRandom } from "./random.ts";
import { AgaTimers } from "./timers.ts";

// h0:e4e/h0:1730: cleared native globals and the five-life, floor-80 player state.
export function createState(): GameState {
  return {
    sceneIndex: 0, roomChange: 0, frameTicks: 0,
    movementTicks: 0, movementScale: 0, frameCounter: 0, syncCounter: 0,
    demoClock: 0, demoPlayback: 0, demoRecording: 0, demoIndex: 0,
    demoPending: 0, attractIndex: 0, attractVariant: 0,
    directionIndex: 0, demoButton: 0, demoDirection: 0, demoMagnitude: 0,
    titleRequested: 0, menuRequested: 0, abortFrame: 0, suppressPlayer: 0, paused: 0,
    slowMotion: 0, slowFrameTicks: 0, ammo: 0, throwableAvailable: 0,
    useDisabled: 0, carriedBombs: 0, deathPending: 0, slowMotionTime: 0,
    lives: 5, buildingFloor: 80, bombsFound: 0,
    bomberActive: 0, bomberMinutes: 0, bomberSeconds: 0,
    bomberMinuteTime: 0, bomberSecondTime: 0, endingTime: 0,
    nextObjectId: 1, player: null, currentObject: null, postObject: null,
    receiver: null, sender: null, spawned: null,
    frameTimer: 1, roomTimer: 5,
    visited: Array<boolean>(150).fill(false), survivorIndex: 0,
    portableLaserCount: 0, shieldCount: 0, doorSaveSlots: 0, scrollX: 49, scrollY: 28,
    roomLeft: 59, roomTop: 32, roomWidth: 160, roomHeight: 200,
    round: 2,
    occupancy: new Uint8Array(56 * 54), occupancyScene: -1,
    generatorOverride: 0, frontShapeSet: 0,
    paletteTop: 0, paletteBottom: 0, paletteColor: 0, slowMotionCount: 0, rescuedCount: 0,
    spawnX: 0, spawnY: 0, spawnDirection: 0, inventoryAvailability: 0,
    playerPadding: 0, invulnerable: 0, shieldPadding: 0,
    invulnerabilityTime: 0, specialItemCollected: 0, floorSecurityState: 0,
    floorSecurityCode: 0, cubeItems: [], roomResilience: Array<number>(150).fill(0),
    flashTimer: 2, flashMessage: 255, paletteTimer: 4, paletteStep: 0, forceRedraw: 0, gorePending: 0,
    goreEntry: 0, goreX: 0, goreY: 0, goreShown: 0, dgenPalette: 0, backgroundDirty: 0,
    roomEffect: 0, collisionHandled: 0, shakeScript: [128], shakeRestoreScript: [128],
    roomAlert: 0,
    messageText: "", messageTime: 0, messageFont: 0, textColor: 0, messageShown: 0, messageTimer: 0,
    messageX: 0, messageY: 0, panelTop: 169, drawnScene: 0, playerPalette: 255, copyrightPending: 1, clipBottom: 181, panelText: "",
    arrivalShown: 0, titleAnimation: 0, padItem: 0, padDisplay: [],
    screen: createScreenState(), storyShown: 0, savedClip: 0, textCursor: 0, musicClock: 0,
    music: { loaded: null, playing: 0, endClock: 0 }, endingId: 0, endingAlt: 0,
    oneLifePending: 0, restoredPending: 0, exitReached: 0, cheatArmed: 0, muted: 0, keyToggle: 0,
    playfieldKey: 0, playfieldKeyPending: 0, talking: 0, input: createInputState(), talk: createTalkState(), delayTimer: 3,
    chaserX: 0, chaserY: 0, waitSteps: 0, redFlash: 0, redFlashLevel: 0, paletteRotation: 0, demoSequence: 50,
    random: new AgaRandom(), timers: new AgaTimers(),
  };
}
