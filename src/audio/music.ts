// The two OctaMED songs, rendered once to assets/music/<track>.ogg (Opus) by ./tools/extract-assets.ts and looped.
export type Track = "dgen" | "dgen2";

export class Music {
  #context: AudioContext | null = null;
  #buffers = new Map<Track, Promise<AudioBuffer>>();
  #source: AudioBufferSourceNode | null = null;
  #track: Track | null = null;

  get track(): Track | null {
    return this.#track;
  }

  async play(track: Track): Promise<void> {
    this.#stopSource();
    this.#track = track;
    // Created synchronously, so a click handler's gesture unlocks it; game cues create it before any gesture and resume() unlocks it.
    const context = (this.#context ??= new AudioContext());
    let buffer = this.#buffers.get(track);
    if (!buffer) this.#buffers.set(track, (buffer = fetchSong(context, track)));
    const song = await buffer;
    if (this.#track !== track || this.#source) return; // superseded by a later play() or stop()
    const source = new AudioBufferSourceNode(context, { buffer: song, loop: true });
    source.connect(context.destination);
    source.start();
    this.#source = source;
  }

  stop(): void {
    this.#track = null;
    this.#stopSource();
  }

  // Unlocks a context created before the page had a user gesture; call from a key or click handler.
  resume(): void {
    void this.#context?.resume();
  }

  #stopSource(): void {
    this.#source?.stop();
    this.#source?.disconnect();
    this.#source = null;
  }
}

async function fetchSong(context: AudioContext, track: Track): Promise<AudioBuffer> {
  const response = await fetch(`assets/music/${track}.ogg`); // relative to the page
  if (!response.ok) throw new Error(`Failed to load ${track}.ogg: ${response.status}`);
  return context.decodeAudioData(await response.arrayBuffer());
}
