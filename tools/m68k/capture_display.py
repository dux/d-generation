"""Capture the displayed picture of the original game at cooperative ticks and main-loop frames.

Usage: uv run --with unicorn --with capstone python tools/m68k/capture_display.py --ticks 100,280 --frames 0,10
Optional --events ./tmp/input.json (same format as snapshot.py) and --out DIR (default ./tmp/uiflow-captures).

Each capture is DIR/<label>.json (label t<tick> or f<frame>, zero padded):
{"label", "tick", "frame", "width", "height", "bitmap", "x", "y", "pixels", "palette"}
where pixels is base64 of width*height palette indexes (display_pixels: the bitmap of the last LoadView
at its RasInfo offset) and palette is base64 of the 256 colour registers as 768 bytes of 8-bit RGB.

Tick captures: Amiga.tick() increments emu.ticks and then runs every vertical-blank server once.
The capture for tick N is taken right after the servers of the tick that made emu.ticks == N returned,
before the game resumes from the wait poll that yielded (h0:1462a / h10 fade polls).
That is the picture the game shows while it sits in the N-th cooperative wait.
Frame captures: taken at the h0:7b2 main-loop boundary of frame N, after that boundary's input events.
"""
import argparse
import base64
import json
import sys
from pathlib import Path

from amigaemu import Amiga, ROOT

DEFAULT_OUT = ROOT / 'tmp' / 'uiflow-captures'


def numbers(text):
    return sorted({int(v, 0) for v in text.split(',') if v.strip()}) if text else []


class Capture(Amiga):
    def __init__(self, events, ticks, out):
        super().__init__(events)
        self.wanted_ticks = set(ticks)
        self.out = out
        self.saved = []

    def save(self, label):
        bitmap, x, y, width, height = self.display_bitmap()
        pixels = self.bitmap_pixels(bitmap, x, y, width, height)
        record = {'label': label, 'tick': self.ticks, 'frame': self.frames, 'width': width, 'height': height,
                  'bitmap': bitmap, 'x': x, 'y': y,
                  'pixels': base64.b64encode(pixels).decode('ascii'),
                  'palette': base64.b64encode(self.palette_rgb()).decode('ascii')}
        path = self.out / f'{label}.json'
        path.write_text(json.dumps(record) + '\n')
        self.saved.append(path)
        print(json.dumps({'label': label, 'tick': self.ticks, 'frame': self.frames,
                          'bitmap': f'{bitmap:x}', 'path': str(path)}), flush=True)

    def tick(self):
        super().tick()
        if self.ticks in self.wanted_ticks:
            self.save(f't{self.ticks:05d}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--ticks', type=str, default='')
    parser.add_argument('--frames', type=str, default='')
    parser.add_argument('--events', type=str)
    parser.add_argument('--out', type=str, default=str(DEFAULT_OUT))
    args = parser.parse_args()
    ticks, frames = numbers(args.ticks), numbers(args.frames)
    if not ticks and not frames:
        parser.error('give --ticks and/or --frames')
    events = json.loads(Path(args.events).read_text()) if args.events else []
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    emu = Capture(events, ticks, out)
    last_tick = max(ticks, default=-1)
    try:
        emu.run_frames(0)
        while True:
            if emu.frames in frames:
                emu.save(f'f{emu.frames:05d}')
            if emu.frames >= max(frames, default=-1) and emu.ticks >= last_tick:
                break
            emu.run_frames(1)
    except Exception as error:
        print(f'BLOCKED at tick {emu.ticks} frame {emu.frames}: {error}', file=sys.stderr)
        return 1
    print(f'saved {len(emu.saved)} captures to {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
