// Loads GAME.EXE into a fresh machine the way DOS (as tools/emu/dosemu.py emulates it) does, runs the Borland C
// startup and main()'s prologue, and leaves the game ready for its frame loop (core/game.ts gameFrame).
import { gameInit } from "./core/game.ts";
import { startArgs, startupCheck } from "./dos/files.ts";
import { type Machine, PSP, attachMachine, int21, regs } from "./dos/machine.ts";
import { Memory } from "./memory.ts";

const LOAD = PSP + 0x10;
const ENVIRONMENT = 0x0700;
const ENVIRONMENT_TEXT = "PATH=C:\\\0\0\x01\0C:\\DGENER\\GAME.EXE\0";
const TOP_OF_MEMORY = 0xa000;

// Startup globals (Borland c0).
const PSP_SEGMENT = 0x2be6;
const STACK_LIMIT = 0x2be2;
const BRK = 0x2bd6;
const HEAP_BASE = 0x2bde;
const HEAP_TOP = 0x2be0;
const DATA_SEGMENT = 0x2bda;
const CODE_SEGMENT = 0x2bdc;
const DOS_HEAP_MODE = 0x2c1a;
const STACK_SIZE = 0x2c16;
const BSS_START = 0x2c36;
const BSS_END = 0x99b2;

// dos: the machine with every game file (including GAME.EXE) and the host's pacing hooks. memory/dac: optional
// (shared) buffers for the 1 MB address space and the DAC.
export function bootGame(dos: Machine, memory?: Uint8Array, dac?: Uint8Array): Memory {
  const exe = dos.files.get("GAME.EXE");
  if (!exe) throw new Error("GAME.EXE missing");
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const word = (at: number) => view.getUint16(at, true);
  const size = (word(4) - 1) * 512 + word(2);
  const headerSize = word(8) * 16;
  const imageDs = word(0x0e);
  const m = new Memory(LOAD + imageDs, memory, dac);
  const image = exe.slice(headerSize, size);
  const imageView = new DataView(image.buffer);
  for (let i = 0; i < word(6); i++) {
    const at = word(word(0x18) + i * 4 + 2) * 16 + word(word(0x18) + i * 4);
    imageView.setUint16(at, (imageView.getUint16(at, true) + LOAD) & 0xffff, true);
  }
  m.bytes.set(image, LOAD * 16);

  // Program segment prefix: int 20h, top of memory, empty command tail, environment.
  const psp = PSP * 16;
  m.bytes.set([0xcd, 0x20], psp);
  m.bytes[psp + 2] = TOP_OF_MEMORY & 0xff;
  m.bytes[psp + 3] = TOP_OF_MEMORY >> 8;
  m.bytes[psp + 0x80] = 0;
  m.bytes[psp + 0x81] = 0x0d;
  m.bytes[psp + 0x2c] = ENVIRONMENT & 0xff;
  m.bytes[psp + 0x2d] = ENVIRONMENT >> 8;
  for (let i = 0; i < ENVIRONMENT_TEXT.length; i++) m.bytes[ENVIRONMENT * 16 + i] = ENVIRONMENT_TEXT.charCodeAt(i);
  // Every interrupt vector points at an iret stub; BIOS video mode 3.
  m.bytes[0xfff00] = 0xcf;
  for (let v = 0; v < 256; v++) m.bytes.set([0x00, 0xff, 0x00, 0xf0], v * 4);
  m.bytes[0x449] = 3;

  attachMachine(m, dos);
  const [argc, argv] = cStartup(m);
  gameInit(m, argc, argv);
  return m;
}

// 0:fafc the Borland C0 entry: claim 64 KB for DGROUP, put the stack at its top, clear BSS, copy the command tail
// to the heap, then 0:fc69 start() builds argv. Returns main()'s (argc, argv).
function cStartup(m: Memory): [number, number] {
  // The DS at entry (the PSP) is kept in the code segment for the far exit path.
  m.bytes[LOAD * 16 + 0xfafa] = PSP & 0xff;
  m.bytes[LOAD * 16 + 0xfafb] = PSP >> 8;
  m.set16(PSP_SEGMENT, PSP);
  const paragraphs = (m.bytes[PSP * 16 + 2] | (m.bytes[PSP * 16 + 3] << 8)) - m.ds;
  if (paragraphs > 0x1000) int21(m, regs(m, { ax: 0x4a00, bx: m.ds + 0x1000 - PSP, es: PSP }));
  // With a near heap the stack is the top of DGROUP: SP 0 (wraps to 0xfffe on the first push).
  if (m.u16(DOS_HEAP_MODE)) throw new Error("DOS heap mode is not used by GAME.EXE");
  m.sp = 0;
  m.set16(STACK_LIMIT, 0xffff);
  const words = (BSS_END - BSS_START + 1) >> 1;
  for (let i = 0; i < words; i++) m.set16(BSS_START + i * 2, 0);
  // The command tail is empty: the copy is just its terminator.
  const argc = 1;
  const tail = m.u16(BRK);
  m.set8(tail, 0);
  const brk = (tail + 2) & 0xfffe;
  m.set16(BRK, brk);
  m.set16(HEAP_BASE, brk);
  m.set16(HEAP_TOP, (brk + m.u16(STACK_SIZE)) & 0xffff);
  m.set16(DATA_SEGMENT, m.ds);
  m.set16(CODE_SEGMENT, LOAD);
  startupCheck();
  m.push(4); // argc and the tail pointer pushed for start()
  return startArgs(m, tail, argc);
}
