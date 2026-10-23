# D/Generation data formats (AGA release)

Notes from reverse engineering the Amiga AGA release in `./amiga/aga/`.
`./amiga/aga/dgen` is "D/Generation V1.0 Copyright 1993 Robert Cook, Conversion by Abersoft Sep 17 1993", the final version of the game.
Addresses are `h<k>:<offset>` in the executable's hunks, globals `g:<h11 offset>` (see `./doc/porting.md`).
The DOS prerelease ("D-Generation V0.62 Copyright 1991", `GAME.EXE`, no longer in the repository) shares most formats; comments in the code still name its functions (`DOS 0:xxxx`) where the two releases have the same routine.

## Sources

`./amiga/aga/` holds the files from the two AGA disk images in `./amiga/adf/`, unpacked once with amitools and merged into one folder:

```sh
uvx --from amitools xdftool "amiga/adf/D-Generation (AGA)_Disk1.adf" unpack tmp/aga1   # repeat for disk 2
```

`./amiga/` is git-ignored.
A copy lives only on the local orphan branch `src` (a pre-push hook refuses to push it); `git restore --source=src --worktree -- amiga` brings it back.

## Tools

* `bun dev` starts the page: Play (the native game), and a viewer for rooms, sprite sheets and delta sets.
* `bun run extract:assets` converts everything the game loads into `./assets` (below); the game never reads `./amiga/aga`.
* `bun run extract:levels` turns the level packs into `./levels/floorNN.json5` and checks the round trip.
* `bun run truth:aga-rooms` draws every room with the original code in the harness (`./out/aga-truth/rooms/`); `bun run verify:aga-rooms` compares `./src/game/render/room.ts` with those captures.

`./tools/formats/` has the decoders of the original formats (used by the tools only), `./src/formats/` the formats the game reads: `level.ts`, `pack.ts` (`./assets`), `png.ts`, `delta.ts`, `palette.ts`, `sound.ts`.

## Converted assets - `./assets`

`./tools/extract-assets.ts` writes them and reads every file back through `./src/formats/pack.ts`, comparing it with the original decode; it needs ffmpeg with libopus.

| File | From | Format |
|---|---|---|
| `sprites/<bank>.png`, `.json` | `aga/<bank>.aga` | atlas PNG, grey = palette index, alpha = mask; JSON `sets` (id, tree of frame indexes) and `frames` (`[atlas x, atlas y, width, height, frame x, frame y]`) |
| `deltas/dltset<n>.png`, `.json` | `DATA/DLTSET<n>.DAT` | the pixels each entry's commands write, as a grey + alpha atlas; JSON `entries` (`[atlas x, atlas y, width, height, dx, dy]`, the offset from the drawing position) |
| `images/<name>.png` | `*.vim`, `BACK1.DAT`, executable hunk 9 | grey PNG of palette indexes: the 12 pictures by game name, `backdrop` (320x100), `cd32-keyboard` (219x69), `cd32-padmenu` (271x26) |
| `palettes.json` | `DATA/*.PAL` | 6-bit components by lower-case file name |
| `sounds/sampleNN.wav` | `amiga.eff` | 8-bit unsigned mono; the playback rate comes from the sound table |
| `music/<track>.ogg` | `dgen.mod`, `dgen2.mod` | one pass rendered with libopenmpt (chiptune3) at 48 kHz, Opus 96 kbit/s; the game loops it |
| `demos/demo<n>.json` | `DATA/DEMO<n>.SEQ` | `directions` (`time`, `direction`, `magnitude`) and `buttons` (`time`, `code`) |
| `config.json` | `DATA/DGEN.CFG` | its six big-endian words |

The browser decodes the PNGs itself (`./src/formats/png.ts`), because canvas decoding would turn indexes into colours.

## Levels - `DATA/L1..L10.SCN`, `DATA/MAPMTX0..2.DAT`

One pack per floor: a little-endian count word, then `(scene word, offset dword)` entries pointing at room blocks, each ended by a zero-size chunk.
A room block is 1072 bytes (object records at `0x1e`, room name at `0x76`, 13x10 cells of 7 bytes at `0x96`) followed by chunks of `type word`, `size word`, data: delta pieces (`0x0a`), drops (`0x0b`), lines (`0x11`) and survivor dialogue (`0x0e`).
The map files place scene numbers on a grid, one bank per group of floors.
All words are little-endian, also on the Amiga.
`./levels/README.md` documents every byte and the JSON5 schema.

## Compression - `DATA/BACK1.DAT`, `DATA/*.vim`

LZW (`h10:34a8..37c6`): a 4-byte little-endian uncompressed size, then an LSB-first bit stream of 9 to 12-bit codes.
256 clears the table, 257 ends the stream, the first free code is 258, and the code width grows when the next free code reaches 512, 1024 and 2048.
`BACK1.DAT` unpacks to the 320x100 chunky backdrop (the city skyline seen through room windows).
A `.vim` unpacks to a 320x200 image of 8 bitplanes, row-interleaved (row y, plane p at `(y*8 + p)*40`), shown with the `.pal` of the same name.

## Palettes - `DATA/*.PAL`

3 bytes per color, 6-bit components, loaded as `byte << 2` (`h0:cc9a`).
`DGEN.PAL`, `TITLE.PAL` and the image palettes hold 256 colors.
`RED.PAL`, `GREEN.PAL` and `BLUE.PAL` hold 48 colors that replace DGEN colors 32..79 for the room color scheme; the room picks it from its wall data (0 = blue, 1 = green, 3 = red).
The 48-color `SCENE114/139/145.PAL` replace the same range (`h0:131c`); `SCENE58.PAL` is a full palette.
`genoq2.pal` holds 32 OCS `0x0RGB` words and is not used by the AGA executable.

## Sprites - `aga/*.aga`

Loader `h0:278`, tree builder `h0:424`.

| Offset | Size | Meaning |
|---|---|---|
| 0 | word | version (2) |
| 2 | word | header size |
| 4 | word | data size (low 16 bits) |
| 6 | word | number of shape sets |
| 8 | ... | per set: id word, depth word, tree |

Words are big-endian.
The tree is depth levels deep: an inner node is a count word followed by its children, a leaf is a word offset into the data block that starts at the header size.
The set id indexes the global shape table, e.g. 30 `WALL`, 31 `WMSK`, 32 `TILE`, 34 `TWALL`.
`b1.aga` bundles 25 sets; its data is larger than 64 KB, so the loader adds 0x10000 to the data size (`h0:2ae`) and to leaf offsets below 0xf000 once a leaf above 0xf000 has been seen (`h0:4b4`).

A frame is `x`, `y`, `width`, `height` bytes and a flags word whose low byte has bit p set when bitplane p is stored.
Then come a mask plane and the stored planes in ascending order, each `height` rows of `(((width - 1) & 0xf0) + 16) / 8` bytes, most significant bit leftmost.
The blitter (`h10:16`) draws stored planes through the mask and clears missing planes under it, so color 0 under the mask would be opaque; no frame has such a pixel.
`h10:262` mirrors a frame horizontally.
The meaning of `x` and `y` depends on the caller: walls draw at `y - frame.y`, floor tiles (`h0:eae4`) at left `cellX + x`, top `cellY - height - y + 3`.

## Delta images - `DATA/DLTSET*.DAT`

Loader `h0:ca2a`, drawer `h0:11f24`.
A file is `word (0)`, `entry count`, `data size`, `entry offsets[count]`, then the data, little-endian.
An entry is `width` and `height` words and a flags byte (`0x80` = fill column by column), followed by commands until `0xffff`.

| Command | Operands | Effect |
|---|---|---|
| `0x0000 \| n` | color byte | run of `n` pixels |
| `0x2000 \| n` | dx word, dy byte, color byte | move cursor, then run |
| `0x4000 \| n` | `n` bytes | copy literal pixels |
| `0x6000 \| n` | dx word, dy byte, `n` bytes | move cursor, then copy |
| `0x8000 \| c` | - | one pixel of color `c` |
| `0xa000 \| c` | dx word, dy byte | move cursor, one pixel |
| `0xc000`, `0xe000` | - | end of the entry |

The cursor walks the entry box and stops when it leaves it.
Color `0xfc` shows the backdrop at the same screen position (`h0:1221e`), which is how room windows look outside, once the backdrop buffer is allocated (`g:87d4`).
The backdrop has 100 rows but is read at `y*320 + x`, so window pixels below row 100 show whatever memory follows it; scenes 3, 4, 10, 22, 104 and 109 have such pixels.
`DLTSET1`, `DLTSET2` and `DLTSET3` hold room decoration pieces by scene range; special rooms use their own set, and the others are full-screen backgrounds and cutscene pieces.

## Room drawing

Room drawing `h0:1250` runs once on room entry, before any object spawns; the order is:

1. Floor tiles from cell byte 4 (`TILE`).
2. Floor lines from cell byte 1.
3. Background delta pieces.
4. Walls from cell byte 0 (`WALL`); frame 1 when the wall state is 2.
5. Tall wall tops (`TWALL`, 36 pixels higher).
6. Drop chunks, then line chunks.
7. Foreground delta pieces.

Where two walls meet, the wall frame loses its first 4 or last 3 columns, depending on the walls in the same cell and in the cells to the left and right.
Unlike DOS there is no depth shading.
A drop column uses color + 2, draws one dot every `(mode & 7) + 1` rows over empty and `0xfd` pixels, and stops at anything else.
The play view is clipped at row 181.
Picture rooms (scenes 58, 103, 114, 139, 145) show a `.vim` image; scenes 58, 114, 138, 139 and 145 skip the walls and force their scheme, and scenes 107, 118, 120 and 128 set colors 224..231.
The scheme is not reset before drawing, so a room without a scheme-setting wall (scene 103) keeps the previous room's.

## Sound - `amiga.eff`, `dgen.mod`, `dgen2.mod`

`amiga.eff` is 202020 bytes of signed 8-bit samples without a header, loaded whole by `h0:c6f8`.
The executable holds the sample table at `h11:45e6` (30 entries of `length dword, offset dword`) and the sound table at `h11:44f6` (6-byte records `id, sample, oneShot, 0, period word`, ended by a negative id; 39 sounds).
`h0:1551a` plays a sound on Paula at volume 63 and `3546895 / period` Hz; only sounds 33 and 48 loop.
`dgen.mod` and `dgen2.mod` are OctaMED `MMD1` songs, played from their Opus renders in `./assets/music`.
The modules and `amiga.eff` share one buffer: `dgen.mod` plays on the first title pass, `amiga.eff` is loaded for every demo and game, and `dgen2.mod` plays in the good ending.

## Other files

* `DATA/DEMO50.SEQ`, `DATA/DEMO52.SEQ`: the attract demos, 500 six-byte direction records followed by 900 five-byte button records.
* `DATA/DGEN.CFG`: 12 bytes the game checks at boot (`./src/game/ui/save.ts`).
