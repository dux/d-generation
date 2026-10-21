"""Minimal DOS + VGA environment that runs the original GAME.EXE under unicorn (16-bit real mode).

Only what D/Generation needs: DOS file and memory calls, mode 13h, the VGA DAC ports, a timer IRQ.
Used to capture ground-truth frames from the original game. Run scripts with `uv run --with unicorn`.
"""
import os
import struct
from unicorn import Uc, UcError, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE, UC_HOOK_INSN, UC_HOOK_INTR
from unicorn.x86_const import *

GAME = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dgener')
PSP = 0x0800
LOAD = PSP + 0x10
HEAP_TOP = 0x9FFF

class Dos:
    def __init__(self, args=b''):  # args: DOS command tail
        self.mu = mu = Uc(UC_ARCH_X86, UC_MODE_16)
        mu.mem_map(0, 0x110000)
        exe = open(os.path.join(GAME, 'GAME.EXE'), 'rb').read()
        h = struct.unpack_from('<14H', exe, 0)
        cblp, cp, crlc, cpar, minalloc, maxalloc, ss, sp, _, ip, cs, lfarlc = h[1:13]
        size = (cp - 1) * 512 + cblp
        image = bytearray(exe[cpar * 16:size])
        for i in range(crlc):
            off, seg = struct.unpack_from('<HH', exe, lfarlc + i * 4)
            at = seg * 16 + off
            struct.pack_into('<H', image, at, (struct.unpack_from('<H', image, at)[0] + LOAD) & 0xffff)
        mu.mem_write(LOAD * 16, bytes(image))
        # PSP
        psp = bytearray(256)
        psp[0:2] = b'\xcd\x20'
        struct.pack_into('<H', psp, 2, HEAP_TOP + 1)
        psp[0x80] = len(args)
        psp[0x81:0x81 + len(args) + 1] = args + b'\r'
        # environment segment with program name
        env = 0x0700
        mu.mem_write(env * 16, b'PATH=C:\\\0\0\x01\0C:\\DGENER\\GAME.EXE\0')
        struct.pack_into('<H', psp, 0x2c, env)
        mu.mem_write(PSP * 16, bytes(psp))
        self.alloc_next = 0x9000  # DOS blocks are handed out from here
        # IVT: point everything to a stub iret at F000:FF00
        mu.mem_write(0xFFF00, b'\xcf')
        for v in range(256):
            mu.mem_write(v * 4, struct.pack('<HH', 0xFF00, 0xF000))
        # BIOS data: equipment, video mode
        mu.mem_write(0x449, b'\x03')
        mu.reg_write(UC_X86_REG_CS, cs + LOAD)
        mu.reg_write(UC_X86_REG_IP, ip)
        mu.reg_write(UC_X86_REG_SS, ss + LOAD)
        mu.reg_write(UC_X86_REG_SP, sp)
        mu.reg_write(UC_X86_REG_DS, PSP)
        mu.reg_write(UC_X86_REG_ES, PSP)
        self.files = {}
        self.next_handle = 5
        self.dac = bytearray(768)
        self.dac_w = 0
        self.ticks = 0
        self.retrace = 0
        self.keys = []
        self.log = []
        self.exited = False
        self.halt = False
        mu.hook_add(UC_HOOK_INTR, self.on_intr)
        mu.hook_add(UC_HOOK_INSN, self.on_in, None, 1, 0, UC_X86_INS_IN)
        mu.hook_add(UC_HOOK_INSN, self.on_out, None, 1, 0, UC_X86_INS_OUT)

    # --- helpers
    def r(self, reg): return self.mu.reg_read(reg)
    def w(self, reg, v): self.mu.reg_write(reg, v & 0xffff)
    def lin(self, seg, off): return (seg << 4) + off
    def cstr(self, seg, off):
        b = self.mu.mem_read(self.lin(seg, off), 128)
        return bytes(b[:b.index(0)]).decode('latin1')
    def set_cf(self, on):
        f = self.r(UC_X86_REG_EFLAGS)
        self.w(UC_X86_REG_EFLAGS, (f | 1) if on else (f & ~1))
    def ok(self, ax=None):
        if ax is not None: self.w(UC_X86_REG_AX, ax)
        self.set_cf(False)
    def err(self, code):
        self.w(UC_X86_REG_AX, code); self.set_cf(True)
    def path(self, name):
        name = name.replace('\\', '/')
        if ':' in name: name = name.split(':', 1)[1]
        name = name.lstrip('/')
        if name.upper().startswith('DGENER/'): name = name[7:]
        # case-insensitive lookup
        cur = GAME
        for part in [p for p in name.split('/') if p and p != '.']:
            match = [e for e in os.listdir(cur) if e.upper() == part.upper()]
            if not match: return None
            cur = os.path.join(cur, match[0])
        return cur

    # --- interrupts (unicorn calls the hook instead of dispatching through the IVT; nothing is pushed)
    def on_intr(self, mu, intno, _):
        ah = self.r(UC_X86_REG_AX) >> 8
        off, seg = struct.unpack('<HH', mu.mem_read(intno * 4, 4))
        if intno not in (0x21, 0x10, 0x16) and (seg, off) != (0xF000, 0xFF00):
            self.raise_irq(intno, force=True); return
        if intno == 0x21: self.int21(ah)
        elif intno == 0x10: self.int10(ah)
        elif intno == 0x16: self.int16(ah)
        elif intno == 0x1a: self.w(UC_X86_REG_CX, 0); self.w(UC_X86_REG_DX, self.ticks)
        elif intno == 0x33: self.w(UC_X86_REG_AX, 0)
        elif intno == 0x11: self.w(UC_X86_REG_AX, 0x0021)
        elif intno == 0x12: self.w(UC_X86_REG_AX, 640)
        elif intno == 0x15: self.set_cf(True)
        else: self.log.append(f'int {intno:02x} ax={self.r(UC_X86_REG_AX):04x}')

    def int10(self, ah):
        if ah == 0x0f: self.w(UC_X86_REG_AX, 0x5003 if self.mu.mem_read(0x449, 1)[0] == 3 else 0x2813); self.w(UC_X86_REG_BX, 0)
        elif ah == 0x00: self.mu.mem_write(0x449, bytes([self.r(UC_X86_REG_AX) & 0x7f]))
        elif ah == 0x10 and (self.r(UC_X86_REG_AX) & 0xff) == 0x12:
            first, count = self.r(UC_X86_REG_BX), self.r(UC_X86_REG_CX)
            src = self.lin(self.r(UC_X86_REG_ES), self.r(UC_X86_REG_DX))
            self.dac[first * 3:(first + count) * 3] = self.mu.mem_read(src, count * 3)
        elif ah == 0x1a: self.w(UC_X86_REG_AX, 0x001a); self.w(UC_X86_REG_BX, 0x0008)  # VGA color
        elif ah == 0x12: self.w(UC_X86_REG_BX, 0x0003); self.w(UC_X86_REG_CX, 0x0009)
        else: self.log.append(f'int10 ax={self.r(UC_X86_REG_AX):04x}')

    def int16(self, ah):
        if ah in (0x01, 0x11):
            f = self.r(UC_X86_REG_EFLAGS)
            if self.keys: self.w(UC_X86_REG_AX, self.keys[0]); self.w(UC_X86_REG_EFLAGS, f & ~0x40)
            else: self.w(UC_X86_REG_EFLAGS, f | 0x40)
        elif ah in (0x00, 0x10):
            self.w(UC_X86_REG_AX, self.keys.pop(0) if self.keys else 0x011b)
        elif ah == 0x02: self.w(UC_X86_REG_AX, 0)

    def int21(self, ah):
        R = self.r; mu = self.mu
        al = R(UC_X86_REG_AX) & 0xff
        if ah == 0x30: self.w(UC_X86_REG_AX, 0x0005); self.w(UC_X86_REG_BX, 0); self.w(UC_X86_REG_CX, 0)
        elif ah in (0x25,): mu.mem_write(al * 4, struct.pack('<HH', R(UC_X86_REG_DX), R(UC_X86_REG_DS)))
        elif ah == 0x35:
            off, seg = struct.unpack('<HH', mu.mem_read(al * 4, 4)); self.w(UC_X86_REG_BX, off); self.w(UC_X86_REG_ES, seg)
        elif ah == 0x4a:
            seg, paras = R(UC_X86_REG_ES), R(UC_X86_REG_BX)
            if seg == PSP: self.alloc_next = seg + paras + 1
            self.ok()
        elif ah == 0x48:
            paras = R(UC_X86_REG_BX)
            if paras == 0xffff or self.alloc_next + paras > HEAP_TOP:
                self.w(UC_X86_REG_BX, max(0, HEAP_TOP - self.alloc_next)); self.err(8)
            else:
                seg = self.alloc_next; self.alloc_next += paras + 1; self.ok(seg)
        elif ah == 0x49: self.ok()
        elif ah == 0x3d:
            name = self.cstr(R(UC_X86_REG_DS), R(UC_X86_REG_DX)); p = self.path(name)
            self.log.append(f'open {name} -> {p}')
            if not p or not os.path.isfile(p): self.err(2); return
            hnd = self.next_handle; self.next_handle += 1
            self.files[hnd] = [bytearray(open(p, 'rb').read()), 0, p]
            self.ok(hnd)
        elif ah == 0x3c:
            name = self.cstr(R(UC_X86_REG_DS), R(UC_X86_REG_DX))
            hnd = self.next_handle; self.next_handle += 1
            self.files[hnd] = [bytearray(), 0, None]; self.log.append(f'create {name}'); self.ok(hnd)
        elif ah == 0x3e: self.files.pop(R(UC_X86_REG_BX), None); self.ok()
        elif ah == 0x3f:
            hnd, n = R(UC_X86_REG_BX), R(UC_X86_REG_CX)
            if hnd not in self.files: self.ok(0); return
            f = self.files[hnd]; data = f[0][f[1]:f[1] + n]; f[1] += len(data)
            mu.mem_write(self.lin(R(UC_X86_REG_DS), R(UC_X86_REG_DX)), bytes(data)); self.ok(len(data))
        elif ah == 0x40:
            hnd, n = R(UC_X86_REG_BX), R(UC_X86_REG_CX)
            data = bytes(mu.mem_read(self.lin(R(UC_X86_REG_DS), R(UC_X86_REG_DX)), n))
            if hnd in (1, 2): self.log.append('out: ' + data.decode('latin1'))
            elif hnd in self.files:
                f = self.files[hnd]; f[0][f[1]:f[1] + n] = data; f[1] += n
            self.ok(n)
        elif ah == 0x42:
            hnd = R(UC_X86_REG_BX); off = (R(UC_X86_REG_CX) << 16) | R(UC_X86_REG_DX)
            f = self.files.get(hnd)
            if not f: self.err(6); return
            base = [0, f[1], len(f[0])][al]
            if off & 0x80000000: off -= 1 << 32
            f[1] = base + off; self.w(UC_X86_REG_DX, f[1] >> 16); self.ok(f[1] & 0xffff)
        elif ah == 0x44:
            if al == 0: self.w(UC_X86_REG_DX, 0x80d3 if R(UC_X86_REG_BX) < 5 else 0x0002); self.ok()
            else: self.ok(0)
        elif ah == 0x4c: self.exited = True; self.log.append(f'exit {al}'); mu.emu_stop()
        elif ah == 0x2a: self.w(UC_X86_REG_CX, 1991); self.w(UC_X86_REG_DX, 0x0101); self.ok()
        elif ah == 0x2c: self.w(UC_X86_REG_CX, 0x0c00); self.w(UC_X86_REG_DX, self.ticks & 0xff); self.ok()
        elif ah == 0x19: self.ok(2)
        elif ah == 0x0e: self.ok(5)
        elif ah == 0x47: mu.mem_write(self.lin(R(UC_X86_REG_DS), R(UC_X86_REG_SI)), b'DGENER\0'); self.ok()
        elif ah == 0x3b: self.ok()
        elif ah == 0x1a: self.ok()
        elif ah == 0x4e: self.err(18)
        elif ah == 0x0b: self.ok(0)
        elif ah in (0x02, 0x09, 0x06): self.ok()
        else: self.log.append(f'int21 ah={ah:02x} ax={R(UC_X86_REG_AX):04x}'); self.ok()

    # --- ports
    def on_in(self, mu, port, size, _):
        if port == 0x3da:
            self.retrace ^= 0x09; return self.retrace
        if port == 0x60: return 0
        if port == 0x201: return 0xf0
        return 0

    def on_out(self, mu, port, size, value, _):
        if port == 0x3c8: self.dac_w = (value & 0xff) * 3
        elif port == 0x3c9:
            if self.dac_w < 768: self.dac[self.dac_w] = value & 0x3f; self.dac_w += 1

    # --- execution
    def raise_irq(self, vec, force=False):
        mu = self.mu
        off, seg = struct.unpack('<HH', mu.mem_read(vec * 4, 4))
        if (seg, off) == (0xF000, 0xFF00): return
        if not force and not (self.r(UC_X86_REG_EFLAGS) & 0x200): return
        ss, sp = self.r(UC_X86_REG_SS), self.r(UC_X86_REG_SP)
        sp = (sp - 6) & 0xffff
        mu.mem_write(self.lin(ss, sp), struct.pack('<HHH', self.r(UC_X86_REG_IP), self.r(UC_X86_REG_CS), self.r(UC_X86_REG_EFLAGS) & 0xffff))
        self.w(UC_X86_REG_SP, sp)
        self.w(UC_X86_REG_EFLAGS, self.r(UC_X86_REG_EFLAGS) & ~0x300)
        self.w(UC_X86_REG_CS, seg); self.w(UC_X86_REG_IP, off)

    def run(self, steps, slice_=20000, irq=True):
        """Runs `steps` slices of `slice_` instructions with a timer IRQ between them.
        A hook can set self.halt and call emu_stop() to pause exactly where it is (no IRQ is injected)."""
        mu = self.mu
        for _ in range(steps):
            if self.exited: return
            start = self.lin(self.r(UC_X86_REG_CS), self.r(UC_X86_REG_IP))
            try:
                mu.emu_start(start, 0x200000, count=slice_)
            except UcError as e:
                cs, ip = self.r(UC_X86_REG_CS), self.r(UC_X86_REG_IP)
                raise RuntimeError(f'{e} at {cs:04x}:{ip:04x} (image seg {cs - LOAD:04x})')
            if self.halt:
                self.halt = False
                return
            self.ticks = (self.ticks + 1) & 0xffff
            self.mu.mem_write(0x46c, struct.pack('<I', self.ticks))
            if irq: self.raise_irq(0x08)

    def screen(self):
        return bytes(self.mu.mem_read(0xA0000, 64000))

    def ds(self):
        return LOAD + 0x254b

    def call(self, off, *args, seg=LOAD, limit=400000000):
        """Near-call seg:off(args...) on the game's own stack and run until it returns."""
        mu = self.mu
        regs = [UC_X86_REG_AX, UC_X86_REG_BX, UC_X86_REG_CX, UC_X86_REG_DX, UC_X86_REG_SI, UC_X86_REG_DI, UC_X86_REG_BP,
                UC_X86_REG_SP, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS, UC_X86_REG_CS, UC_X86_REG_IP, UC_X86_REG_EFLAGS]
        saved = [self.r(x) for x in regs]
        ss = self.r(UC_X86_REG_SS)
        sp = (self.r(UC_X86_REG_SP) - 0x200) & 0xffff
        RET = 0xFFFE
        for a in reversed(args):
            sp -= 2; mu.mem_write(self.lin(ss, sp), struct.pack('<H', a & 0xffff))
        sp -= 2; mu.mem_write(self.lin(ss, sp), struct.pack('<H', RET))
        self.w(UC_X86_REG_SP, sp)
        self.w(UC_X86_REG_DS, self.ds())
        self.w(UC_X86_REG_CS, seg)
        self.w(UC_X86_REG_IP, off)
        self.w(UC_X86_REG_EFLAGS, self.r(UC_X86_REG_EFLAGS) & ~0x200)
        ret_lin = self.lin(seg, RET)
        done = []
        def stop(mu_, addr, size, _):
            if mu_.reg_read(UC_X86_REG_SP) == (sp + 2) & 0xffff and mu_.reg_read(UC_X86_REG_CS) == seg:
                done.append(1); mu_.emu_stop()
        h = mu.hook_add(UC_HOOK_CODE, stop, None, ret_lin, ret_lin)
        mu.ctl_flush_tb()
        try:
            mu.emu_start(self.lin(seg, off), 0x200000, count=limit)
        finally:
            mu.hook_del(h)
        ax = self.r(UC_X86_REG_AX)
        for x, v in zip(regs, saved): mu.reg_write(x, v)
        if not done: raise RuntimeError('call did not return')
        return ax
