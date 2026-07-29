import { audio } from './audio';

/**
 * Adaptive soundtrack.
 *
 * Kenney's music pack only contains short jingles, so the looping score is
 * synthesised here instead. It is a simple step sequencer over a minor
 * progression whose layers switch on as the fight gets hotter - build phases
 * are sparse and calm, boss waves get the full arrangement.
 */

const ROOT = 55; // A1
const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic
const PROGRESSION = [0, 0, 5, 7]; // i i iv v (semitone offsets)
const STEPS = 16;

function midiToFreq(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export class Music {
  private timer = 0;
  private step = 0;
  private bar = 0;
  private nextNoteTime = 0;
  private running = false;
  private intensity = 0;
  private targetIntensity = 0;
  private bus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private get ctx(): AudioContext | null {
    return audio.ctx;
  }

  start(): void {
    if (this.running) return;
    const ctx = this.ctx;
    if (!ctx || !audio.musicGain) return;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(audio.musicGain);
    this.bus.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2.5);

    this.noiseBuffer = this.makeNoise(ctx);
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.running = true;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.clearInterval(this.timer);
    const ctx = this.ctx;
    if (this.bus && ctx) {
      this.bus.gain.cancelScheduledValues(ctx.currentTime);
      this.bus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      const dying = this.bus;
      window.setTimeout(() => dying.disconnect(), 900);
    }
    this.bus = null;
  }

  /** 0 = calm build phase, 1 = boss wave chaos. */
  setIntensity(v: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, v));
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;

    this.intensity += (this.targetIntensity - this.intensity) * 0.02;
    const bpm = 96 + this.intensity * 34;
    const stepDur = 60 / bpm / 4;

    while (this.nextNoteTime < ctx.currentTime + 0.15) {
      this.playStep(ctx, this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step++;
      if (this.step >= STEPS) {
        this.step = 0;
        this.bar = (this.bar + 1) % PROGRESSION.length;
      }
    }
  }

  private playStep(ctx: AudioContext, step: number, time: number, stepDur: number): void {
    const chord = PROGRESSION[this.bar];
    const i = this.intensity;

    // --- bass: root on every quarter note
    if (step % 4 === 0) {
      this.tone(ctx, midiToFreq(ROOT + chord), time, stepDur * 3.2, 'triangle', 0.34, 0.02);
    }

    // --- kick + hat percussion, fades in with intensity
    if (i > 0.12) {
      if (step % 8 === 0) this.kick(ctx, time, 0.5);
      if (i > 0.35 && step % 4 === 2) this.kick(ctx, time, 0.28);
      if (i > 0.25 && step % 2 === 1) this.hat(ctx, time, 0.06 + i * 0.06);
    }

    // --- arpeggio, the main hook
    if (i > 0.05) {
      const degree = SCALE[(step * 3 + this.bar) % SCALE.length];
      const octave = step % 8 < 4 ? 24 : 36;
      const vol = 0.1 + i * 0.13;
      this.tone(ctx, midiToFreq(ROOT + chord + degree + octave), time, stepDur * 1.6, 'square', vol, 0.005);
    }

    // --- pad chord on the downbeat once things get serious
    if (i > 0.45 && step === 0) {
      for (const d of [0, 3, 7]) {
        this.tone(ctx, midiToFreq(ROOT + chord + d + 12), time, stepDur * 14, 'sawtooth', 0.05 + i * 0.04, 0.4);
      }
    }

    // --- high lead sparkle at peak intensity
    if (i > 0.7 && step % 16 === 12) {
      const degree = SCALE[(this.bar * 2) % SCALE.length];
      this.tone(ctx, midiToFreq(ROOT + chord + degree + 48), time, stepDur * 2, 'square', 0.07, 0.005);
    }
  }

  private tone(
    ctx: AudioContext, freq: number, time: number, dur: number,
    type: OscillatorType, vol: number, attack: number,
  ): void {
    if (!this.bus) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900 + this.intensity * 3800;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(filter).connect(gain).connect(this.bus);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  private kick(ctx: AudioContext, time: number, vol: number): void {
    if (!this.bus) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain).connect(this.bus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private hat(ctx: AudioContext, time: number, vol: number): void {
    if (!this.bus || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    src.connect(filter).connect(gain).connect(this.bus);
    src.start(time);
    src.stop(time + 0.08);
  }
}

export const music = new Music();
