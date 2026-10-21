/// <reference types="vite/client" />
// chiptune3's own player resolves its worklet relative to import.meta.url, which breaks once Vite
// prebundles/bundles it, so we drive its libopenmpt worklet directly. `?worker&url` bundles the worklet
// with its libopenmpt import (wasm is embedded); production builds need `worker.format: "es"`, since the
// default iife output rewrites import.meta.url to self.location, which doesn't exist in worklet scope.
import workletUrl from "chiptune3/chiptune3.worklet.js?worker&url";

export type Track = "dgen" | "dgen2";

export class Music {
  #node: Promise<AudioWorkletNode> | null = null;
  #track: Track | null = null;

  get track(): Track | null {
    return this.#track;
  }

  async play(track: Track): Promise<void> {
    this.#track = track;
    // The AudioContext has to be created synchronously inside the user gesture.
    this.#node ??= createNode();
    const [node, song] = await Promise.all([this.#node, fetchSong(track)]);
    if (this.#track !== track) return; // superseded by a later play() or stop()
    // The worklet replaces any current song and loops forever (repeatCount -1 by default).
    node.port.postMessage({ cmd: "play", val: song }, [song]);
  }

  stop(): void {
    this.#track = null;
    this.#node?.then((node) => node.port.postMessage({ cmd: "stop" }));
  }
}

async function createNode(): Promise<AudioWorkletNode> {
  const context = new AudioContext();
  await context.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(context, "libopenmpt-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  // Also drains the per-quantum position messages the worklet posts.
  node.port.onmessage = ({ data }) => {
    if (data.cmd === "err") console.error(`libopenmpt error: ${data.val}`);
  };
  node.connect(context.destination);
  return node;
}

async function fetchSong(track: Track): Promise<ArrayBuffer> {
  const response = await fetch(`/amiga/aga/${track}.mod`);
  if (!response.ok) throw new Error(`Failed to load ${track}.mod: ${response.status}`);
  return response.arrayBuffer();
}
