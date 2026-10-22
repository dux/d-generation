"""Reverse-engineering helpers for the AGA executable: disassembly with hunk labels, functions, callers, globals.

Usage: cd tools/m68k && uv run --with capstone python -i rekit.py
  fn('h0:1a2c')          disassemble a function (until the next function entry)
  L('h0:1a2c', 'h0:1b00') disassemble a range
  callers('h0:1a2c')     call sites of a function (bsr/jsr/pointer tables)
  refs(0x6498)           instructions that use global h11:6498 (as d16(a4) or absolute)
  strs('h0:1a2c')        strings a function references
  FUNCS                  sorted function entry addresses

Globals: the C code addresses its data through A4 = h11 + 0x8000 (SAS/C small data), so d16(a4) is shown as
g:<h11 offset>, e.g. -$1b68(a4) -> g:6498. h11 holds initialised data followed by BSS.
"""
import bisect
import re

from capstone import CS_ARCH_M68K, CS_MODE_M68K_020, Cs

import hunk
from hunk import HUNKS, addr, cstr, label

A4 = HUNKS[11].base + 0x8000
CODE_HUNKS = [h for h in HUNKS if h.kind == 'code']

_md = Cs(CS_ARCH_M68K, CS_MODE_M68K_020)
_ins = {}
for _h in CODE_HUNKS:
    pos, end = _h.base, _h.base + _h.size
    while pos < end:
        progressed = False
        for i in _md.disasm(bytes(_h.data[pos - _h.base:]), pos):
            _ins[i.address] = i
            pos = i.address + i.size
            progressed = True
        if not progressed:
            pos += 2
_addrs = sorted(_ins)

_TARGET = re.compile(r'\$([0-9a-f]+)(?:\.l)?(?:\(pc\))?$')


def _target(i):
    """Absolute branch/call target of an instruction, or None."""
    m = _TARGET.search(i.op_str)
    return int(m.group(1), 16) if m else None


def _is_call(i):
    return i.mnemonic in ('bsr', 'bsr.b', 'bsr.w', 'bsr.l', 'jsr')


# function entries: call targets in code + code pointers stored in data hunks
_calls = {}
for a in _addrs:
    i = _ins[a]
    if _is_call(i):
        t = _target(i)
        if t is not None and hunk.hunk_at(t) and hunk.hunk_at(t).kind == 'code':
            _calls.setdefault(t, []).append(a)
_pointers = {}
for h in HUNKS:
    if h.kind != 'data':
        continue
    for off, target in h.relocs:
        if HUNKS[target].kind == 'code':
            v = hunk.u32(h.base + off)
            _pointers.setdefault(v, []).append(h.base + off)
# Code after an rts/jmp/bra that no branch reaches is a function only called through a register or a
# computed pointer (SAS/C emits those right after the previous function's rts).
_branch_targets = set()
for a in _addrs:
    i = _ins[a]
    if i.mnemonic.startswith(('b', 'db')) and not _is_call(i) and not i.mnemonic.startswith('bt'):
        t = _target(i)
        if t is not None:
            _branch_targets.add(t)
_after_exit = set()
for k, a in enumerate(_addrs[:-1]):
    i = _ins[a]
    if i.mnemonic in ('rts', 'jmp', 'rte'):
        nxt = _addrs[k + 1]
        if nxt == a + i.size and nxt not in _branch_targets and _ins[nxt].mnemonic not in ('ori.b',):
            _after_exit.add(nxt)
FUNCS = sorted(set(_calls) | set(_pointers) | _after_exit | {h.base for h in CODE_HUNKS})


def func_of(a):
    """Entry of the function containing address a."""
    k = bisect.bisect_right(FUNCS, a) - 1
    return FUNCS[k] if k >= 0 else None


def g(off):
    """Global by h11 offset -> absolute address."""
    return HUNKS[11].base + off


def _fmt_ops(i):
    ops = i.op_str

    def a4(m):
        d = int(m.group(2), 16) * (-1 if m.group(1) else 1)
        return f'g:{d + 0x8000:x}'

    ops = re.sub(r'(-?)\$([0-9a-f]+)\(a4\)', a4, ops)

    def absl(m):
        v = int(m.group(1), 16)
        return label(v) if hunk.hunk_at(v) else m.group(0)

    return re.sub(r'\$([0-9a-f]{5,})(?:\.l)?', absl, ops)


def _fmt(i):
    s = f'{label(i.address):>10}  {i.mnemonic} {_fmt_ops(i)}'
    if i.address in _calls or i.address in _pointers:
        s = f'\n{label(i.address)}:  ; callers {len(_calls.get(i.address, []))}, pointers {len(_pointers.get(i.address, []))}\n' + s
    return s


def L(a, b):
    a, b = addr(a), addr(b)
    k = bisect.bisect_left(_addrs, a)
    out = []
    while k < len(_addrs) and _addrs[k] < b:
        out.append(_fmt(_ins[_addrs[k]]))
        k += 1
    return '\n'.join(out)


def fn(start):
    a = addr(start)
    k = bisect.bisect_right(FUNCS, a)
    end = FUNCS[k] if k < len(FUNCS) else hunk.hunk_at(a).base + hunk.hunk_at(a).size
    return L(a, end)


def callers(target):
    t = addr(target)
    return [label(a) + ' in ' + label(func_of(a)) for a in _calls.get(t, [])] + [
        'ptr ' + label(p) for p in _pointers.get(t, [])]


def _globals_of(i):
    out = set()
    for m in re.finditer(r'(-?)\$([0-9a-f]+)\(a4\)', i.op_str):
        out.add(int(m.group(2), 16) * (-1 if m.group(1) else 1) + 0x8000)
    for m in re.finditer(r'\$([0-9a-f]{5,})', i.op_str):
        v = int(m.group(1), 16)
        if HUNKS[11].base <= v < HUNKS[11].base + HUNKS[11].size:
            out.add(v - HUNKS[11].base)
    return out


def refs(off):
    return [f'{label(a)} in {label(func_of(a))}: {_fmt(_ins[a]).strip()}' for a in _addrs if off in _globals_of(_ins[a])]


def is_string(off, minlen=3):
    h = HUNKS[11]
    if not 0 <= off < len(h.data) or (off and h.data[off - 1] not in (0,) and False):
        return False
    try:
        s = cstr(h.base + off)
    except ValueError:
        return False
    return len(s) >= minlen and all(32 <= ord(c) < 127 or c in '\n\r\t' for c in s)


def strs(start):
    """Strings referenced by a function (pea/lea of globals that hold text)."""
    a = addr(start)
    k = bisect.bisect_right(FUNCS, a)
    end = FUNCS[k] if k < len(FUNCS) else a + 0x1000
    out = []
    j = bisect.bisect_left(_addrs, a)
    while j < len(_addrs) and _addrs[j] < end:
        for off in sorted(_globals_of(_ins[_addrs[j]])):
            if is_string(off):
                out.append((off, cstr(g(off))))
        j += 1
    return out


def callees(start):
    a = addr(start)
    k = bisect.bisect_right(FUNCS, a)
    end = FUNCS[k] if k < len(FUNCS) else a + 0x1000
    out = []
    j = bisect.bisect_left(_addrs, a)
    while j < len(_addrs) and _addrs[j] < end:
        i = _ins[_addrs[j]]
        if _is_call(i):
            t = _target(i)
            if t is not None:
                out.append(t)
        j += 1
    return out


if __name__ == '__main__':
    print(f'{len(_addrs)} instructions, {len(FUNCS)} functions')
