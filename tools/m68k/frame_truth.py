"""Capture the original's displayed frames beside the compact state records.

Usage: uv run --with unicorn --with capstone python tools/m68k/frame_truth.py 3000 \\
    --truth ./tmp/frames.jsonl.gz --frames ./tmp/frames.bin.gz [--stride 10] [--events file]

--truth gets one compact record per h0:7b2 boundary, in the format of snapshot.py --compact,
so ./tools/lockstep can import and compare it. --frames gets the displayed picture at every
stride-th boundary (frame 0 included): a gzip stream of records, each a big-endian u32 frame,
u16 width, u16 height, the 256 colour registers as 768 bytes of 8-bit RGB, then width * height
palette indexes of the display (display_pixels(): the View's bitmap at its RasInfo offset) and
width * height of the view the game composes in (g:df00, copied to the display by dirty rectangles).
"""
import argparse
import base64
import gzip
import json
import struct
import sys
from pathlib import Path

from amigaemu import Amiga, DATA
from snapshot import compact_frame

VIEW_BITMAP = 0xdf00  # BitMap of the view buffer g:87fa (g:de5c while drawing)


def capture(emu, frames, stride, truth_path, frames_path):
    truth_path, frames_path = Path(truth_path), Path(frames_path)
    truth_path.parent.mkdir(parents=True, exist_ok=True)
    frames_path.parent.mkdir(parents=True, exist_ok=True)
    previous = {}
    with gzip.open(truth_path, 'wt', encoding='ascii') as truth, gzip.open(frames_path, 'wb') as pictures:
        emu.run_frames(0)
        while True:
            record = compact_frame(emu)
            if emu.frames == 0:
                record['events'] = emu.events
            for region in record['regions']:
                current = base64.b64decode(region['data'])
                old = previous.get(region['address'])
                if old is not None and len(old) == len(current):
                    region['xor'] = True
                    region['data'] = base64.b64encode(bytes(a ^ b for a, b in zip(current, old))).decode('ascii')
                previous[region['address']] = current
            truth.write(json.dumps(record, separators=(',', ':')) + '\n')
            if emu.frames % stride == 0:
                _, _, _, width, height = emu.display_bitmap()
                view = emu.bitmap_pixels(emu.u32(DATA + VIEW_BITMAP), 0, 0, width, height)
                pictures.write(struct.pack('>IHH', emu.frames, width, height) + emu.palette_rgb()
                               + emu.display_pixels() + view)
            if emu.frames >= frames:
                break
            emu.run_frames(1)
    print(f'saved {emu.frames + 1} boundaries to {truth_path}, pictures every {stride} to {frames_path}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('frames', type=int)
    parser.add_argument('--truth', required=True)
    parser.add_argument('--frames', dest='pictures', required=True)
    parser.add_argument('--stride', type=int, default=10)
    parser.add_argument('--events', type=str)
    args = parser.parse_args()
    if args.frames < 0 or args.stride < 1:
        parser.error('frames must be nonnegative and stride positive')
    events = json.loads(Path(args.events).read_text()) if args.events else []
    capture(Amiga(events), args.frames, args.stride, args.truth, args.pictures)
    return 0


if __name__ == '__main__':
    sys.exit(main())
