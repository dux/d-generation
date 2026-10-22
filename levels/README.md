# AGA floors

`./levels/floor01.json5` through `./levels/floor10.json5` contain the ten AGA SCN packs as editable data.
`bun run extract:levels` regenerates them from `./amiga/aga/DATA/`, reads the emitted JSON5 back, and asserts byte-identical room blocks, complete SCN packs, and all 256 bytes of each MAPMTX file.
Regeneration overwrites edits to these generated files.
The native game (`./src/game/`) reads these files directly, so edits here change the game.

## API

`./src/formats/level.ts` exports `Floor`, `FloorMap`, `Room`, `Cell`, `ObjectClass`, `ObjectSpec`, `Piece`, `Drop`, `Line`, `Dialogue`, `Topic`, `Reply`, `RoomChunk`, and `UnknownBytes`.

* `parseFloor(text)` uses `json5`, checks the format/floor, and validates room encodability.
* `stringifyFloor(floor)` emits commented ASCII JSON5, compact cell legends, and one cell row per line.
* `decodeRoomBlock(bytes)` decodes one complete on-disk block, its ordered chunks, the zero-size terminator, and any following bytes.
  The SCN directory supplies `room.scene`; the block itself does not contain that number, so decoding initializes it to zero.
* `encodeRoomBlock(room)` reverses that representation without retaining an opaque original block.
* `decodeMap(bytes, bank)` and `encodeMap(map)` preserve the full MAPMTX file.

All SCN words and dwords are little-endian, including on Amiga.
Text uses exact 8-bit code points rather than WHATWG `latin1`, which would remap bytes 0x80..0x9f to Windows-1252 characters.
The emitter escapes non-ASCII characters.

## Floor and map structure

| Pack | Building floor | Rooms | Start scene | Other arrival |
|---|---:|---:|---:|---:|
| L1 | 80 | 13 | 1 | |
| L2 | 81 | 13 | 14 | |
| L3 | 82 | 12 | 30 | |
| L4 | 83 | 7 | 24 | |
| L5 | 84 | 13 | 51 | |
| L6 | 85 | 10 | 74 | |
| L7 | 86 | 12 | 71 | 76 |
| L8 | 87 | 13 | 101 | |
| L9 | 88 | 16 | 125 | |
| L10 | 89 | 12 | 133 | |

`floor` is the pack number, `buildingFloor` is the sequential game floor, `start` is the primary initial/arrival scene, and `starts` includes alternate arrival-lift scenes.
Building floor 80 is initialized at AGA `h0:e4e..e68`; floor transitions increment it at `h0:4348..43a4`.
Starts after the first are identified by arrival-lift records, not by the first room in a pack.
In particular, L9 starts in scene 125 rather than scene 102, and L10 starts in scene 133 rather than scene 103.

`rooms` preserves directory order.
`lookupScenes` records the executable's floor lookup lists at h11:293a, ten rows of twenty BE words with zero tails omitted.
All ten lists were checked against the SCN directory scene lists and match exactly, including duplicated scene 103.
AGA `h0:bcb8` loads a pack, `h0:bdaa` searches those executable lists in order, and `h0:bdfc` first tries the currently resident pack before invoking that search.
The shared context's description of `h0:bdfc` as the MAPMTX loader is incorrect: the actual MAPMTX loader is `h0:c4cc`, called through the `h0:30f2` stub.

`map.bank` selects MAPMTX0 for packs 1..4, MAPMTX1 for packs 5..7, and MAPMTX2 for packs 8..10.
Each file contains thirteen rows of eleven bytes; the engine concatenates the three banks vertically into a 39x11 grid.
`map.rows` stores one-based scene numbers, not on-disk bytes: scene = byte + 50*bank + 1; `null` means byte 255.
`map.unknown` preserves bytes 143..255, which the AGA/DOS map loaders do not read.
A bank intentionally contains scenes belonging to several floor files.
AGA evidence: `h0:c4cc`, `h0:f1f8`, `h0:3650`; DOS equivalents: `loadMaps` (`0:3b9c`), `offsetRows` (`fff:1d22`), `findInGrid` (`0:bd8c`).

`connections` records three kinds of transition metadata:

* `grid`: a neighboring nonempty map entry, directions 0..3 = north/east/south/west.
  These are map-routing candidates, not a claim that the player can cross every boundary: collision, doors, and game state still gate exits.
  AGA `h0:3f54` and direction bytes at h11:90a establish the rule.
* `lift`: departure lift, its zero-based object-array index, effective destination selector, and destination scene.
  Arrival lifts are not departure edges.
  Formula: `50*trunc((scene-1)/50) + selector + (selector === 1 ? 50 : 0)`.
  AGA `h0:784a..78a2`; DOS `0:61d1`.
* `special-exit`: scene 114 routes to scene 133 at AGA `h0:3f5c..3fa6` regardless of normal map adjacency.
  The DOS destination differs: scene 122.

Scene 137's lift uses effective selector 33, overriding disk selector 11 at AGA `h0:12c26..12c38`.
This routes it to scene 133, not DOS scene 136 (override 36).
The original disk selector remains in the object parameters for binary round trips.
The lift progression is 13->14, 25->30, 30->24, 5->51, 73->74, 56->76 or 89->71, 66->101, 109->125, 137->133.
Map scenes 52 and 53 have no scene block in these ten packs; scene 142 has a block but no MAPMTX position.
No missing scene is synthesized.

### Shared scene 103

Scene 103 occurs in the SCN directories and executable lookup rows for L8, L9, and L10.
Each complete block is 1076 zero bytes, including its type 0/size 0 terminator; all three are byte-identical.
AGA countdown-expiry paths enter scene 103 at `h0:908..90a` and `h0:988..98a`; another special sequence does so at `h0:7516..7518`.
It is therefore a shared blank special-sequence destination, not three distinct playable room designs.
The resident-pack lookup preserves the L9/L10 copies; fallback lookup chooses L8 because its matching table row comes first.
Keeping copies in the late-game resident packs avoids requiring a pack switch on these paths; that motivation is inferred from the loader, rather than documented by a source comment.

## Room block

| Offset | JSON5 representation | Evidence/status |
|---|---|---|
| 0x00..0x1d | `unknown: [{at:0, bytes:...}]` | All thirty bytes zero in all 121 occurrences; copied to g:8e48 at `h0:bee0..beee`; no other direct global references found. Meaning unconfirmed. |
| 0x1e..0x75 | `objects`, then unknown padding | Twenty-two four-byte record slots; decoded class 0 stops spawning; DOS `spawnObjects` (`0:1656`), AGA `h0:21a6`. Unused slots, including stale records after the terminator, remain exact hex. |
| 0x76..0x95 | `message`, then unknown padding | 32-byte NUL-terminated room name; DOS `showRoomName` (`0:2319`), AGA loader `h0:bf22..bf30`. |
| 0x96..0x423 | `cellLegend` and `cells` | 13x10 seven-byte cells; AGA `h0:bf34..c052` expands them to eight-byte native cells and swaps the selector words. |
| 0x424..0x42f | unknown bytes | All twelve bytes zero in all 121 occurrences; copied to g:92ee at `h0:c056..c064`; no other direct global references found. Meaning unconfirmed. |
| 0x430 onward | ordered `chunks`, `terminator`, `afterTerminator` | AGA `h0:c0f4..c120` stops on any size 0 header, irrespective of its type. |

Scene 42 in L3 has terminator type 255, size 0, followed by 1232 zero bytes before the next directory entry.
`terminator:255` and `afterTerminator` preserve this, and the latter moves with the end of the chunk stream when editing decorations.
Unknown data is explicit, not an override hiding the semantic fields.

## Objects

The encoded class is `(byte0 & 15) | ((byte0 & 128) >> 3)`.
The loader rewrites encoded class 19 to class 21; JSON uses `class:"bar", encodedClass:19` for that alias and preserves the original bytes.
AGA `h0:1880..189c` accepts thirty direct-creation classes, although the supplied active room records only use classes 1,2,3,4,6,7,8,9,10,11,13,14,15,18,19,22.
No unobserved meaning is assigned to AGA classes 27..29: unknown classes retain all parameter bits.

Object `x`/`y` are world positions, not cell row/column.
Normally they are unsigned integer bytes 1/2, and `params.orientation` is byte 0 bits 4..6.
ORB, TUB, and BAR instead use those bits for x fractions; their x/y are exact multiples of 1/16, with `params.facing` in byte 3 bits 0..2.
Fraction decode: `xf=(byte0&0x70)|((byte3&8)<<4)`, `yf=byte3&0xf0`, position=`integer+fraction/256`.
Evidence: DOS `readRecordFine` (`0:471d`) / `writeRecordFine` (`0:4693`), AGA generic placement `h0:18d8..1930`.

The table describes byte 3 after shifting each named field down to bit 0.
Boolean-like fields are numeric 0/1; `initialOpenBits` is 0..3 and `action` is 0..3.
Every unused slice remains a named `unknownArgument` or `unknownOrientation`; these must not be discarded.

| Class | Name | Named byte 3 fields | DOS reference |
|---:|---|---|---|
| 1 | sur-marker | `kind`:bits 0..7; orientation ignored | `0:81ed` |
| 2 | door | `side`:0..1, `group`:2..4, `initialOpenBits`:5..6, `blownOpen`:7 | `0:6abb`; AGA `h0:7292` |
| 3 | tel | `linkId`:0..1; unknown 2..7 | `0:4a69` |
| 4 | switch | `group`:0..2, `secondGroupOrFloor`:3..5, `action`:6..7 | `0:7a0d`, `0:7aba`; AGA `h0:12ccc` |
| 5 | squ | unknown 0..7 | `0:4e30` |
| 6 | orb | `facing`:0..2; remaining bits encode position | `0:3c4a`, `0:471d` |
| 7 | cub | `kind`:0..2, unknown 3..4, `state`:5..7 | `0:8c57` |
| 8 | entry | unknown 0..7; orientation selects entry slot | `0:3c49`, `0:179c` |
| 9 | sur | `protected`:0, `conversationFlags`:1..7 | `0:9c17`; AGA `h0:6de2` |
| 10 | trk | `group`:0..2, `facing`:3..5, `stateBit6`:6, `fixedFacing`:7 | `0:7249` |
| 11 | art | `kind`:0..2, `parameter`:3..5, unknown 6..7 | `0:7fce` |
| 12 | dec | unknown 0..7 | `0:a184` |
| 13 | ven | `creatureKind`:0..1, `hostileLimit`:2..3, `frameAndPeriodIndex`:4..5, `off`:6, unknown 7 | `0:4f58` |
| 14 | pan | `onStep`:0..2, `offStep`:3..5, `speedIndex`:6..7 | `0:83d7` |
| 15 | tub | `facing`:0..2; remaining bits encode position | `0:731a`, `0:471d` |
| 16 | elc | unknown 0..7 | `0:8088` |
| 17 | exp | `variant`:0..7 | `0:7c0a` |
| 18 | lift | `arrival`:0, `destination`:1..5, unknown 6..7; orientation ignored | `0:63ee`; AGA `h0:12c00` |
| 19/21 | bar | `facing`:0..2; remaining bits encode position | alias `0:1656`, BAR `0:3d6e` |
| 20 | laser | unknown 0..7 | `0:3c9f` |
| 22/26 | cgen/dgen | unknown 0..5, `dormant`:6, `playerTriggered`:7 | `0:a0e8` |
| 23 | sli | unknown 0..7 | `0:6f3f` |
| 24 | hed | unknown 0..7 | `0:a1ac` |
| 25 | anm | unknown 0..7 | `0:a2fb` |

Door open bits must remain two separate bits: either nonzero means initially open, despite the misleading DOS comment that labels bit 5 closed.
Side 3 normalizes to 2, while group 7 forces side 3; keep the authored side/group rather than normalizing disk data.
Switch actions 0/1/2/3 mean toggle/close/open/close plus bomb gate.
SUR byte 3 bits 1..7 are state flags, not a conversation-profile index.
AGA `h0:6eda..6f12` gates them by visited-scene state and makes nonzero shifted flags hostile, disabling idle modes/answers and clearing the profile pointer.
Profiles bind to SUR objects in spawn order, not through byte 3.

## Cells

Each room uses a local `cellLegend` of editable `Cell` objects and thirteen `cells` strings containing ten space-separated legend names.
Names can be changed; there is no fixed palette size.

* `walls`: direction indexes 0..3 corresponding to byte 0 bits 1,3,5,7.
  Non-wall bits 0,2,4,6, if present, are retained as `unknownWallBits`.
  They are zero throughout the supplied files.
* `floorLines`: byte 1 bit indexes 0..7, using the eight isometric line directions.
* `wallLineSelectors`: eight digits 0..3, bit 0 first, encoding byte 2 bit + twice byte 3 bit.
  For wall direction d, lane 2*d+1 gives wall scheme/frame; low bit of lane 2*d gives tall-wall state.
  Wall states 0/1/3 select blue/green/red scheme; state 2 selects the alternate frame.
  A line at bit i uses the current lane plus the previous lane's low bit as color bit 2.
  Keep unused selector lanes: the data contains nonzero selectors even where no current wall/line is drawn.
* `tiles`: byte 4 bit indexes 0..7, the eight quarter-tile slots.
* `tileVariants`: eight digits 0..3, bit 0 first, encoding byte 5 bit + twice byte 6 bit.
  All variants are preserved, including 1/2 which the DOS VGA drawer collapses to 0.

Evidence: DOS `drawFloor` (`fff:1350`), `wallKind` (`fff:187f`), `drawWalls` (`fff:190f`), `drawAllTallWalls` (`fff:1abe`), floor-line drawer `0:e171`, and `./doc/formats.md`.
AGA disk/native conversion is independently confirmed at `h0:bf78..c042`; rendering equivalence is not claimed here.

## Ordered chunks

* `kind:"pieces"` is type 0x0a, stride 5: `index`, signed 16-bit `x`, low 14-bit `y`, `foreground` (bit 15), `offscreen` (bit 14).
  In the renderer, a foreground piece with bit 14 set retains bit 15 as a signed negative y; otherwise bit 15 is stripped and bit 14 pushes the piece below the screen.
  Evidence: DOS `0:c174`, AGA loader `h0:c1ac..c280`.
* `kind:"drops"` is type 0x0b, stride 8: unsigned 16-bit `x0,y0,x1`, byte `color`, packed mode split into `spacing` 1..8, `upward`, `step` 1..8, `rising`.
  The original column renderer clamps effective spacing 8 to 7; an authored 8 is retained.
  Evidence: DOS `0:c015`, VGA `23ac:012f`; AGA loader `h0:c122..c1ac`.
* `kind:"lines"` is type 0x11, stride 10: unsigned 16-bit `x0,y0,x1,y1`, byte `outer`, byte `inner`.
  Evidence: DOS `0:c0d2`, AGA loader `h0:c280..c36c`.
* Each fixed-record chunk can retain an incomplete trailing record in `unknown` hex.
* `kind:"dialogue"` is type 0x0e, detailed below.
* `kind:"unknown"` preserves an unrecognized type and its payload as hex.

Chunk order is never reconstructed from grouped arrays, so repeated/unknown chunk placement is preserved.

## Survivor dialogue (type 0x0e)

DOS `relocateChunk` (`0:3771`) describes the disk layout; AGA `h0:11b88` converts it to its larger native structure.
The JSON schema represents the compact disk form, never relocated native pointers.

| Disk offset | Field |
|---|---|
| 0..1 | `unknownPrefix`: two bytes as hex, meaning not established |
| 2,3 | `palette1`, `palette2`: DOS palette arguments; retained even though AGA SUR initializer does not use them directly |
| 4 | `appearance` |
| 5 | `patience`: behavior/attack-timing parameter |
| 6 | `speed`: animation/speed selector |
| 7 | `initialMode`:0 hunting,1 idle/fidget,2 alternate idle |
| 8 | `behavior`: neutral name for behavior/animation subtype |
| 9 | `interaction`: player interaction type |
| 10 | `grabMode`:255 disables grabbing;1 uses carry branch |
| 11 | `answerAllowance` |
| 12..251 | Twenty `topics`: `textOffset` plus five 1-based `replies` indexes; zero terminates active entries |
| 252 | `wakeTextOffset` |
| 254 | `interactionTextOffset` |
| 256 | Reply count, derived from `replies.length` |
| 258 onward | 26-byte `replies`: `textOffset`, six `responses` text offsets, six `nextTopics` words |
| After replies | `textPool`: exact 8-bit text and NUL separators, including control codes and unused tails |

Text offsets are one-based byte offsets into `textPool`; zero means no text.
Array tails are preserved even after a zero sentinel.
Offsets stay explicit to retain overlapping/shared strings and arbitrary original pool layout; when changing a string length, adjust later text offsets accordingly.
This is a deliberate fidelity/editability tradeoff, not a claim that text offsets are automatic references.

Metadata evidence: DOS `surInit` (`0:9c17`), AGA `h0:6e7c..6eca`.
Wake/interaction strings: DOS `surWake` (`0:94a1`), `surFindTarget` (`0:97b7`).
Topics/replies: DOS `talk` (`0:a3ee`), `buildVisibleItems` (`0:a6a9`), `drawMenuItem` (`0:adf7`), `optionCount` (`0:ad5a`), `menuSelect` (`0:a9bc`).
Text control codes `#d`, `~d`, `_kd`, and `&d` affect state/inventory/visibility/answer allowance and remain verbatim in the pool; see `./src/game/ui/talk/talk.ts`.

## Evidence limits

Binary identity is verified for all supplied rooms/maps, not just selected samples.
Most per-class names and behavior descriptions come from the readable DOS initializers, checked against the AGA disassembly.
Every class initializer now runs in the native game and is compared with the original in lockstep scenarios (`./doc/porting.md`).
Unknown header/tail bytes, unused object fields, dialogue prefix, and MAPMTX suffix bytes retain explicit unknown labels.
