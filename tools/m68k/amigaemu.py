"""Deterministic, headless AmigaOS environment for the unmodified AGA dgen.

Run with uv run --with unicorn --with capstone. Hunks use hunk.py addresses.
Timing is cooperative: before timer reads, assembly vblank waits, and palette
fade polls, stop execution and call the installed vblank and CIA servers as
ordinary 68k subroutines with is_Data in A1, then resume the poll once.
The CIA music timer runs once per cooperative tick, not at its hardware rate.
No wall-clock or instruction-count IRQs; one tick represents a nominal PAL 1/50s.
A frame is one visit to h0:7b2, not a timer tick or a rendered image.
Custom-chip writes are recorded; a BLTSIZE/BLTSIZH write runs the blitter
synchronously (area mode; fill and line mode fail loudly, the game never uses
them). graphics.library BltBitMap, RectFill, Move/Draw, pen setters,
LoadRGB32/SetRGB32 and LoadView act on real memory and a 256-colour register
file, so bitplanes and palette can be captured as indexed images
(bitmap_pixels, display_pixels, palette_rgb). Copper and sprite DMA, audio DMA
and beam timing are not emulated.
Unknown library vectors stop execution and are recorded, never silently succeed.

Amiga.run_frames(n) boots on its first call and stops at the top of a frame;
run_frames(0) captures frame zero after initialization. Events are delivered
before that frame executes, through the installed input.device handler for raw
keys and ReadJoyPort for joystick state. Key-up events set raw-code bit 7.
snapshot() writes a gzip concatenation of h11, h3, h7, h8, h10 and live heap
blocks; JSON regions give absolute address, byte size, and decompressed offset.
These are comparison captures, not complete restorable machine save states.
Scene index is the byte h11:8a24; h11:85bc points to the current player object,
whose big-endian 8.8 position words are at +0x0a and +0x0c.
DOS writes stay in memory and never modify the shipped game files.
freeanim/intuition open as library identities, but no vectors from them are
needed by the observed paths; an unexpected call fails explicitly.
nonvolatile.library (save/restore game) keeps its items in memory (self.nv).
"""
import collections
import gzip
import json
import struct
from pathlib import Path

from unicorn import (Uc, UcError, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN,
                     UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE)
from unicorn.m68k_const import *

from hunk import HUNKS, label

ROOT = Path(__file__).resolve().parents[2]
GAME = ROOT / 'amiga' / 'aga'
OUT = ROOT / 'out' / 'aga-truth'
DATA = HUNKS[11].base
MAIN_LOOP = HUNKS[0].base + 0x7b2
# h0:3622 is the step of the h0:357c key wait: it polls no timer, so on the Amiga only interrupts end it; the
# harness counts each step as one cooperative tick so that tick-timed events can deliver the key. The same holds
# for the input polls of the conversation menu (h0:139f6), the inventory (h0:14282) and the CD32 keyboard's RED
# release wait (h0:14e6a). CD32 menu ReadJoyPort polls also need cooperative ticks; both menus use Delay(5).
WAIT_POLLS = (HUNKS[0].base + 0x1462a, HUNKS[0].base + 0x14662, HUNKS[0].base + 0x3622,
              HUNKS[0].base + 0x139f6, HUNKS[0].base + 0x14282, HUNKS[0].base + 0x14e6a, HUNKS[0].base + 0x14ed8,
              *(HUNKS[0].base + off for off in (0x15212, 0x15238, 0x15296, 0x15332, 0x15384, 0x153ce)),
              *(HUNKS[10].base + off for off in (0x258, 0xf68, 0xfe0)))
POLL_TICKS = {HUNKS[0].base + off: 5 for off in (0x14ed8, 0x153ce)}
RETURN = 0x7f0000
REGS = [UC_M68K_REG_D0 + i for i in range(8)] + [UC_M68K_REG_A0 + i for i in range(8)]
BMF_DISPLAYABLE = 2
BMF_INTERLEAVED = 4
# Custom-chip blitter registers (offsets from 0xdff000).
BLTCON0, BLTCON1, BLTAFWM, BLTALWM = 0x40, 0x42, 0x44, 0x46
BLTCPT, BLTBPT, BLTAPT, BLTDPT = 0x48, 0x4c, 0x50, 0x54
BLTSIZE, BLTSIZV, BLTSIZH = 0x58, 0x5c, 0x5e
BLTCMOD, BLTBMOD, BLTAMOD, BLTDMOD = 0x60, 0x62, 0x64, 0x66
BLTCDAT, BLTBDAT, BLTADAT = 0x70, 0x72, 0x74

# EXPAND[b]: the 8 bits of b as 8 bytes of 0/1, leftmost bit first.
EXPAND = [bytes((b >> (7 - i)) & 1 for i in range(8)) for b in range(256)]


def s16(value):
    value &= 0xffff
    return value - 0x10000 if value & 0x8000 else value


def s32(value):
    value &= 0xffffffff
    return value - 0x100000000 if value & 0x80000000 else value


def spread(bits, width):
    """A width-bit plane row as an int of width bytes, each 0 or 1."""
    pad = -width % 8
    packed = (bits << pad).to_bytes((width + pad) // 8, 'big')
    return int.from_bytes(b''.join(EXPAND[b] for b in packed)[:width], 'big')


def minterm(lf, a, b, c):
    """Blitter logic function: bit 7 = ABC ... bit 0 = abc."""
    na, nb, nc = a ^ 0xffff, b ^ 0xffff, c ^ 0xffff
    d = 0
    for bit, x, y, z in ((0x80, a, b, c), (0x40, a, b, nc), (0x20, a, nb, c), (0x10, a, nb, nc),
                         (0x08, na, b, c), (0x04, na, b, nc), (0x02, na, nb, c), (0x01, na, nb, nc)):
        if lf & bit:
            d |= x & y & z
    return d


class Amiga:
    def __init__(self, events=()):
        self.mu = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
        self.mu.ctl_set_cpu_model(UC_CPU_M68K_M68020)
        self.mu.mem_map(0, 0x2000000)
        for h in HUNKS:
            self.mu.mem_write(h.base, bytes(h.data))
        self.log = []
        self.lvos = collections.Counter()
        self.unimplemented = collections.Counter()
        self.allocations = []
        self.heap = 0x1000000
        self.files = {}
        self.handles = 10
        self.locks = {1: GAME}
        self.cwd = GAME
        self.libraries = {}
        self.vblank = []
        self.vectors = {}
        self.input_handler = 0
        self.ticks = 0
        self.frames = -1
        self.beam = 0
        self.keys = set()
        self.joystick = 0x10000000
        self.events = sorted((dict(e) for e in events if 'tick' not in e), key=lambda e: e['frame'])
        self.event_index = 0
        self.tick_events = sorted((dict(e) for e in events if 'tick' in e), key=lambda e: e['tick'])
        self.tick_index = 0
        self.stop = None
        self.skip = None
        self.exited = False
        self.failure_pc = None
        self.nv = {}
        self.custom = {}
        self.blits = 0
        self.colors = [(0, 0, 0)] * 256
        self.view = 0
        self.exec = self.library('exec.library')
        self.put32(4, self.exec)
        self.put16(self.exec + 20, 39)
        self.process = self.alloc(0x400, 'Process')
        self.cli = self.alloc(0x100, 'CLI')
        self.put32(self.exec + 0x114, self.process)
        self.put32(self.process + 0xac, self.cli >> 2)
        self.put32(self.cli + 0x34, 0x40000 // 4)
        name = self.alloc(16, 'command name')
        self.mu.mem_write(name, b'\x04dgen\0')
        self.put32(self.cli + 0x10, name >> 2)
        self.mu.mem_write(0x70000, b'\n\0')
        self.mu.mem_write(RETURN, b'\x4e\x71')
        self.mu.reg_write(UC_M68K_REG_SR, 0x2000)
        self.w(UC_M68K_REG_A7, 0x1f00000)
        self.push(RETURN)
        self.w(UC_M68K_REG_A0, 0x70000)
        self.w(UC_M68K_REG_D0, 1)
        self.w(UC_M68K_REG_PC, HUNKS[0].base)
        self.mu.hook_add(UC_HOOK_CODE, self.on_return, begin=RETURN, end=RETURN)
        for at in (MAIN_LOOP, *WAIT_POLLS):
            self.mu.hook_add(UC_HOOK_CODE, self.on_point, begin=at, end=at)
        self.mu.hook_add(UC_HOOK_MEM_READ, self.chip_read, begin=0xdff000, end=0xdff1ff)
        self.mu.hook_add(UC_HOOK_MEM_WRITE, self.chip_write, begin=0xdff000, end=0xdff1ff)
        self.mu.hook_add(UC_HOOK_MEM_READ, self.cia_read, begin=0xbfd000, end=0xbfffff)
        self.mu.hook_add(UC_HOOK_CODE, self.on_fatal, begin=HUNKS[0].base + 0xdab8,
                         end=HUNKS[0].base + 0xdab8)

    def r(self, reg):
        return self.mu.reg_read(reg)

    def w(self, reg, value):
        self.mu.reg_write(reg, value & 0xffffffff)

    def u16(self, at):
        return int.from_bytes(self.mu.mem_read(at, 2), 'big')

    def u32(self, at):
        return int.from_bytes(self.mu.mem_read(at, 4), 'big')

    def put16(self, at, value):
        self.mu.mem_write(at, struct.pack('>H', value & 0xffff))

    def put32(self, at, value):
        self.mu.mem_write(at, struct.pack('>I', value & 0xffffffff))

    def push(self, value):
        sp = self.r(UC_M68K_REG_A7) - 4
        self.w(UC_M68K_REG_A7, sp)
        self.put32(sp, value)

    def cstr(self, at):
        return bytes(self.mu.mem_read(at, 1024)).split(b'\0', 1)[0].decode('latin1')

    def alloc(self, size, kind='AllocMem'):
        at = self.heap
        self.heap += (size + 15) & ~15
        if self.heap >= 0x1e00000:
            raise RuntimeError(f'heap exhausted allocating {size} bytes')
        self.allocations.append({'address': at, 'size': size, 'kind': kind, 'freed': False})
        return at

    def free(self, at):
        for block in self.allocations:
            if block['address'] == at:
                block['freed'] = True
                return

    def library(self, name):
        name = name.lower()
        if name in self.libraries:
            return self.libraries[name]
        base = 0x810000 + len(self.libraries) * 0x10000
        self.libraries[name] = base
        self.mu.mem_write(base - 0x1000, b'\x4e\x75' * 0x800)
        self.put16(base + 20, 40)
        self.mu.hook_add(UC_HOOK_CODE, self.on_lvo, name, base - 0x1000, base - 1)
        return base

    def path(self, name):
        name = name.replace('\\', '/')
        cur = GAME if ':' in name else self.cwd
        name = name.split(':', 1)[-1]
        for part in name.split('/'):
            if part in ('', '.'):
                continue
            if part == '..':
                cur = cur.parent
            else:
                if not cur.is_dir():
                    return None
                cur = next((p for p in cur.iterdir() if p.name.lower() == part.lower()), None)
                if cur is None:
                    return None
            if not cur.is_relative_to(GAME):
                return None
        return cur

    def on_lvo(self, mu, at, size, name):
        offset = self.libraries[name] - at
        key = f'{name} -0x{offset:x}'
        self.lvos[key] += 1
        result = self.lvo(name, offset)
        if result is None:
            self.unimplemented[key] += 1
            caller = label(self.u32(self.r(UC_M68K_REG_A7)))
            self.log.append(f'unimplemented {key} from {caller}')
            raise RuntimeError(self.log[-1])
        self.w(UC_M68K_REG_D0, result)

    def lvo(self, name, off):
        d0, d1, d2, d3 = [self.r(UC_M68K_REG_D0 + i) for i in range(4)]
        a0, a1, a2 = [self.r(UC_M68K_REG_A0 + i) for i in range(3)]
        if name == 'exec.library':
            if off in (0xc6, 0x2ac):
                return self.alloc(d0, 'AllocVec' if off == 0x2ac else 'AllocMem')
            if off in (0xd2, 0x2b2):
                self.free(a1)
                return 0
            if off in (0x228, 0x198, 0x1f2):
                lib = self.cstr(a1)
                self.log.append(f'OpenLibrary {lib}')
                return self.library(lib)
            if off == 0x126:
                return self.process
            if off == 0xd8:
                return 0x800000
            if off == 0xa8:
                self.vblank.append(a1)
                self.log.append(f'AddIntServer {d0} {label(self.u32(a1 + 18))}')
                return 0
            if off == 0xa2:
                old = self.vectors.get(d0, 0)
                self.vectors[d0] = a1
                return old
            if off == 0x1bc:
                self.put32(a1 + 20, self.library(self.cstr(a0)))
                return 0
            if off == 0x1c8:
                device = self.u32(a1 + 20)
                if device == self.libraries.get('input.device'):
                    command = self.u16(a1 + 28)
                    if command == 9:
                        self.input_handler = self.u32(a1 + 40)
                    elif command == 10:
                        self.input_handler = 0
                return 0
            if off in (0x1ce, 0x1d4, 0x1da, 0x1e0, 0x1e6):
                return 0
            if off == 0x13e:
                return 1 << 12
            if off in (0x78, 0x7e, 0x84, 0x8a, 0x96, 0xae, 0x132, 0x138,
                       0x144, 0x14a, 0x150, 0x15c, 0x162, 0x168, 0x16e,
                       0x174, 0x17a, 0x180, 0x19e, 0x1c2):
                return 0
            if off == 0x270:
                self.mu.mem_write(a1, bytes(self.mu.mem_read(a0, d0)))
                return 0
        elif name == 'dos.library':
            if off == 0x1e:
                text = self.cstr(d1)
                path = self.path(text)
                self.log.append(f'Open {text} mode={d2} -> {path}')
                if text.upper() in ('NIL:', '*'):
                    data = bytearray()
                elif path and path.is_file():
                    data = bytearray(path.read_bytes()) if d2 != 1006 else bytearray()
                elif d2 == 1006:
                    data = bytearray()
                else:
                    return 0
                self.handles += 1
                self.files[self.handles] = [data, 0, text]
                return self.handles
            if off == 0x24:
                self.files.pop(d1, None)
                return -1
            if off in (0x2a, 0x30):
                f = self.files.get(d1)
                if f is None:
                    if off == 0x30:
                        self.log.append(self.cstr(d2)[:d3])
                        return d3
                    return 0
                if off == 0x2a:
                    data = bytes(f[0][f[1]:f[1] + d3])
                    if data:
                        self.mu.mem_write(d2, data)
                    f[1] += len(data)
                    return len(data)
                data = bytes(self.mu.mem_read(d2, d3))
                f[0][f[1]:f[1] + d3] = data
                f[1] += d3
                return d3
            if off == 0x42:
                f = self.files.get(d1)
                if not f:
                    return -1
                old = f[1]
                offset = d2 if d2 < 0x80000000 else d2 - 0x100000000
                mode = d3 if d3 < 0x80000000 else d3 - 0x100000000
                f[1] = {-1: 0, 0: old, 1: len(f[0])}[mode] + offset
                return old
            if off == 0x54:
                path = self.path(self.cstr(d1))
                if path is None:
                    return 0
                self.handles += 1
                self.locks[self.handles] = path
                return self.handles
            if off == 0x7e:
                old = next(k for k, v in self.locks.items() if v == self.cwd)
                self.cwd = self.locks.get(d1, GAME)
                return old
            if off == 0xc0:
                self.mu.mem_write(d1, struct.pack('>III', 5000, 0, self.ticks))
                return d1
            if off in (0x36, 0x3c):
                return 1 if off == 0x36 else 2
            if off in (0x5a, 0x84, 0xc6):
                return 0
            if off == 0x8a:
                return -1
        elif name == 'lowlevel.library':
            if off == 0x1e:
                return self.joystick
            if off == 0x30:
                return next(iter(sorted(self.keys)), 0xff)
            if off in (0x24, 0x2a, 0x36, 0x3c, 0x42):
                return 0
        elif name == 'nonvolatile.library':
            # V40 nonvolatile.library over an in-memory store (self.nv, item key 'app/item').
            # Free storage is a plain 1 KB NVRAM, rounded to tens like nvi_FreeStorage.
            key = f'{self.cstr(a0)}/{self.cstr(a1)}'
            if off == 0x30:  # DeleteNV(appName, itemName, killRequesters)
                return 1 if self.nv.pop(key, None) is not None else 0
            if off == 0x36:  # GetNVInfo(killRequesters): NVInfo {MaxStorage, FreeStorage}
                info = self.alloc(8, 'NVInfo')
                self.put32(info, 1000)
                self.put32(info + 4, 1000 - 10 * sum((len(v) + 9) // 10 for v in self.nv.values()))
                return info
            if off == 0x2a:  # StoreNV(appName, itemName, data, length in tens, killRequesters)
                self.nv[key] = bytes(self.mu.mem_read(a2, d0 * 10))
                return 0
            if off == 0x1e:  # GetCopyNV(appName, itemName, killRequesters)
                if key not in self.nv:
                    return 0
                data = self.alloc(len(self.nv[key]), 'NVData')
                self.mu.mem_write(data, self.nv[key])
                return data
            if off == 0x24:  # FreeNVData(data)
                self.free(a0)
                return 0
        elif name == 'graphics.library':
            if off == 0x13e:
                return self.read_pixel(self.u32(a1 + 4), s32(d0), s32(d1))
            if off == 0x180:
                self.beam = (self.beam + 1) % 312
                return self.beam
            if off == 0x12c:
                count = (d0 & 0xffff) * (d0 >> 16) if d1 & 2 else d0
                self.mu.mem_write(a1, bytes(count))
                return 0
            if off == 0x396:
                return self.alloc_bitmap(d0, d1, d2, d3, a0)
            if off == 0x186:
                self.init_bitmap(a0, d0, d1, d2)
                return 0
            if off == 0x23a:
                return self.alloc(32 + d0 * 4, 'ColorMap')
            if off == 0x2f4:
                return 0
            if off == 0x1e:
                d4, d5, d6, d7 = [self.r(UC_M68K_REG_D0 + i) for i in range(4, 8)]
                return self.blt_bitmap(a0, s16(d0), s16(d1), a1, s16(d2), s16(d3),
                                       s16(d4), s16(d5), d6 & 0xff, d7 & 0xff)
            if off == 0x372:
                self.load_rgb32(a1)
                return 0
            if off == 0x354:
                self.colors[d0 & 0xff] = (d1 >> 24, d2 >> 24, d3 >> 24)
                return 0
            if off == 0xde:
                self.view = a1
                return 0
            if off == 0xc6:
                self.init_rastport(a1)
                return 0
            if off in (0x156, 0x15c, 0x162):
                self.mu.mem_write(a1 + {0x156: 25, 0x15c: 26, 0x162: 28}[off], bytes((d0 & 0xff,)))
                return 0
            if off == 0xf0:
                self.put16(a1 + 36, d0)
                self.put16(a1 + 38, d1)
                return 0
            if off == 0xf6:
                self.draw_line(a1, s16(self.u16(a1 + 36)), s16(self.u16(a1 + 38)), s16(d0), s16(d1))
                self.put16(a1 + 36, d0)
                self.put16(a1 + 38, d1)
                return 0
            if off == 0x132:
                self.rect_fill(a1, s16(d0), s16(d1), s16(d2), s16(d3))
                return 0
            if off in (0x168, 0xcc, 0xd2, 0xd8, 0xc0, 0x1c8, 0x1ce, 0x24, 0x26a,
                       0x234, 0x21c, 0x240, 0x39c, 0x144):
                return 0
        elif name in ('ciaa.resource', 'ciab.resource'):
            if off == 6:
                self.vectors[(name, d0)] = a1
                return 0
            if off in (12, 18, 24):
                return 0
        return None

    def init_bitmap(self, at, depth, width, height):
        self.put16(at, ((width + 15) // 16) * 2)
        self.put16(at + 2, height)
        self.mu.mem_write(at + 4, bytes((0, depth & 255, 0, 0)))

    # Display: bitmaps, blitter, palette. Pixel (x, y) of plane p lives at
    # Planes[p] + y * BytesPerRow + x / 8, MSB = leftmost, for interleaved
    # (BytesPerRow covers all planes of a row) and plain bitmaps alike.

    def alloc_bitmap(self, width, height, depth, flags, friend):
        """AllocBitMap: BMF_INTERLEAVED, or an interleaved friend, gives one
        block with the rows of all planes back to back (the game's blitter
        code h10:16 relies on that for its 320-byte rows). The block reserves
        the same heap span as separate planes so later addresses don't move."""
        bitmap = self.alloc(40, 'BitMap')
        self.init_bitmap(bitmap, depth, width, height)
        row = ((width + 15) // 16) * 2
        plane = row * height
        interleaved = depth > 1 and (flags & BMF_INTERLEAVED or friend and
                                     self.mu.mem_read(friend + 4, 1)[0] & BMF_INTERLEAVED)
        if interleaved:
            base = self.alloc(depth * ((plane + 15) & ~15), 'interleaved bitplanes')
            self.put16(bitmap, row * depth)
            self.mu.mem_write(bitmap + 4, bytes((BMF_INTERLEAVED | (flags & BMF_DISPLAYABLE),)))
            for p in range(depth):
                self.put32(bitmap + 8 + p * 4, base + p * row)
        else:
            for p in range(depth):
                self.put32(bitmap + 8 + p * 4, self.alloc(plane, 'bitplane'))
        return bitmap

    def bitmap_info(self, bitmap):
        """(width, rows, BytesPerRow, plane pointers) of a graphics BitMap."""
        bpr, rows = self.u16(bitmap), self.u16(bitmap + 2)
        flags, depth = self.mu.mem_read(bitmap + 4, 2)
        planes = [self.u32(bitmap + 8 + p * 4) for p in range(min(depth, 8))]
        width = bpr * 8 // depth if flags & BMF_INTERLEAVED and depth else bpr * 8
        return width, rows, bpr, planes

    def plane_bits(self, ptr, bpr, x, y, w):
        """w pixels of one plane row from x as an int, leftmost pixel in the top bit.
        Plane pointers 0 and -1 read as all zeros and all ones (V39 rules)."""
        if ptr in (0, 0xffffffff):
            return (1 << w) - 1 if ptr else 0
        first, last = x >> 3, (x + w - 1) >> 3
        raw = int.from_bytes(self.mu.mem_read(ptr + y * bpr + first, last - first + 1), 'big')
        return (raw >> ((last - first + 1) * 8 - (x & 7) - w)) & ((1 << w) - 1)

    def put_plane_bits(self, ptr, bpr, x, y, w, bits):
        if ptr in (0, 0xffffffff):
            return
        first, last = x >> 3, (x + w - 1) >> 3
        at = ptr + y * bpr + first
        size = last - first + 1
        raw = int.from_bytes(self.mu.mem_read(at, size), 'big')
        shift = size * 8 - (x & 7) - w
        mask = ((1 << w) - 1) << shift
        raw = (raw & ~mask) | ((bits << shift) & mask)
        self.mu.mem_write(at, raw.to_bytes(size, 'big'))

    def read_pixel(self, bitmap, x, y):
        width, rows, bpr, planes = self.bitmap_info(bitmap)
        if not (0 <= x < width and 0 <= y < rows):
            return 0xffffffff
        return sum(self.plane_bits(ptr, bpr, x, y, 1) << p for p, ptr in enumerate(planes))

    def blt_bitmap(self, src, sx, sy, dst, dx, dy, w, h, minterm, mask):
        """BltBitMap: B = source, C = destination, minterm high nibble (A = 1).
        Like the original it does not clip; overlapping copies read first."""
        if w <= 0 or h <= 0:
            return 0
        _, _, sbpr, splanes = self.bitmap_info(src)
        _, _, dbpr, dplanes = self.bitmap_info(dst)
        full = (1 << w) - 1
        count = 0
        for p in range(min(len(splanes), len(dplanes))):
            if not mask & (1 << p):
                continue
            count += 1
            rows = [self.plane_bits(splanes[p], sbpr, sx, sy + y, w) for y in range(h)]
            for y, b in enumerate(rows):
                c = self.plane_bits(dplanes[p], dbpr, dx, dy + y, w) if minterm != 0xc0 else 0
                d = 0
                if minterm & 0x80: d |= b & c
                if minterm & 0x40: d |= b & ~c
                if minterm & 0x20: d |= ~b & c
                if minterm & 0x10: d |= ~b & ~c
                self.put_plane_bits(dplanes[p], dbpr, dx, dy + y, w, d & full)
        return count

    def init_rastport(self, rp):
        """InitRastPort: zeroed, Mask/FgPen/AOlPen -1, JAM2, solid line pattern."""
        self.mu.mem_write(rp, bytes(100))
        self.mu.mem_write(rp + 24, bytes((0xff, 0xff, 0, 0xff, 1, 0, 15)))
        self.put16(rp + 34, 0xffff)

    def pen_span(self, rp, x0, y, x1):
        """Pixels x0..x1 of row y in the FgPen (COMPLEMENT: inverted), within rp->Mask,
        clipped to the bitmap (no layers here)."""
        width, rows, bpr, planes = self.bitmap_info(self.u32(rp + 4))
        mask, pen, _, _, mode = self.mu.mem_read(rp + 24, 5)
        x0, x1 = max(x0, 0), min(x1, width - 1)
        if not 0 <= y < rows or x0 > x1:
            return
        w = x1 - x0 + 1
        full = (1 << w) - 1
        for p, ptr in enumerate(planes):
            if not mask & (1 << p):
                continue
            if mode & 2:
                bits = self.plane_bits(ptr, bpr, x0, y, w) ^ full
            else:
                bits = full if pen & (1 << p) else 0
            self.put_plane_bits(ptr, bpr, x0, y, w, bits)

    def rect_fill(self, rp, x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            self.pen_span(rp, x0, y, x1)

    def draw_line(self, rp, x0, y0, x1, y1):
        """Draw: Bresenham line including both ends (exact for horizontal and
        vertical lines; diagonal pixel choice of the hardware line mode is not modelled)."""
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x1 >= x0 else -1), (1 if y1 >= y0 else -1)
        err = dx + dy
        while True:
            self.pen_span(rp, x0, y0, x0)
            if x0 == x1 and y0 == y1:
                return
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def load_rgb32(self, table):
        """LoadRGB32: runs of (count, first, count * 3 left-justified longs), count 0 ends."""
        while count := self.u16(table):
            first = self.u16(table + 2)
            table += 4
            for i in range(count):
                r, g, b = struct.unpack('>III', self.mu.mem_read(table, 12))
                self.colors[(first + i) & 0xff] = (r >> 24, g >> 24, b >> 24)
                table += 12

    def palette_rgb(self):
        """The 256 colour registers as 768 bytes of 8-bit RGB."""
        return bytes(c for rgb in self.colors for c in rgb)

    def bitmap_pixels(self, bitmap, x=0, y=0, width=None, height=None):
        """Indexed (chunky) pixels of a BitMap region, one byte per pixel."""
        bm_width, rows, bpr, planes = self.bitmap_info(bitmap)
        width = bm_width - x if width is None else width
        height = rows - y if height is None else height
        out = bytearray()
        for row in range(y, y + height):
            pixels = 0
            for p, ptr in enumerate(planes):
                bits = self.plane_bits(ptr, bpr, x, row, width)
                pixels |= spread(bits, width) << p
            out += pixels.to_bytes(width, 'big')
        return bytes(out)

    def display_bitmap(self):
        """(BitMap, x, y, width, height) shown by the last LoadView: View.ViewPort ->
        RasInfo -> BitMap with RxOffset/RyOffset and DWidth/DHeight."""
        vp = self.u32(self.view) if self.view else 0
        if not vp:
            raise RuntimeError('no view has been loaded')
        ri = self.u32(vp + 36)
        return (self.u32(ri + 4), s16(self.u16(ri + 8)), s16(self.u16(ri + 10)),
                s16(self.u16(vp + 24)), s16(self.u16(vp + 26)))

    def display_pixels(self):
        bitmap, x, y, width, height = self.display_bitmap()
        return self.bitmap_pixels(bitmap, x, y, width, height)

    def chip_write(self, mu, access, at, size, value, _):
        """Records custom-register writes; BLTSIZE and BLTSIZH start a blit."""
        data = (value & ((1 << (size * 8)) - 1)).to_bytes(size, 'big')
        start = None
        for i, byte in enumerate(data):
            off = at - 0xdff000 + i
            word = self.custom.get(off & ~1, 0)
            word = (word & 0xff) | (byte << 8) if off & 1 == 0 else (word & 0xff00) | byte
            self.custom[off & ~1] = word
            if off & ~1 in (BLTSIZE, BLTSIZH) and (off & 1 or i == size - 1):
                start = off & ~1
        if start == BLTSIZE:
            size = self.custom[BLTSIZE]
            self.blit(size >> 6 or 1024, size & 0x3f or 64)
        elif start == BLTSIZH:
            self.blit(self.custom.get(BLTSIZV, 0) & 0x7fff or 0x8000,
                      self.custom[BLTSIZH] & 0x7ff or 0x800)

    def blit(self, height, width):
        """Area-mode blit of width words by height rows, run to completion."""
        reg = lambda off: self.custom.get(off, 0)
        con0, con1 = reg(BLTCON0), reg(BLTCON1)
        if con1 & 1:
            raise RuntimeError(f'blitter line mode is not emulated (BLTCON1 {con1:04x})')
        if con1 & 0x18:
            raise RuntimeError(f'blitter fill mode is not emulated (BLTCON1 {con1:04x})')
        use, lf = (con0 >> 8) & 15, con0 & 0xff
        ash, bsh = con0 >> 12, con1 >> 12
        desc = con1 & 2
        step = -2 if desc else 2
        ptr = {o: ((reg(o) << 16) | reg(o + 2)) & 0xfffffffe for o in (BLTAPT, BLTBPT, BLTCPT, BLTDPT)}
        mod = {o: s16(reg(m) & 0xfffe) * (-1 if desc else 1)
               for o, m in ((BLTAPT, BLTAMOD), (BLTBPT, BLTBMOD), (BLTCPT, BLTCMOD), (BLTDPT, BLTDMOD))}
        channels = [o for bit, o in ((8, BLTAPT), (4, BLTBPT), (2, BLTCPT)) if use & bit]
        fwm, lwm = reg(BLTAFWM), reg(BLTALWM)
        data = {BLTAPT: reg(BLTADAT), BLTBPT: reg(BLTBDAT), BLTCPT: reg(BLTCDAT)}
        aold = bold = 0
        for _ in range(height):
            for col in range(width):
                for o in channels:
                    data[o] = self.u16(ptr[o])
                    ptr[o] += step
                a = data[BLTAPT]
                if col == 0:
                    a &= fwm
                if col == width - 1:
                    a &= lwm
                b = data[BLTBPT]
                if desc:
                    sa = ((a << ash) | (aold >> (16 - ash))) & 0xffff
                    sb = ((b << bsh) | (bold >> (16 - bsh))) & 0xffff
                else:
                    sa = (((aold << 16) | a) >> ash) & 0xffff
                    sb = (((bold << 16) | b) >> bsh) & 0xffff
                aold, bold = a, b
                if use & 1:
                    self.put16(ptr[BLTDPT], minterm(lf, sa, sb, data[BLTCPT]))
                    ptr[BLTDPT] += step
            for o in (*channels, *((BLTDPT,) if use & 1 else ())):
                ptr[o] += mod[o]
        for o, value in ptr.items():
            self.custom[o], self.custom[o + 2] = (value >> 16) & 0xffff, value & 0xffff
        for o, d in ((BLTAPT, BLTADAT), (BLTBPT, BLTBDAT), (BLTCPT, BLTCDAT)):
            self.custom[d] = data[o]
        self.blits += 1

    def chip_read(self, mu, access, at, size, value, _):
        self.beam = (self.beam + 1) % 312
        values = {0x002: 0, 0x004: self.beam >> 8,
                  0x006: ((self.beam & 255) << 8) | (self.beam & 255), 0x01e: 0x20}
        image = bytearray(0x200)
        for off, word in values.items():
            struct.pack_into('>H', image, off, word)
        mu.mem_write(at, bytes(image[at - 0xdff000:at - 0xdff000 + size]))

    def cia_read(self, mu, access, at, size, value, _):
        mu.mem_write(at, b'\xff' * size)

    def on_return(self, mu, at, size, _):
        self.stop = 'return'
        mu.emu_stop()

    def on_fatal(self, mu, at, size, _):
        raise RuntimeError(f'game fatal error {self.r(UC_M68K_REG_D0)} at {label(at)}')

    def on_point(self, mu, at, size, _):
        if self.skip == at:
            self.skip = None
            return
        self.stop = 'frame' if at == MAIN_LOOP else 'tick'
        mu.emu_stop()

    def execute(self):
        self.stop = None
        pc = self.r(UC_M68K_REG_PC)
        try:
            self.mu.emu_start(pc, 0x2000000, count=10000000)
        except UcError as error:
            raise RuntimeError(f'{error} at {label(self.r(UC_M68K_REG_PC))}') from error
        if self.stop is None:
            raise RuntimeError(f'instruction limit at {label(self.r(UC_M68K_REG_PC))}')
        return self.stop

    def call(self, pc, data=0, input_event=None):
        context = self.mu.context_save()
        self.push(RETURN)
        self.w(UC_M68K_REG_A1, data)
        if input_event is not None:
            self.w(UC_M68K_REG_A0, input_event)
        self.w(UC_M68K_REG_PC, pc)
        try:
            if self.execute() != 'return':
                raise RuntimeError(f'interrupt did not return: {label(pc)}')
        except Exception:
            self.failure_pc = label(self.r(UC_M68K_REG_PC))
            raise
        finally:
            self.mu.context_restore(context)

    def tick(self):
        self.ticks += 1
        for server in self.vblank:
            self.call(self.u32(server + 18), self.u32(server + 14))
        for key, server in self.vectors.items():
            if isinstance(key, tuple):
                self.call(self.u32(server + 18), self.u32(server + 14))
        # Events with "tick" apply right after the servers of that cooperative tick (inside waits).
        while self.tick_index < len(self.tick_events) and self.tick_events[self.tick_index]['tick'] <= self.ticks:
            self.apply_event(self.tick_events[self.tick_index])
            self.tick_index += 1

    def apply_input(self):
        while self.event_index < len(self.events):
            event = self.events[self.event_index]
            if event['frame'] > self.frames:
                break
            self.apply_event(event)
            self.event_index += 1

    def apply_event(self, event):
        if 'joy' in event:
            self.joystick = event['joy']
        # Scenario setup only (e.g. warping to a room): writes h11 globals at this frame boundary.
        for poke in event.get('poke', ()):
            width = poke.get('width', 1)
            at = HUNKS[11].base + int(poke['g'], 16)
            self.mu.mem_write(at, (poke['value'] & ((1 << (8 * width)) - 1)).to_bytes(width, 'big'))
        if 'key' in event:
            key = event['key']
            if event.get('down', True):
                self.keys.add(key)
            else:
                self.keys.discard(key)
            if not self.input_handler:
                raise RuntimeError('input.device keyboard handler is not installed')
            raw = key | (0 if event.get('down', True) else 0x80)
            self.mu.mem_write(0x71000, bytes(22))
            self.mu.mem_write(0x71004, b'\x01')
            self.put16(0x71006, raw)
            self.call(self.u32(self.input_handler + 18),
                      self.u32(self.input_handler + 14), input_event=0x71000)

    def run_frames(self, n):
        target = max(self.frames, 0) + n
        last_frame_tick = self.ticks
        while self.frames < target and not self.exited:
            kind = self.execute()
            at = self.r(UC_M68K_REG_PC)
            if kind == 'return':
                self.exited = True
                raise RuntimeError(f'game exited before frame {target}')
            if kind == 'tick':
                for _ in range(POLL_TICKS.get(at, 1)):
                    self.tick()
                if self.ticks - last_frame_tick > 100000:
                    raise RuntimeError(f'no frame for 100000 ticks at {label(at)}')
            else:
                self.frames += 1
                last_frame_tick = self.ticks
                self.apply_input()
            self.skip = at
        return self.state()

    def state(self):
        player = self.u32(DATA + 0x85bc)
        return {'frame': self.frames, 'ticks': self.ticks,
                'pc': label(self.r(UC_M68K_REG_PC)),
                'scene_index': self.mu.mem_read(DATA + 0x8a24, 1)[0],
                'player': player,
                'player_x': self.u16(player + 0xa) if player else None,
                'player_y': self.u16(player + 0xc) if player else None,
                'demo_input_loaded': self.mu.mem_read(DATA + 0x2922, 1)[0],
                'failure_pc': self.failure_pc}

    def snapshot(self, name=None):
        OUT.mkdir(parents=True, exist_ok=True)
        name = name or f'{max(0, self.frames):05d}'
        regions = [{'name': f'h{n}', 'address': HUNKS[n].base, 'size': HUNKS[n].size}
                   for n in (11, 3, 7, 8, 10)]
        regions += [dict(b, name=f'heap-{i}') for i, b in enumerate(self.allocations) if not b['freed']]
        offset = 0
        with gzip.open(OUT / f'{name}.bin.gz', 'wb') as stream:
            for block in regions:
                block['offset'] = offset
                stream.write(bytes(self.mu.mem_read(block['address'], block['size'])))
                offset += block['size']
        meta = dict(self.state(), regions=regions, lvos=dict(self.lvos),
                    unimplemented=dict(self.unimplemented), libraries=self.libraries,
                    registers={str(reg): self.r(reg) for reg in (*REGS, UC_M68K_REG_PC, UC_M68K_REG_SR)},
                    log=self.log, keys=sorted(self.keys), joystick=self.joystick,
                    events=self.events, event_index=self.event_index,
                    input_handler=self.input_handler, vblank=self.vblank,
                    vectors={str(k): v for k, v in self.vectors.items()})
        (OUT / f'{name}.json').write_text(json.dumps(meta, indent=2) + '\n')
        return meta
