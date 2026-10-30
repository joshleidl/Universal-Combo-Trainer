// Short synthesized sounds (SPEC §7, optional audio). No audio files: each sound is a few
// oscillator tones. Sounds are scheduled by performance.now() time, converted to the audio
// clock, so countdown beats and metronome ticks land where the timing logic put them.

import type { Cue } from '../practice/cues';

export type SoundKind = Cue | 'beat' | 'go' | 'tick' | 'bound' | 'press';

export interface Tone {
  freq: number;
  /** Glide to this frequency over the tone. */
  endFreq?: number;
  /** Start, in ms after the sound's time. */
  at: number;
  dur: number;
  wave: OscillatorType;
  /** Peak level before the master volume, 0 to 1. */
  gain: number;
}

export const SOUNDS: Record<SoundKind, readonly Tone[]> = {
  beat: [{ freq: 880, at: 0, dur: 70, wave: 'square', gain: 0.25 }],
  go: [{ freq: 1320, at: 0, dur: 160, wave: 'square', gain: 0.3 }],
  tick: [{ freq: 2000, at: 0, dur: 25, wave: 'sine', gain: 0.5 }],
  onTime: [{ freq: 990, at: 0, dur: 70, wave: 'sine', gain: 0.45 }],
  off: [{ freq: 260, at: 0, dur: 90, wave: 'triangle', gain: 0.55 }],
  clean: [
    { freq: 660, at: 0, dur: 80, wave: 'sine', gain: 0.4 },
    { freq: 880, at: 80, dur: 80, wave: 'sine', gain: 0.4 },
    { freq: 1320, at: 160, dur: 160, wave: 'sine', gain: 0.4 },
  ],
  fail: [{ freq: 330, endFreq: 165, at: 0, dur: 260, wave: 'triangle', gain: 0.55 }],
  /** A step's expected press, in the timing preview. */
  press: [{ freq: 740, at: 0, dur: 90, wave: 'sine', gain: 0.5 }],
  bound: [
    { freq: 1175, at: 0, dur: 50, wave: 'sine', gain: 0.35 },
    { freq: 1568, at: 60, dur: 70, wave: 'sine', gain: 0.35 },
  ],
};

/** Audio-clock time (seconds) for a performance.now() time, given both clocks read together. */
export function toContextTime(atPerfMs: number, nowPerfMs: number, ctxNowSec: number): number {
  return Math.max(ctxNowSec, ctxNowSec + (atPerfMs - nowPerfMs) / 1000);
}

export interface ScheduledSound {
  /** Stops the sound, or keeps it from playing if it hasn't started. */
  cancel(): void;
}

const NOTHING: ScheduledSound = { cancel() {} };

/**
 * Plays sounds through one AudioContext, made on first use. Browsers keep audio suspended until
 * the user clicks or presses a key on the page (gamepad presses don't count), so the app calls
 * `unlock()` from those events.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private vol = 0.6;

  constructor(private readonly createContext: () => AudioContext | null = defaultContext) {}

  set volume(v: number) {
    this.vol = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.vol, this.ctx.currentTime);
  }

  get volume(): number {
    return this.vol;
  }

  /** True while the browser is holding audio back until a click or key press. */
  get blocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'suspended';
  }

  /** Call from a click or key press: creates and resumes the audio context. */
  unlock(): void {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  /** Plays `kind` at `atPerfMs` (default now). Times in the past play right away. */
  play(kind: SoundKind, atPerfMs?: number): ScheduledSound {
    const ctx = this.context();
    if (!ctx || !this.master) return NOTHING;
    const now = performance.now();
    const base = toContextTime(atPerfMs ?? now, now, ctx.currentTime);
    const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    for (const tone of SOUNDS[kind]) {
      const t0 = base + tone.at / 1000;
      const t1 = t0 + tone.dur / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.wave;
      osc.frequency.setValueAtTime(tone.freq, t0);
      if (tone.endFreq) osc.frequency.exponentialRampToValueAtTime(tone.endFreq, t1);
      // A 3 ms attack and an exponential fade avoid clicks.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(tone.gain, t0 + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t1 + 0.02);
      nodes.push({ osc, gain });
    }
    return {
      cancel() {
        for (const { osc, gain } of nodes) {
          gain.disconnect();
          try {
            osc.stop();
          } catch {
            // Already stopped.
          }
        }
      },
    };
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const ctx = this.createContext();
    if (!ctx) return null;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(ctx.destination);
    return ctx;
  }
}

function defaultContext(): AudioContext | null {
  try {
    return typeof AudioContext === 'undefined' ? null : new AudioContext({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}
