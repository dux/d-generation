"""Reverse-engineering helpers for GAME.EXE: disassembly with segment:offset labels, cross references, DS reads.

Usage (needs capstone): cd tools/emu && uv run --with capstone --with unicorn python -i rekit.py
  L(0x4a69, 0x4aaa)          disassemble seg 0 code between two linear addresses
  fn('0:4a69')               disassemble from a seg:off label until the next 'ret'/'retf'
  callers('0:3f81')          near/far call sites of a function
  refs(0x337e)               instructions that mention a DS offset (memory operand or immediate)
  ds_u8/ds_u16(off)          initial data segment values from the EXE image
Addresses are "seg:off" with seg relative to the load image (code segments 0, fff, 12cc, 1485, 14c8, 14fd,
1504, 16a4, 17bf, 23ac); DS is paragraph 0x254b.
"""
import bisect
import os
import re
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_16

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
EXE = open(os.path.join(ROOT, 'dgener', 'GAME.EXE'), 'rb').read()
_h = struct.unpack_from('<14H', EXE, 0)
_cblp, _cp, _crlc, _cpar, _lfarlc = _h[1], _h[2], _h[3], _h[4], _h[12]
DS_SEG = _h[7]
IMAGE = EXE[_cpar * 16:(_cp - 1) * 512 + _cblp]
DS = DS_SEG * 16
_relocs = [struct.unpack_from('<HH', EXE, _lfarlc + i * 4) for i in range(_crlc)]
SEGMENTS = sorted({struct.unpack_from('<H', IMAGE, s * 16 + o)[0] for o, s in _relocs if struct.unpack_from('<H', IMAGE, s * 16 + o)[0] < DS_SEG})

_md = Cs(CS_ARCH_X86, CS_MODE_16)
_ins = {}
for _a, _b in zip(SEGMENTS, SEGMENTS[1:] + [DS_SEG]):
    pos, end = _a * 16, _b * 16
    while pos < end:
        progressed = False
        for i in _md.disasm(IMAGE[pos:end], pos):
            _ins[i.address] = (_a, i)
            pos = i.address + i.size
            progressed = True
        if not progressed or pos < end:
            pos += 1
_addrs = sorted(_ins)


def lin(label):
    """'fff:1a63' -> linear address in the image."""
    seg, off = label.split(':')
    return int(seg, 16) * 16 + int(off, 16)


def label(addr):
    seg = max(s for s in SEGMENTS if s * 16 <= addr)
    return f'{seg:x}:{addr - seg * 16:04x}'


def _fmt(seg, i):
    ops = i.op_str
    if i.mnemonic.startswith('j') or i.mnemonic in ('call', 'loop', 'loope', 'loopne', 'jcxz'):
        m = re.fullmatch(r'0x([0-9a-f]+)', ops)
        if m:
            ops = f'{seg:x}:{(int(m.group(1), 16) - seg * 16) & 0xffff:04x}'
    return f'{seg:x}:{i.address - seg * 16:04x}  {i.mnemonic} {ops}'


def L(a, b):
    k = bisect.bisect_left(_addrs, a)
    out = []
    while k < len(_addrs) and _addrs[k] < b:
        out.append(_fmt(*_ins[_addrs[k]]))
        k += 1
    return '\n'.join(out)


def fn(start, max_len=0x800):
    """Disassemble a function from its label until the first ret/retf (follows straight-line order)."""
    a = lin(start) if isinstance(start, str) else start
    k = bisect.bisect_left(_addrs, a)
    out = []
    while k < len(_addrs) and _addrs[k] < a + max_len:
        seg, i = _ins[_addrs[k]]
        out.append(_fmt(seg, i))
        if i.mnemonic in ('ret', 'retf'):
            break
        k += 1
    return '\n'.join(out)


def callers(target):
    seg, off = (int(x, 16) for x in target.split(':'))
    found = []
    for addr in _addrs:
        s, i = _ins[addr]
        if i.mnemonic == 'call' and s == seg and re.fullmatch(r'0x[0-9a-f]+', i.op_str):
            if (int(i.op_str, 16) - s * 16) & 0xffff == off:
                found.append(label(addr))
        elif i.mnemonic == 'lcall' and i.op_str.replace(' ', '') == f'{seg:#x},{off:#x}':
            found.append(label(addr))
    return found


def refs(ds_off, imm=True):
    out = []
    for addr in _addrs:
        s, i = _ins[addr]
        for m in re.finditer(r'0x([0-9a-f]+)', i.op_str):
            if int(m.group(1), 16) == ds_off and (imm or 'ptr' in i.op_str):
                out.append(_fmt(s, i))
                break
    return out


def ds_u8(off):
    return IMAGE[DS + off]


def ds_u16(off):
    return struct.unpack_from('<H', IMAGE, DS + off)[0]


def ds_bytes(off, n):
    return IMAGE[DS + off:DS + off + n]


def ds_str(off):
    end = IMAGE.index(b'\0', DS + off)
    return IMAGE[DS + off:end].decode('latin1')
