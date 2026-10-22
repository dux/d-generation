"""Amiga hunk loader for the AGA executable (amiga/aga/dgen).

Hunk k is loaded at BASE + k * STRIDE and its RELOC32 entries are applied, so the image is what AmigaOS would
run if it placed the hunks there. Labels are "h<k>:<offset>" (hex), e.g. "h0:1a2c".
"""
import os
import struct

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
EXE_PATH = os.path.join(ROOT, 'amiga', 'aga', 'dgen')

BASE = 0x100000
STRIDE = 0x40000

HUNK_CODE, HUNK_DATA, HUNK_BSS = 0x3e9, 0x3ea, 0x3eb
HUNK_RELOC32, HUNK_SYMBOL, HUNK_DEBUG, HUNK_END, HUNK_HEADER = 0x3ec, 0x3f0, 0x3f1, 0x3f2, 0x3f3


class Hunk:
    def __init__(self, index, kind, size, data):
        self.index = index
        self.kind = kind  # 'code', 'data', 'bss'
        self.size = size  # bytes in memory (data is zero-padded up to this)
        self.data = bytearray(data) + bytearray(size - len(data))
        self.relocs = []  # (offset, target hunk)
        self.base = BASE + index * STRIDE


def load(path=EXE_PATH):
    raw = open(path, 'rb').read()
    u32 = lambda o: struct.unpack_from('>I', raw, o)[0]
    assert u32(0) == HUNK_HEADER
    o = 4
    while u32(o):
        o += 4 + u32(o) * 4
    o += 4
    first, last = u32(o + 4), u32(o + 8)
    o += 12
    sizes = [(u32(o + 4 * i) & 0x3fffffff) * 4 for i in range(last - first + 1)]
    o += 4 * len(sizes)
    hunks = []
    cur = None
    while o < len(raw):
        t = u32(o) & 0x3fffffff
        o += 4
        if t in (HUNK_CODE, HUNK_DATA):
            n = u32(o) * 4
            cur = Hunk(len(hunks), 'code' if t == HUNK_CODE else 'data', sizes[len(hunks)], raw[o + 4:o + 4 + n])
            hunks.append(cur)
            o += 4 + n
        elif t == HUNK_BSS:
            cur = Hunk(len(hunks), 'bss', sizes[len(hunks)], b'')
            hunks.append(cur)
            o += 4
        elif t == HUNK_RELOC32:
            while True:
                count = u32(o)
                o += 4
                if not count:
                    break
                target = u32(o)
                o += 4
                for i in range(count):
                    cur.relocs.append((u32(o + 4 * i), target))
                o += 4 * count
        elif t == HUNK_SYMBOL:
            while u32(o):
                o += 4 + u32(o) * 4 + 4
            o += 4
        elif t == HUNK_DEBUG:
            o += 4 + u32(o) * 4
        elif t == HUNK_END:
            pass
        else:
            raise ValueError(f'unknown hunk type {t:#x} at {o - 4:#x}')
    for h in hunks:
        for off, target in h.relocs:
            v = struct.unpack_from('>I', h.data, off)[0]
            struct.pack_into('>I', h.data, off, (v + hunks[target].base) & 0xffffffff)
    return hunks


HUNKS = load()


def hunk_at(addr):
    for h in HUNKS:
        if h.base <= addr < h.base + h.size:
            return h
    return None


def label(addr):
    h = hunk_at(addr)
    return f'h{h.index}:{addr - h.base:x}' if h else f'{addr:#x}'


def addr(lbl):
    """'h0:1a2c' -> absolute address."""
    if isinstance(lbl, int):
        return lbl
    k, off = lbl[1:].split(':')
    return HUNKS[int(k)].base + int(off, 16)


def read(a, n):
    h = hunk_at(a)
    o = a - h.base
    return bytes(h.data[o:o + n])


def u8(a):
    return read(a, 1)[0]


def u16(a):
    return struct.unpack('>H', read(a, 2))[0]


def u32(a):
    return struct.unpack('>I', read(a, 4))[0]


def cstr(a):
    h = hunk_at(a)
    o = a - h.base
    end = h.data.index(0, o)
    return h.data[o:end].decode('latin1')


if __name__ == '__main__':
    for h in HUNKS:
        print(f'h{h.index} {h.kind:4} base {h.base:#x} size {h.size:6} relocs {len(h.relocs)}')
