/**
 * Sound effects.
 *
 * Everything is decoded into AudioBuffers up front and played through a small
 * Web Audio graph so we get per-category volume, pitch variation and stereo
 * panning without any of the latency `<audio>` elements suffer from on mobile.
 */

const BASE = import.meta.env.BASE_URL;

const SFX_FILES: Record<string, string> = {
  click: 'sfx/click_001.ogg',
  select: 'sfx/select_001.ogg',
  tap: 'sfx/click_002.ogg',
  build: 'sfx/confirmation_001.ogg',
  upgrade: 'sfx/maximize_006.ogg',
  sell: 'sfx/minimize_006.ogg',
  deny: 'sfx/question_002.ogg',
  error: 'sfx/error_006.ogg',
  purchase: 'sfx/drop_001.ogg',
  item: 'sfx/switch_001.ogg',
  bell: 'sfx/bong_001.ogg',

  shotLight: 'sfx/impactmining_001.ogg',
  shotHeavy: 'sfx/impactmining_000.ogg',
  shotSnipe: 'sfx/impactmining_003.ogg',
  zap: 'sfx/impactplate_medium_003.ogg',
  boom: 'sfx/impactmetal_heavy_003.ogg',
  thud: 'sfx/impactplate_medium_000.ogg',
  hit: 'sfx/impactsoft_medium_000.ogg',
  splat: 'sfx/impactsoft_medium_003.ogg',
  death: 'sfx/impactpunch_medium_000.ogg',
  deathAlt: 'sfx/impactpunch_medium_001.ogg',
  shatter: 'sfx/impactglass_medium_000.ogg',
  gong: 'sfx/impactbell_heavy_001.ogg',

  magic1: 'sfx/magic/magical_1.ogg',
  magic2: 'sfx/magic/magical_2.ogg',
  magic3: 'sfx/magic/magical_3.ogg',
  magic4: 'sfx/magic/magical_4.ogg',
  magic5: 'sfx/magic/magical_5.ogg',
  magic6: 'sfx/magic/magical_6.ogg',
  magic7: 'sfx/magic/magical_7.ogg',
};

const MUSIC_FILES: Record<string, string> = {
  waveStart: 'music/jingles_nes07.ogg',
  waveClear: 'music/jingles_nes00.ogg',
  levelUp: 'music/jingles_nes10.ogg',
  defeat: 'music/jingles_nes13.ogg',
  boss: 'music/jingles_nes16.ogg',
};

export interface PlayOptions {
  volume?: number;
  /** Playback rate; also shifts pitch. */
  rate?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxGain: GainNode | null = null;
  musicGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private lastPlayed = new Map<string, number>();
  private ready = false;
  private loading: Promise<void> | null = null;

  sfxVolume = 0.75;
  musicVolume = 0.5;
  muted = false;

  /** Must be called from a user gesture on iOS. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    void this.loadAll();
  }

  applyVolumes(): void {
    if (!this.master || !this.sfxGain || !this.musicGain) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.sfxGain.gain.value = this.sfxVolume;
    this.musicGain.gain.value = this.musicVolume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  loadAll(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();

    const all = { ...SFX_FILES, ...MUSIC_FILES };
    this.loading = Promise.all(
      Object.entries(all).map(async ([key, file]) => {
        try {
          const res = await fetch(`${BASE}assets/${file}`);
          if (!res.ok) return;
          const bytes = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(bytes);
          this.buffers.set(key, buf);
        } catch {
          // A missing sound should never break the game.
        }
      }),
    ).then(() => {
      this.ready = true;
    });
    return this.loading;
  }

  /**
   * Play a sound. Identical sounds fired within `minGapMs` are dropped so a
   * flame turret cannot machine-gun the mixer into distortion.
   */
  play(name: string, opts: PlayOptions = {}, minGapMs = 45): void {
    if (!this.ready || !this.ctx || !this.sfxGain || this.muted) return;
    const buf = this.buffers.get(name);
    if (!buf) return;

    const now = this.ctx.currentTime * 1000;
    const last = this.lastPlayed.get(name) ?? -1e9;
    if (now - last < minGapMs) return;
    this.lastPlayed.set(name, now);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;

    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;

    if (opts.pan !== undefined && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      src.connect(gain).connect(panner).connect(this.sfxGain);
    } else {
      src.connect(gain).connect(this.sfxGain);
    }
    src.start();
  }

  /** Jingles route through the music bus so they duck with the soundtrack. */
  jingle(name: string, volume = 0.9): void {
    if (!this.ready || !this.ctx || !this.musicGain || this.muted) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.musicGain);
    src.start();
  }

  /** Random pitch variation keeps repeated impacts from sounding robotic. */
  vary(name: string, base = 1, spread = 0.14, opts: PlayOptions = {}, minGapMs = 45): void {
    this.play(name, { ...opts, rate: base + (Math.random() - 0.5) * spread * 2 }, minGapMs);
  }
}

export const audio = new AudioEngine();
