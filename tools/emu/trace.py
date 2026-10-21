"""Records real calls of one GAME.EXE function as differential test cases.

The game plays its demo while being redirected through rooms; every call of the function (up to a limit, spread
over the run) is captured: full memory before the call, its stack arguments, and every byte it changed by the time
it returned, plus AX/DX. Nested calls of the same function are skipped. Output: out/difftest/<seg_off>.json plus
out/difftest/mem/<seg_off>-<k>.bin.gz with the memory before each call.

Usage: uv run --with unicorn tools/emu/trace.py <seg:off> [max cases=40] [args=4] [far|int]
  args  number of stack words to record as arguments
  far   the function is called with a far call (return address is IP and CS)
  int   the function is an interrupt handler (returns with iret: IP, CS, FLAGS)
"""
import gzip
import json
import os
import struct
import sys

from unicorn import UC_HOOK_CODE, UcError
from unicorn.x86_const import UC_X86_REG_AX, UC_X86_REG_CS, UC_X86_REG_DX, UC_X86_REG_SP, UC_X86_REG_SS

from dosemu import LOAD
from room_truth import SCENES
from snapshot import Session

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'out', 'difftest')
STACK_SLACK = 0x600
FRAMES_PER_ROOM = 6


def main():
    label = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    nargs = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    kind = sys.argv[4] if len(sys.argv) > 4 else 'near'
    far = kind in ('far', 'int')
    frame = {'near': 2, 'far': 4, 'int': 6}[kind]
    seg, off = (int(x, 16) for x in label.split(':'))
    entry = (LOAD + seg) * 16 + off
    name = f'{seg:x}_{off:04x}'
    os.makedirs(os.path.join(OUT, 'mem'), exist_ok=True)

    cases = []
    seen_calls = [0]
    pending = {}
    session = [None]

    def on_entry(mu, addr, size, _):
        if pending or len(cases) >= limit:
            return
        seen_calls[0] += 1
        # Sample: take early calls densely, later ones sparsely so cases spread over rooms.
        if len(cases) > limit // 2 and seen_calls[0] % 7:
            return
        ss, sp = mu.reg_read(UC_X86_REG_SS), mu.reg_read(UC_X86_REG_SP)
        stack = bytes(mu.mem_read(ss * 16 + sp, 6 + nargs * 2))
        ret_ip = struct.unpack_from('<H', stack, 0)[0]
        ret_cs = struct.unpack_from('<H', stack, 2)[0] if far else mu.reg_read(UC_X86_REG_CS)
        args = list(struct.unpack_from(f'<{nargs}H', stack, frame)) if kind != 'int' else []
        before = bytes(mu.mem_read(0, 0x100000))
        dac_before = bytes(session[0].emu.dac)
        ret_lin = ret_cs * 16 + ret_ip
        pending.update(before=before, dac=dac_before, args=args, sp=(sp + frame) & 0xffff, ss=ss, ret_lin=ret_lin)

        def on_return(mu2, addr2, size2, _2):
            if mu2.reg_read(UC_X86_REG_SP) != pending['sp']:
                return
            after = bytes(mu2.mem_read(0, 0x100000))
            b = pending['before']
            stack_top = pending['ss'] * 16 + pending['sp']
            changes = [[i, after[i]] for i in range(0x100000) if after[i] != b[i] and not (stack_top - STACK_SLACK <= i < stack_top + 0x40)]
            k = len(cases)
            with gzip.open(os.path.join(OUT, 'mem', f'{name}-{k}.bin.gz'), 'wb', compresslevel=6) as f:
                f.write(b)
            cases.append({'memory': f'{name}-{k}', 'ds': session[0].emu.ds(), 'ss': pending['ss'], 'sp': pending['sp'] - frame,
                          'args': pending['args'], 'dac': pending['dac'].hex(), 'dac_after': bytes(session[0].emu.dac).hex(), 'ax': mu2.reg_read(UC_X86_REG_AX), 'dx': mu2.reg_read(UC_X86_REG_DX), 'changes': changes})
            mu2.hook_del(pending['hook'])
            session[0].emu.block_irq = False
            pending.clear()

        session[0].emu.block_irq = True
        pending['hook'] = mu.hook_add(UC_HOOK_CODE, on_return, None, ret_lin, ret_lin)
        mu.ctl_flush_tb()

    def attach(s):
        s.emu.mu.hook_add(UC_HOOK_CODE, on_entry, None, entry, entry)
        s.emu.mu.ctl_flush_tb()
        session[0] = s

    attach(Session())
    for n in SCENES:
        if len(cases) >= limit:
            break
        try:
            session[0].enter(n, FRAMES_PER_ROOM)
        except (RuntimeError, UcError):
            pending.clear()
            session[0].emu.block_irq = False
            attach(Session())
    with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
        json.dump({'function': label, 'kind': kind, 'cases': cases}, f)
    print(f'{label}: {len(cases)} cases ({seen_calls[0]} calls seen)')


if __name__ == '__main__':
    main()
