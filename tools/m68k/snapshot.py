"""Capture deterministic AGA game-state snapshots (not display output).

Usage: uv run --with unicorn --with capstone python tools/m68k/snapshot.py 500
Optional --stride 100 --events ./tmp/input.json.
Use --compact ./tmp/aga.jsonl.gz for every-frame h11/object-region records;
successive regions are XOR deltas, keeping 3000 frames to a few megabytes.
This mode streams captures and never saves full per-frame heap snapshots.
Events are JSON objects: {"frame": 30, "key": 64, "down": true} or
{"frame": 60, "joy": 268435457}; keys use Amiga raw codes, joy uses
lowlevel.library ReadJoyPort bits including the controller type nibble.
{"frame": 5, "poke": [{"g": "8a24", "width": 1, "value": 12}]} writes h11
globals at that boundary, for scenario setup such as warping to a room.
{"tick": 4500, "key": 69} applies at cooperative tick 4500 instead (right after
that tick's vblank servers), i.e. inside waits such as the pause or a card.
A failure saves blocked.json/bin.gz and exits nonzero with the exact PC.
"""
import argparse
import base64
import gzip
import json
import sys

from amigaemu import Amiga, OUT, DATA
from hunk import HUNKS


def compact_frame(emu):
    """Capture game globals/pool, timer phase and actors, without display heaps."""
    h11 = HUNKS[11]
    regions = [{'address': DATA, 'data': base64.b64encode(
        emu.mu.mem_read(DATA, h11.size)).decode('ascii')}]
    regions.append({'address': HUNKS[10].base + 0x210, 'data': base64.b64encode(
        emu.mu.mem_read(HUNKS[10].base + 0x210, 2)).decode('ascii')})
    slots = [emu.u32(DATA + 0x8448 + slot * 4) for slot in range(30)]
    for address in sorted(set(slots) - {0}):
        if not DATA <= address <= DATA + h11.size - 0x102:
            regions.append({'address': address, 'data': base64.b64encode(
                emu.mu.mem_read(address, 0x102)).decode('ascii')})
    return dict(emu.state(), slots=slots, regions=regions,
                input={'rawKeys': sorted(emu.keys), 'joy': emu.joystick})


def capture_compact(emu, frames, path):
    """Stream one compressed record per h0:7b2 boundary, including frame zero."""
    from pathlib import Path
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scenes = {}
    previous = {}
    with gzip.open(path, 'wt', encoding='ascii') as stream:
        emu.run_frames(0)
        while True:
            record = compact_frame(emu)
            if emu.frames == 0:
                record['events'] = emu.events + emu.tick_events
            for region in record['regions']:
                address = region['address']
                current = base64.b64decode(region['data'])
                old = previous.get(address)
                if old is not None and len(old) == len(current):
                    region['xor'] = True
                    region['data'] = base64.b64encode(bytes(
                        a ^ b for a, b in zip(current, old))).decode('ascii')
                previous[address] = current
            stream.write(json.dumps(record, separators=(',', ':')) + '\n')
            scene = record['scene_index']
            classes = sorted({emu.mu.mem_read(at + 2, 1)[0]
                              for at in record['slots'] if at})
            if scene not in scenes:
                scenes[scene] = {'first_frame': emu.frames, 'classes': set()}
                print(json.dumps({'frame': emu.frames, 'scene_index': scene,
                                  'classes': classes}), flush=True)
            scenes[scene]['classes'].update(classes)
            if emu.frames >= frames:
                break
            emu.run_frames(1)
    summary = {str(scene): dict(first_frame=data['first_frame'],
                               classes=sorted(data['classes']))
               for scene, data in scenes.items()}
    path.with_suffix('.summary.json').write_text(json.dumps({
        'frames': emu.frames, 'ticks': emu.ticks, 'scenes': summary,
        'unimplemented': dict(emu.unimplemented)}, indent=2) + '\n')
    print(f'saved {emu.frames + 1} compact frame records to {path}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('frames', type=int, nargs='?', default=500)
    parser.add_argument('--stride', type=int, default=100)
    parser.add_argument('--events', type=str)
    parser.add_argument('--compact', type=str,
                        help='stream every frame to gzip JSONL; no full snapshots')
    args = parser.parse_args()
    if args.frames < 0 or args.stride < 1:
        parser.error('frames must be nonnegative and stride must be positive')
    events = []
    if args.events:
        with open(args.events) as stream:
            events = json.load(stream)
    emu = Amiga(events)
    history = []
    try:
        if args.compact:
            capture_compact(emu, args.frames, args.compact)
            return 0
        emu.run_frames(0)
        emu.snapshot('00000')
        history.append(emu.state())
        print(json.dumps(history[-1]), flush=True)
        while emu.frames < args.frames:
            emu.run_frames(min(args.stride, args.frames - emu.frames))
            emu.snapshot()
            history.append(emu.state())
            print(json.dumps(history[-1]), flush=True)
    except Exception as error:
        emu.snapshot('blocked')
        (OUT / 'failure.json').write_text(json.dumps({'error': str(error),
            'state': emu.state(), 'history': history}, indent=2) + '\n')
        print(f'BLOCKED: {error}', file=sys.stderr)
        return 1
    (OUT / 'run.json').write_text(json.dumps(history, indent=2) + '\n')
    print(f'saved {len(history)} snapshots through frame {emu.frames} to {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
