import type { Music, Track } from "../../audio/music.ts";
import { AMIGA_SOUNDS, PAULA_CLOCK, type AmigaSample, type AmigaSound } from "../../formats/sound.ts";

const CHANNELS = 4;
const PAN = [-1, 1, 1, -1]; // Paula: channels 0 and 3 left, 1 and 2 right
const MASTER = 0.5; // headroom for four full-volume channels

// The game's sound driver on WebAudio: h0:1551a picks the sound, h10:37f6 starts it on the first free Paula
// channel, h10:38dc frees a one-shot channel after its first pass. Looping sounds keep their channel until
// sound 0 stops all channels. Music plays the rendered songs (./src/audio/music.ts).
export class HostAudio {
  #context: AudioContext | null = null;
  #output: GainNode | null = null;
  readonly #buffers = new Map<AmigaSound, AudioBuffer>();
  readonly #channels: (AudioBufferSourceNode | null)[] = Array(CHANNELS).fill(null);
  #alternate = false; // g:60ec
  #last = 0; // g:60ed
  #track: Track | null = null;

  constructor(private readonly samples: AmigaSample[], private readonly music: Music, private muted: boolean) {}

  // Autoplay policy: the context starts from a key press.
  unlock(): void {
    if (!this.#context) {
      this.#context = new AudioContext();
      this.#output = new GainNode(this.#context, { gain: MASTER });
      this.#output.connect(this.#context.destination);
    }
    void this.#context.resume();
    this.music.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopAll();
    this.applyMusic();
  }

  // Music by game phase (null: none).
  cue(track: Track | null): void {
    if (track === this.#track) return;
    this.#track = track;
    this.applyMusic();
  }

  // h0:1551a playSound(id).
  play(id: number): void {
    // Sound 57 right after 22 is dropped.
    if (this.#last === 22 && id === 57) {
      this.#last = id;
      return;
    }
    // Sound 23 plays at volume 31 and alternates with 51.
    let volume = 63;
    if (id === 23) {
      this.#alternate = !this.#alternate;
      if (this.#alternate) id = 51;
      volume = 31;
    }
    this.#last = id;
    if (id === 0) return this.stopAll();
    const sound = AMIGA_SOUNDS.find((s) => s.id === id);
    if (!sound || this.muted || !this.#context || this.#context.state !== "running") return;
    // h10:37f6: the first free channel, none free drops the sound.
    const channel = this.#channels.indexOf(null);
    if (channel < 0) return;
    const context = this.#context;
    const source = new AudioBufferSourceNode(context, { buffer: this.buffer(sound), loop: !sound.oneShot });
    source
      .connect(new GainNode(context, { gain: volume / 64 }))
      .connect(new StereoPannerNode(context, { pan: PAN[channel] }))
      .connect(this.#output!);
    source.onended = () => {
      if (this.#channels[channel] === source) this.#channels[channel] = null;
    };
    this.#channels[channel] = source;
    source.start();
  }

  // h0:1572a: sound 0, every channel off.
  stopAll(): void {
    for (const [i, source] of this.#channels.entries()) {
      source?.stop();
      this.#channels[i] = null;
    }
  }

  private applyMusic(): void {
    if (this.muted || !this.#track) this.music.stop();
    else if (this.music.track !== this.#track) void this.music.play(this.#track);
  }

  // Signed 8-bit sample data at the Paula rate of the sound's period.
  private buffer(sound: AmigaSound): AudioBuffer {
    let buffer = this.#buffers.get(sound);
    if (buffer) return buffer;
    const { data } = this.samples[sound.sample];
    buffer = new AudioBuffer({ length: data.length, sampleRate: PAULA_CLOCK / sound.period, numberOfChannels: 1 });
    const out = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / 128;
    this.#buffers.set(sound, buffer);
    return buffer;
  }
}
