# Porting GAME.EXE to TypeScript

The game logic is ported function by function from the DOS executable.
Every ported function is checked against the original running in the emulator, on real calls recorded during play.

## Memory model

`./src/engine/memory.ts` is a flat 1 MB real-mode address space with the data segment at the same paragraph as in the emulator.
Ported functions read and write the same DS offsets, object structs, far buffers and shape banks as the original, so their effects can be compared byte for byte.
`m.u8/s8/u16/s16(off)` and `m.set8/set16(off, v)` work on DS offsets; far data goes through `m.bytes[seg * 16 + off]`.
Keep 16-bit semantics exact: wrap with `& 0xffff`, truncate bytes with `& 0xff`, sign-extend with `s8`/`s16` where the original uses `cbw`/`cwde`/signed compares.

Only the VGA path is ported.
The game checks display flags (`DS:2e5c` VGA, `DS:2e5e` EGA, `DS:2f08`, `DS:2f0a`); in VGA mode `DS:2e5c` is 1 and the others are 0, so EGA/CGA/Tandy branches and the driver segments `1504`, `16a4` and `17bf` are dropped.

## Code layout

* `./src/engine/<subsystem>.ts` for shared code (`random.ts`, runtime, geometry, rendering, scene, player, ...).
* `./src/engine/objects/<class>.ts` for one object class (class number = shape set id, see `doc/formats.md`).
* Each ported function is exported and starts with a comment giving its original address and signature, e.g. `// fff:1176 random(range): ...`.
* Name functions and DS globals by what they do once that is clear; until then use the address (`fn_0_4bb0`) or the offset with a short note.
* Constants for DS globals live at the top of the module that owns them; import them from there instead of repeating the number.

Calling convention: a port takes `(m: Memory, ...args)` with the original stack arguments as words, and returns the value the original leaves in AX (or DX:AX as one 32-bit number).
Byte arguments arrive as words; mask them like the original does.

Code pointers: the original calls functions through pointers stored in memory (class descriptor slots at `DS:191d`, qsort comparators, for-each callbacks, timer hooks).
Every port that can be reached that way registers itself with `register("0:4a69", fn)` from `./src/engine/dispatch.ts` at the bottom of its module, and callers use `callNear(m, offset, ...args)` / `call(m, label, ...args)`.
Register every exported port this way (it costs nothing and callers never have to know which ones are reached through pointers).

## Workflow for one function

1. Read it: `cd tools/emu && uv run --with capstone python -i rekit.py`, then `print(fn('0:4a69'))`, `callers('0:4a69')`, `refs(0x337e)`.
   `bottom_up` and `functions` in `out/callgraph.json` (from `uv run --with capstone python callgraph.py`) list callees and a bottom-up order.
2. Port every callee first (bottom up). A callee owned by another module is imported from that module.
3. Record cases: `uv run --with unicorn trace.py <seg:off> [max cases] [stack words] [far]` (from `tools/emu`).
   The game plays its demo and is redirected through every room; real calls are saved to `out/difftest/`.
   Functions that the demo never reaches need a scenario first; say so instead of guessing.
4. Register the port in `./tools/ports/<module>.ts` (`export const ports = { "fff:1176": { fn, returns: "ax" } }`).
5. `bun run difftest <seg:off>` must report every case passing.
   It compares every byte of memory (except the stack slack below SP) and the return value.

## Snapshots and tools

* `tools/emu/dosemu.py`: DOS/VGA environment around unicorn; `Dos.call(off, *args)` calls a near function.
* `tools/emu/snapshot.py [frames] [scene...]`: full memory in each room after N frames, `out/snapshots/`.
* `tools/emu/trace.py <seg:off> [n] [words] [near|far|int]`: per-function cases (memory, DAC, DOS machine state), `out/difftest/`.
* `tools/emu/rekit.py`: disassembly with `seg:off` labels, callers, DS references, initial DS values.
* `tools/emu/callgraph.py`: static call graph, `out/callgraph.json`.
* `tools/difftest.ts` (`bun run difftest`): replays cases against `tools/ports/*.ts`; cases with machine state go through `machineState` from `tools/ports/dos.ts`.
* `tools/emu/lockstep.py [frames] [stride]` and `tools/lockstep.ts [frames]`: whole-game check, see below.

Ignored in comparisons: the stack slack below SP, sprintf's cursor `DS:2d4a` (holds a stack address), and in lockstep also the timer handler's own stack and saved SS:SP (`DS:2740-27a1`, `14c8:010f-0112`).

## The whole game

`./src/engine/boot.ts` loads `GAME.EXE` like the emulator's DOS does (relocations, PSP, environment, interrupt vector stubs), runs the ported C startup and `main()`'s prologue, and `./src/engine/core/game.ts` `gameFrame()` runs one pass of the main loop.
`./src/engine/index.ts` imports every ported module so pointer calls resolve.

DOS, BIOS and hardware are `./src/engine/dos/` (`Machine`): files come from a preloaded map, interrupts go through the vector table in memory, ports 3c8/3c9 feed the DAC, `keyboardInterrupt(m, scancode)` raises int 9.
There are no asynchronous interrupts.
The game's wait loops (frame sync `0:2016`, delay `0:3b71`, menu pauses `0:ac71`, `0:acf1`, `0:b46a`) call `waitTick()` before every poll of their timer, which runs `Machine.pace` (the host's real-time wait) and then one timer interrupt.
When the game finds the BIOS keyboard buffer empty, `Machine.idle` lets the host deliver key events.

`tools/emu/lockstep.py` runs the original under exactly that timer rule and saves memory at every main-loop pass; `tools/lockstep.ts` boots the port and compares every frame.
The original also reads a few stack bytes it never wrote; their values are fixed in both (`UNINITIALISED` in lockstep.py, e.g. `0:42bd` record byte 3).
The demo runs identically for at least 8000 frames.

In the browser (`./src/play/`) the game runs in a worker on SharedArrayBuffers: the page draws A000 with the DAC every animation frame and pushes scancodes into a ring the worker delivers at `pace`/`idle`.
SharedArrayBuffer needs cross-origin isolation: `vite.config.ts` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; a production host must send them too.

## Coverage

628 functions are ported.
388 are verified against recorded calls; 240 never run in the demo (saving, conversations, many object behaviours) and are checked only by reading.
Covering them needs scripted input in lockstep runs (keys at given frames in both the emulator and the port).
