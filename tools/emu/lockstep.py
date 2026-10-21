"""Runs the original game deterministically and saves memory at the top of every main-loop frame.

The timer IRQ is raised only where the game waits for it: right before every timer poll of its wait loops (frame
sync, delay, menu pauses), the same rule the TypeScript port follows (src/engine/dos/hardware.ts waitTick). Memory is saved at main() entry (0:1a9c),
after init at the first loop pass (0:1adc) and at every later loop pass, to out/lockstep/<k>.bin.gz
(k = 'main', 0, 1, ...), with the DOS machine state in <k>.json.
Usage: uv run --with unicorn tools/emu/lockstep.py [frames=200] [stride=1]  (saves every stride-th frame)
"""
import gzip
import json
import os
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_CS, UC_X86_REG_IP, UC_X86_REG_SP, UC_X86_REG_SS

from dosemu import Dos, LOAD
from trace import machine

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'out', 'lockstep')
MAIN = 0x1a9c
LOOP_TOP = 0x1adc
# Stack bytes the original reads without initialising (garbage left by earlier calls). The port uses fixed values;
# here they are written into the original at function entry: {entry: [(offset from SP at entry, value)]}.
UNINITIALISED = {
    0x42bd: [(-3, 0)],  # spawnFrom: record byte 3
}
WAIT_POLLS = (0x2016, 0x3b71, 0xac71, 0xacf1, 0xb46a)  # `call 0:e55a` inside wait loops


def main():
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    stride = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    os.makedirs(OUT, exist_ok=True)
    emu = Dos()
    events = []

    state = {'skip': None}  # address whose hook just fired: let its instruction run once

    def stop(kind):
        def hook(mu, addr, size, _):
            if addr == state['skip']:
                state['skip'] = None
                return
            events.append(kind)
            mu.emu_stop()
        return hook

    for off, kind in ((MAIN, 'main'), (LOOP_TOP, 'frame'), *((p, 'tick') for p in WAIT_POLLS)):
        emu.mu.hook_add(UC_HOOK_CODE, stop(kind), None, LOAD * 16 + off, LOAD * 16 + off)

    def define(values):
        def hook(mu, addr, size, _):
            at = mu.reg_read(UC_X86_REG_SS) * 16 + mu.reg_read(UC_X86_REG_SP)
            for offset, value in values:
                mu.mem_write(at + offset, bytes([value]))
        return hook

    for off, values in UNINITIALISED.items():
        emu.mu.hook_add(UC_HOOK_CODE, define(values), None, LOAD * 16 + off, LOAD * 16 + off)

    def save(name):
        with gzip.open(os.path.join(OUT, f'{name}.bin.gz'), 'wb', compresslevel=6) as f:
            f.write(bytes(emu.mu.mem_read(0, 0x100000)))
        with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
            json.dump({'ds': emu.ds(), 'ss': emu.r(UC_X86_REG_SS), 'sp': emu.r(UC_X86_REG_SP), 'dac': bytes(emu.dac).hex(),
                       'machine': machine(emu)}, f)

    frame = 0
    ticked = False  # the IRQ raised at a poll returns there: run the poll instead of ticking again
    while frame <= frames and not emu.exited:
        start = emu.lin(emu.r(UC_X86_REG_CS), emu.r(UC_X86_REG_IP))
        events.clear()
        emu.mu.emu_start(start, 0x200000)
        if not events:
            continue
        kind = events[0]
        here = emu.lin(emu.r(UC_X86_REG_CS), emu.r(UC_X86_REG_IP))
        if kind == 'main':
            save('main')
        elif kind == 'frame':
            if frame % stride == 0:
                save(str(frame))
            frame += 1
        elif kind == 'tick' and not ticked:
            emu.raise_irq(0x08, force=True)
            ticked = True
            continue
        ticked = False
        state['skip'] = here
    print(f'saved main + {frame} frames to {OUT}; log tail: {emu.log[-3:]}')


if __name__ == '__main__':
    main()
