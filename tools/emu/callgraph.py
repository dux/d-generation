"""Static call graph of GAME.EXE: functions (call targets), their extent, callees and callers.

Writes out/callgraph.json: {label: {size, callees: [...], callers: [...], indirect: bool}} plus a bottom-up order.
Usage: cd tools/emu && uv run --with capstone python callgraph.py
"""
import bisect
import json
import os
import re

import rekit
from rekit import _addrs, _ins, SEGMENTS, label

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
CODE_SEGMENTS = [s for s in SEGMENTS if s != 0x23ac]  # 23ac is the hand-written VGA driver


def call_target(seg, ins):
    if ins.mnemonic == 'call' and re.fullmatch(r'0x[0-9a-f]+', ins.op_str):
        return seg, (int(ins.op_str, 16) - seg * 16) & 0xffff
    m = re.fullmatch(r'(0x[0-9a-f]+), (0x[0-9a-f]+)', ins.op_str)
    if ins.mnemonic == 'lcall' and m:
        return int(m.group(1), 16), int(m.group(2), 16)
    return None


def main():
    targets = set()
    for addr in _addrs:
        seg, ins = _ins[addr]
        t = call_target(seg, ins)
        if t:
            targets.add(t[0] * 16 + t[1])
    # descriptor slots of the 27 object classes are reached through call [bx+slot]
    for k in range(27):
        desc = rekit.ds_u16(0x191d + k * 2)
        for slot in range(0x0a, 0x16, 2):
            fn_off = rekit.ds_u16(desc + slot)
            if fn_off:
                targets.add(fn_off)
    starts = sorted(targets)
    graph = {}
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else start + 0x1000
        seg = max(s for s in SEGMENTS if s * 16 <= start)
        end = min(end, (min([s for s in SEGMENTS + [rekit.DS_SEG] if s > seg]) * 16))
        callees, indirect, size = set(), False, 0
        for k in range(bisect.bisect_left(_addrs, start), bisect.bisect_left(_addrs, end)):
            s, ins = _ins[_addrs[k]]
            addr = _addrs[k]
            size = addr + ins.size - start
            t = call_target(s, ins)
            if t:
                callees.add(f'{t[0]:x}:{t[1]:04x}')
            elif ins.mnemonic in ('call', 'lcall'):
                indirect = True
        graph[label(start)] = {'size': size, 'callees': sorted(callees), 'indirect': indirect}
    for name, info in graph.items():
        info['callers'] = []
    for name, info in graph.items():
        for c in info['callees']:
            if c in graph:
                graph[c]['callers'].append(name)
    order, seen = [], set()

    def visit(n, stack):
        if n in seen or n not in graph or n in stack:
            return
        stack.add(n)
        for c in graph[n]['callees']:
            visit(c, stack)
        stack.discard(n)
        seen.add(n)
        order.append(n)

    for n in graph:
        visit(n, set())
    with open(os.path.join(ROOT, 'out', 'callgraph.json'), 'w') as f:
        json.dump({'functions': graph, 'bottom_up': order}, f, indent=1)
    print(f'{len(graph)} functions, {sum(g["size"] for g in graph.values())} bytes')


if __name__ == '__main__':
    main()
