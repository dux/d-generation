"""Draws every room of every AGA floor with the original dgen and saves the static room images.

For each pack L1..L10 the original pack loader runs, then for every scene of its directory (in order)
the room loader and the room drawing, exactly as the game enters a room, minus objects:
  h0:d1b0 clears the draw buffer (h0:43a6 does the same before loading a room),
  h0:bdfc loadRoom(scene index) fills the room globals from the resident pack,
  h0:1250 drawRoom(1) draws tiles, floor lines, delta pieces, walls, drops and lines into the
  draw buffer (BitMap g:df00, planes at g:de5c) and loads the colour scheme.
The colour registers start from the game's base palette (DGEN.PAL, table g:dafa) for every room,
so each capture shows only that room's own palette changes.

Writes out/aga-truth/rooms/floorNN-sceneNNN.bin (320x200 palette indices), .pal (256 x 8-bit RGB,
the colour registers after drawing), .undef (LE uint32 pixel indices that copy backdrop pixels from
memory outside the BACK1 buffer, see BackdropProbe; only for rooms that have them) and rooms.json
(floor, scene, scheme g:19dc, delta set g:2b44, blit count, undefined pixel count).
Usage: uv run --with unicorn --with capstone python tools/m68k/room_truth.py [floor...]
"""
import json
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.m68k_const import UC_M68K_REG_A0, UC_M68K_REG_D0, UC_M68K_REG_D5, UC_M68K_REG_PC

from amigaemu import Amiga, GAME, OUT, DATA, RETURN, s16
from hunk import HUNKS, label

ROOMS = OUT / 'rooms'
H0 = HUNKS[0].base
DRAW_ROOM = H0 + 0x1250  # (d0 = show) static room into the draw buffer
LOAD_PACK = H0 + 0xbcb8  # (d0 = pack 1..10) L%d.SCN directory and blocks
LOAD_ROOM = H0 + 0xbdfc  # (d0 = scene index) room globals from the resident pack
BACKDROP_READ = H0 + 0x1224e  # move.b (a0),d5: backdrop pixel for delta colour 0xfc
BACKDROP_LOADED = H0 + 0x12250  # the instruction after it, also reached by other colours
CLEAR_DRAW = H0 + 0xd1b0  # BltClear of the draw buffer
CURRENT_ROOM = 0x4e4  # loaded scene index word, bdfc skips a reload when it matches
SCENE = 0x8a24
SCHEME = 0x19dc
DELTA_SET = 0x2b44
DRAW_BITMAP = 0xdf00
BASE_PALETTE = 0xdafa


def boot():
    """Runs the game until it first enters h0:1250, so every subsystem is initialised."""
    emu = Amiga()
    hit = []

    def stop(mu, at, size, _):
        hit.append(at)
        emu.stop = 'room'
        mu.emu_stop()

    hook = emu.mu.hook_add(UC_HOOK_CODE, stop, None, DRAW_ROOM, DRAW_ROOM)
    while not hit:
        kind = emu.execute()
        if kind == 'tick':
            emu.tick()
        elif kind == 'frame':
            emu.frames += 1
        elif kind != 'room':
            raise RuntimeError(f'boot stopped: {kind}')
        emu.skip = emu.r(UC_M68K_REG_PC)
    emu.mu.hook_del(hook)
    emu.mu.ctl_flush_tb()
    return emu


def invoke(emu, pc, d0=0):
    """Calls a game function on the current stack; timer polls inside it get their ticks."""
    context = emu.mu.context_save()
    emu.push(RETURN)
    emu.w(UC_M68K_REG_D0, d0)
    emu.w(UC_M68K_REG_PC, pc)
    emu.skip = None
    try:
        while (kind := emu.execute()) != 'return':
            if kind != 'tick':
                raise RuntimeError(f'{label(pc)} stopped at {label(emu.r(UC_M68K_REG_PC))}: {kind}')
            emu.tick()
            emu.skip = emu.r(UC_M68K_REG_PC)
    finally:
        emu.mu.context_restore(context)
        emu.skip = None


def pack_scenes(floor):
    """Scene numbers of L<floor>.SCN in directory order (LE count, then scene word, offset dword)."""
    path = next(p for p in (GAME / 'DATA').iterdir() if p.name.lower() == f'l{floor}.scn')
    data = path.read_bytes()
    count = struct.unpack_from('<H', data, 0)[0]
    return [struct.unpack_from('<H', data, 2 + i * 6)[0] for i in range(count)]


class BackdropProbe:
    """Watches h0:1221e, which copies backdrop pixels for delta colour 0xfc from the 32000-byte BACK1 buffer
    (pointer h3:34) at a sign-extended 16-bit offset. Reads outside the buffer see whatever memory lies
    there, which on the real machine is unknown; with flip set they get every bit inverted, so a second
    drawing shows exactly which pixels depend on them."""

    def __init__(self, emu):
        self.emu = emu
        self.flip = False
        self.outside = 0
        self.pending = False
        self.buffer = emu.u32(HUNKS[3].base + 0x34)
        emu.mu.hook_add(UC_HOOK_CODE, self.read, None, BACKDROP_READ, BACKDROP_READ)
        emu.mu.hook_add(UC_HOOK_CODE, self.loaded, None, BACKDROP_LOADED, BACKDROP_LOADED)

    def read(self, mu, at, size, _):
        self.pending = not self.buffer <= self.emu.r(UC_M68K_REG_A0) < self.buffer + 32000
        self.outside += self.pending

    def loaded(self, mu, at, size, _):
        if self.pending and self.flip:
            self.emu.w(UC_M68K_REG_D5, self.emu.r(UC_M68K_REG_D5) ^ 0xff)
        self.pending = False


def draw(emu, scene):
    """The room as h0:43a6 enters it, from the base palette; returns the draw buffer's pixels."""
    emu.put16(DATA + CURRENT_ROOM, 0xffff)
    invoke(emu, CLEAR_DRAW)
    invoke(emu, LOAD_ROOM, scene - 1)
    emu.mu.mem_write(DATA + SCENE, bytes((scene - 1,)))
    emu.load_rgb32(emu.u32(DATA + BASE_PALETTE))
    invoke(emu, DRAW_ROOM, 1)
    return emu.bitmap_pixels(emu.u32(DATA + DRAW_BITMAP))


def main():
    floors = [int(a) for a in sys.argv[1:]] or list(range(1, 11))
    ROOMS.mkdir(parents=True, exist_ok=True)
    emu = boot()
    probe = BackdropProbe(emu)
    index = []
    for floor in floors:
        invoke(emu, LOAD_PACK, floor)
        for scene in pack_scenes(floor):
            name = f'floor{floor:02d}-scene{scene:03d}'
            blits = emu.blits
            probe.outside = 0
            pixels = draw(emu, scene)
            entry = {'floor': floor, 'scene': scene, 'name': name,
                     'scheme': s16(emu.u16(DATA + SCHEME)),
                     'deltaSet': s16(emu.u16(DATA + DELTA_SET)),
                     'blits': emu.blits - blits, 'undefinedPixels': 0}
            (ROOMS / f'{name}.bin').write_bytes(pixels)
            (ROOMS / f'{name}.pal').write_bytes(emu.palette_rgb())
            if probe.outside:
                probe.flip = True
                flipped = draw(emu, scene)
                probe.flip = False
                undefined = [i for i, (a, b) in enumerate(zip(pixels, flipped)) if a != b]
                entry['undefinedPixels'] = len(undefined)
                if undefined:
                    (ROOMS / f'{name}.undef').write_bytes(struct.pack(f'<{len(undefined)}I', *undefined))
            index.append(entry)
            print(json.dumps(entry), flush=True)
    (ROOMS / 'rooms.json').write_text(json.dumps(index, indent=1) + '\n')
    print(f'wrote {len(index)} rooms to {ROOMS}')


if __name__ == '__main__':
    main()
