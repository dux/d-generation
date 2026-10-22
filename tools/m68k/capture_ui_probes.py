"""Capture original UI function pictures, independently of scenario progression.

Usage: uv run --with unicorn --with capstone python tools/m68k/capture_ui_probes.py
"""
import base64
import json
from pathlib import Path
from amigaemu import DATA, RETURN
from capture_display import Capture
from hunk import addr
from unicorn.m68k_const import UC_M68K_REG_A0, UC_M68K_REG_D0, UC_M68K_REG_D1, UC_M68K_REG_PC

OUT = Path('tmp/uiflow3-pixels')

class ProbeCapture(Capture):
    def save(self, label):
        super().save(label)
        path = self.out / f'{label}.json'
        record = json.loads(path.read_text())
        record['view'] = base64.b64encode(self.bitmap_pixels(self.u32(DATA + 0xdf00), 0, 0, 320, 200)).decode('ascii')
        record['actors'] = [base64.b64encode(emu_data).decode('ascii') for slot in range(30)
                            if (pointer := self.u32(DATA + 0x8448 + slot * 4))
                            for emu_data in [self.mu.mem_read(pointer, 0x102)]]
        path.write_text(json.dumps(record) + '\n')


def invoke(emu, function, argument=0, first_tick=False):
    emu.w(UC_M68K_REG_D0, argument)
    emu.push(RETURN)
    emu.w(UC_M68K_REG_PC, addr(function))
    while True:
        kind = emu.execute()
        if kind == 'return':
            return
        if kind == 'tick':
            if first_tick:
                return
            emu.tick()
        else:
            raise RuntimeError(f'unexpected boundary in {function}')
        emu.skip = emu.r(UC_M68K_REG_PC)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in [('pause', '`|3Game Paused'), ('flash', 'One life remaining.')]:
        emu = ProbeCapture([], [], OUT)
        emu.run_frames(0)
        emu.mu.mem_write(0x71000, text.encode('ascii') + b'\0')
        emu.w(UC_M68K_REG_A0, 0x71000)
        emu.w(UC_M68K_REG_D1, 2)
        invoke(emu, 'h0:b7aa', 1)
        invoke(emu, 'h0:b746')
        emu.save(name)
    emu = ProbeCapture([], [], OUT)
    emu.run_frames(0)
    invoke(emu, 'h0:151a4', first_tick=True)
    emu.save('pad-menu')
    for name, function, argument, wait in [('stats', 'h0:b830', 0, False),
                                          *[(f'ending-{i}', 'h0:7542', i, True) for i in range(5)]]:
        emu = ProbeCapture([], [], OUT)
        emu.run_frames(0)
        invoke(emu, function, argument, wait)
        emu.save(name)
    print('saved 6 isolated UI probes')
    emu = ProbeCapture([], [1850, 1900, 1950, 2000, 2050, 2100], OUT)
    emu.run_frames(0)


if __name__ == '__main__':
    main()
