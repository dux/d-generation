"""Captures full 1 MB memory snapshots of the original game in real rooms, for function-level differential tests.

For every scene the demo is redirected into that room; after the first frames are drawn the emulator stops at the
top of the main loop (0:1b35) and memory is saved to out/snapshots/SCENE<n>-<frame>.bin.gz with registers in a JSON.
Usage: uv run --with unicorn tools/emu/snapshot.py [frames per room] [scene...]
"""
import gzip
import json
import os
import struct
import sys

from unicorn import UC_HOOK_CODE, UcError
from unicorn.x86_const import UC_X86_REG_SP, UC_X86_REG_SS

from dosemu import LOAD
from room_truth import SCENES, boot

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'out', 'snapshots')
MAIN_LOOP = 0x1b35  # top of the game loop: room change check
DS_SCENE_INDEX = 0x337e
DS_ROOM_CHANGE = 0x33f2


class Session:
    def __init__(self):
        self.emu = boot()
        self.ds = self.emu.ds() * 16
        self.request = None
        self.loops = 0
        self.stop_after = None
        self.emu.mu.hook_add(UC_HOOK_CODE, self.on_loop, None, LOAD * 16 + MAIN_LOOP, LOAD * 16 + MAIN_LOOP)
        self.emu.mu.ctl_flush_tb()

    def on_loop(self, mu, addr, size, _):
        if self.request is not None:
            mu.mem_write(self.ds + DS_SCENE_INDEX, bytes([self.request - 1]))
            mu.mem_write(self.ds + DS_ROOM_CHANGE, b'\x01\x00')
            self.request = None
            self.loops = 0
            return
        self.loops += 1
        if self.stop_after is not None and self.loops >= self.stop_after:
            self.stop_after = None
            self.emu.halt = True
            mu.emu_stop()

    def enter(self, n, frames):
        """Enters scene n and stops at the main loop after `frames` frames."""
        self.request = n
        self.stop_after = frames + 1  # the first loop pass after the request performs the room change
        for _ in range(5000):
            self.emu.run(1)
            if self.stop_after is None:
                return
        raise RuntimeError(f'scene {n}: main loop not reached')


def save(session, name):
    emu = session.emu
    memory = bytes(emu.mu.mem_read(0, 0x100000))
    with gzip.open(os.path.join(OUT, f'{name}.bin.gz'), 'wb', compresslevel=6) as f:
        f.write(memory)
    regs = {'ss': emu.mu.reg_read(UC_X86_REG_SS), 'sp': emu.mu.reg_read(UC_X86_REG_SP), 'ds': emu.ds(), 'load': LOAD}
    with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
        json.dump(regs, f)


def main():
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    scenes = [int(a) for a in sys.argv[2:]] or SCENES
    os.makedirs(OUT, exist_ok=True)
    session = Session()
    for n in scenes:
        try:
            session.enter(n, frames)
        except (RuntimeError, UcError):
            session = Session()
            session.enter(n, frames)
        save(session, f'SCENE{n}-{frames}')
    print(f'saved {len(scenes)} snapshots to {OUT}')


if __name__ == '__main__':
    main()
