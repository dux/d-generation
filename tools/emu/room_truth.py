"""Draws every room with the original GAME.EXE and saves the static room image as ground truth.

Writes out/truth/SCENE<n>.bin (320x200 palette indices, before objects are drawn) and out/truth/schemes.json.
Usage: uv run --with unicorn tools/emu/room_truth.py
"""
import json
import os
import struct

from unicorn import UC_HOOK_CODE, UcError

from dosemu import Dos, LOAD

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'out', 'truth')
SCENES = [*range(1, 47), *range(51, 93), *range(101, 143)]

LOAD_SCENE = 0x354e  # (scene index)
DRAW_ROOM = 0x238a  # (0) static room into the back buffer
DS_BACK_BUFFER = 0x27cc  # segment of the 320x200 back buffer
DS_SCENE_INDEX = 0x337e
DS_SCHEME = 0x272e


def boot():
    """Runs the game until its first room is about to be drawn, so every subsystem is initialised."""
    emu = Dos()
    entry = LOAD * 16 + DRAW_ROOM
    reached = []

    def stop(mu, addr, size, _):
        reached.append(1)
        emu.halt = True
        mu.emu_stop()

    hook = emu.mu.hook_add(UC_HOOK_CODE, stop, None, entry, entry)
    while not reached:
        emu.run(1)
    emu.mu.hook_del(hook)
    emu.mu.ctl_flush_tb()
    return emu


def draw(emu, n):
    ds = emu.ds() * 16
    back = struct.unpack('<H', emu.mu.mem_read(ds + DS_BACK_BUFFER, 2))[0] * 16
    emu.mu.mem_write(back, bytes(64000))
    emu.call(LOAD_SCENE, n - 1)
    emu.mu.mem_write(ds + DS_SCENE_INDEX, bytes([n - 1]))
    emu.call(DRAW_ROOM, 0)
    return bytes(emu.mu.mem_read(back, 64000)), struct.unpack('<H', emu.mu.mem_read(ds + DS_SCHEME, 2))[0]


def main():
    os.makedirs(OUT, exist_ok=True)
    schemes = {}
    emu = boot()
    for n in SCENES:
        try:
            pixels, scheme = draw(emu, n)
        except (RuntimeError, UcError):
            # A long run of injected calls can exhaust the game's heap; a fresh boot fixes it.
            emu = boot()
            pixels, scheme = draw(emu, n)
        with open(os.path.join(OUT, f'SCENE{n}.bin'), 'wb') as f:
            f.write(pixels)
        schemes[n] = scheme
    with open(os.path.join(OUT, 'schemes.json'), 'w') as f:
        json.dump(schemes, f)
    print(f'wrote {len(SCENES)} rooms to {OUT}')


if __name__ == '__main__':
    main()
