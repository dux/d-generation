# D/Generation data formats

Notes from reverse engineering the DOS release (`./dgener/GAME.EXE`, "D-Generation V0.62 Copyright 1991 Robert Cook").
Addresses are `segment:offset` in the load image; `DS:xxxx` is the data segment (paragraph `0x254b`).
All DOS words are little-endian.

## Sources

* `./dgener/` is the DOS game, read as-is by the viewer and by `bun run extract`.
* `./amiga/aga/` and `./amiga/ocs/` are the files from the Amiga disk images in `./amiga-src/`, unpacked once with amitools:

```sh
uv venv tmp/re-venv && uv pip install --python tmp/re-venv/bin/python amitools
tmp/re-venv/bin/xdftool "amiga-src/D-Generation (AGA)_Disk1.adf" unpack tmp/aga1   # repeat per disk
```

Disk 1 and disk 2 of each release are merged into one folder.

## Tools

* `bun dev` starts the viewer: rooms, sprite sheets, delta sets, music.
* `bun run extract` writes PNG sheets, rendered rooms and JSON metadata to `./out/`.
* `bun run check` type-checks.

## Palettes - `DATA/*.PAL`

3 bytes per color, 6-bit VGA DAC components.
`DGEN.PAL` and `TITLE.PAL` hold 256 colors.
`RED.PAL`, `GREEN.PAL` and `BLUE.PAL` hold 48 colors that replace DGEN colors 32..79 for the room color scheme (`0:149a`).
The room picks the scheme from its wall data: 0 = blue, 1 = green, 3 = red.
`*.LKP` files are only loaded for EGA and are not decoded.

## Sprites - `VGA/*.VGA`

Loader `0:0060`, tree builder `0:023f`.

| Offset | Size | Meaning |
|---|---|---|
| 0 | word | version (2) |
| 2 | word | header size |
| 4 | word | data size |
| 6 | word | number of shape sets (always 1) |
| 8 | ... | per set: id word, depth word, tree |

The tree is depth levels deep.
An inner node is a count word followed by its children; a leaf is a word offset into the data block that starts at the header size.
The set id indexes the global shape table at `DS:2e6e`, e.g. 30 `WALL`, 31 `WMSK`, 32 `TILE`, 34 `TWALL`.

A frame is `x`, `y`, `width`, `height` (bytes) followed by `width*height` palette indices.
Color 0 is transparent.
The meaning of `x` and `y` depends on the caller: walls draw at `y - frame.y`, floor tiles bottom-align with `y - height - frame.y`.

The Amiga `aga/*.aga` files use the same index tree, big-endian, with planar pixel data that is not decoded.

## Delta images - `DATA/DLTSET*.DAT`

Loader `0:c570`, drawer `0:c244`.
A file is `word (0)`, `entry count`, `data size`, `entry offsets[count]`, then the data.
An entry is `width` and `height` words and a flags byte (`0x80` = fill column by column), followed by commands until `0xffff`.

| Command | Operands | Effect |
|---|---|---|
| `0x0000 \| n` | color byte | run of `n` pixels |
| `0x2000 \| n` | dx word, dy byte, color byte | move cursor, then run |
| `0x4000 \| n` | `n` bytes | copy literal pixels |
| `0x6000 \| n` | dx word, dy byte, `n` bytes | move cursor, then copy |
| `0x8000 \| c` | - | one pixel of color `c` |
| `0xa000 \| c` | dx word, dy byte | move cursor, one pixel |

The cursor walks the entry box and stops when it leaves it.
Color `0xfc` shows the backdrop `BACK1.DAT` (320x200 raw, the city skyline) at the same screen position, which is how room windows look outside (`0:c522`).
`DLTSET0` is the title backdrop, `DLTSET1` and `DLTSET2` hold room decoration pieces, the rest are full-screen backgrounds for special rooms.
`DLTSET99` ends with entry offsets that point outside its data and is not used by the game.

## Rooms - `DATA/SCENE<n>.DLT`

Loader `0:354e`, room drawing `0:238a`.
Scenes 1-46, 51-92 and 101-142 exist.
A file is a 1072-byte block followed by chunks of `type word`, `size word`, data.

| Block offset | Meaning |
|---|---|
| `0x01e` | object records, 4 bytes each (not decoded) |
| `0x076` | room message, NUL-terminated |
| `0x096` | 13 rows x 10 columns of 7-byte cells, row stride 70 |

Each cell covers 28x14 screen pixels.
Cell `(row, col)` has its origin at `x = (col*14 - 2 + 10) * 2`, `y = row*14 - 2 + 4`.

| Cell byte | Meaning |
|---|---|
| 0 | wall bits `0x02`, `0x08`, `0x20`, `0x80` = directions 0..3 |
| 1 | floor line bits, one per direction of `DS:007e` |
| 2, 3 | per-bit selectors: line color, wall frame and scheme, byte 2 bit `<< 1` marks a tall wall |
| 4 | floor tile bits, one per quarter-tile slot of `DS:265c` |
| 5, 6 | per-bit tile variant (VGA only uses variant 3 or 0) |

| Chunk | Record | Meaning |
|---|---|---|
| `0x0a` | 5 bytes: index, x word, y word | delta piece; y bit 15 = foreground, bit 14 = hidden until a game event |
| `0x0b` | 8 bytes: x0, y0, x1 words, color, mode | dotted vertical drops along a 2:1 slope (`0:c015`) |
| `0x11` | 10 bytes: x0, y0, x1, y1 words, color word | three-pixel isometric lines (`0:c0d2`) |
| `0x0e` | blob | processed by `0:3771`, not decoded |

Rooms use `DLTSET1` for scenes up to 51 and `DLTSET2` above; the table at `DS:0470`/`DS:0484` gives special rooms their own set (scene 1 uses `DLTSET20`).

Drawing order (`0:238a`):

1. Floor tiles from cell byte 4 (`TILE.VGA`, `fff:1350`).
2. Floor lines from cell byte 1 (`0:e171`).
3. Background delta pieces.
4. Walls from cell byte 0 (`WALL.VGA`, `fff:190f`); frame 1 when the wall state is 2.
5. Tall wall tops (`TWALL.VGA`, 36 pixels higher).
6. Drop chunks, then line chunks.
7. Foreground delta pieces.

Scene 138 skips the walls and forces the red scheme.
Objects (doors, lifts, enemies, items) are drawn by the object system and are not decoded yet.

## Other DOS files

* `MAPMTX0..2.DAT`: the game reads the first 143 bytes of each (`0:3b9c`); `0xff` marks empty entries. The layout is not decoded.
* `DEMO*.SEQ`: recorded demo input, not decoded.

## Amiga files

* `aga/dgen.mod`, `aga/dgen2.mod`: OctaMED `MMD1` songs, played in the browser through chiptune3 (libopenmpt).
* `aga/amiga.eff`: raw 8-bit sound effect samples behind a small header (not decoded).
* `ocs/amiga.mus`, `ocs/amiga.eff`: 68000 replay code with embedded music and samples.
* `DATA/L1..L10.SCN`: per-level scene packs; little-endian count word, then `(scene word, offset dword)` entries pointing at scene blocks close to the DOS `SCENE*.DLT` layout.
* `*.VIM`, `*.AIM`: cutscene images (not decoded).
