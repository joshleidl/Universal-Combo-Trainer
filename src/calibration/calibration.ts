// Latency calibration (SPEC §6): the user taps along to a steady beat, and the median offset
// between beat and tap becomes the latency offset for that input source. Pure: timestamps are
// passed in (performance.now() clock), so it is tested with synthetic taps.

import type { InputSource } from '../engine/types';

/** Time between beats (120 BPM). */
export const CAL_BEAT_MS = 500;
/** Beats played first to find the rhythm. Taps on them aren't recorded. */
export const CAL_COUNT_IN = 4;
/** Beats whose taps are recorded (§6: about 20). */
export const CAL_BEATS = 20;
/** Quiet time between pressing Start and the first beat. */
export const CAL_LEAD_MS = 1000;
/** A source needs at least this many recorded taps for a result. */
export const CAL_MIN_TAPS = 10;
/** A tap belongs to the nearest beat, and only if it is closer than this (half a beat). */
export const CAL_MATCH_MS = CAL_BEAT_MS / 2;

export interface CalTap {
  /** Index into all beats, count-in included. */
  beat: number;
  source: InputSource;
  /** Tap time minus beat time: positive means the tap registered after the beat. */
  offsetMs: number;
}

export interface CalibrationState {
  /** Time of beat 0. */
  readonly startAt: number;
  readonly taps: readonly CalTap[];
}

export const CAL_TOTAL_BEATS = CAL_COUNT_IN + CAL_BEATS;

export function createCalibration(now: number): CalibrationState {
  return { startAt: now + CAL_LEAD_MS, taps: [] };
}

export const beatTime = (state: CalibrationState, beat: number) => state.startAt + beat * CAL_BEAT_MS;

/** Every beat's time, count-in first. */
export function beatTimes(state: CalibrationState): number[] {
  return Array.from({ length: CAL_TOTAL_BEATS }, (_, k) => beatTime(state, k));
}

/** Records a tap against the nearest recorded beat. Count-in taps, strays, and repeat taps on a beat are ignored. */
export function calibrationTap(state: CalibrationState, source: InputSource, timestamp: number): CalibrationState {
  const beat = Math.round((timestamp - state.startAt) / CAL_BEAT_MS);
  if (beat < CAL_COUNT_IN || beat >= CAL_TOTAL_BEATS) return state;
  const offsetMs = timestamp - beatTime(state, beat);
  if (Math.abs(offsetMs) >= CAL_MATCH_MS) return state;
  if (state.taps.some((t) => t.beat === beat && t.source === source)) return state;
  return { ...state, taps: [...state.taps, { beat, source, offsetMs }] };
}

/** True once the last beat's tap window has closed. */
export function calibrationFinished(state: CalibrationState, now: number): boolean {
  return now >= beatTime(state, CAL_TOTAL_BEATS - 1) + CAL_MATCH_MS;
}

/** What the page shows at `now`: count-in beats left (4..1), the recorded beat number (1..20), or nothing. */
export type CalPhase =
  | { kind: 'waiting' }
  | { kind: 'countIn'; left: number }
  | { kind: 'recording'; beat: number }
  | { kind: 'finished' };

export function calibrationPhase(state: CalibrationState, now: number): CalPhase {
  if (calibrationFinished(state, now)) return { kind: 'finished' };
  if (now < state.startAt) return { kind: 'waiting' };
  const beat = Math.min(CAL_TOTAL_BEATS - 1, Math.floor((now - state.startAt) / CAL_BEAT_MS));
  if (beat < CAL_COUNT_IN) return { kind: 'countIn', left: CAL_COUNT_IN - beat };
  return { kind: 'recording', beat: beat - CAL_COUNT_IN + 1 };
}

export interface SourceResult {
  source: InputSource;
  count: number;
  /** The suggested latency offset. */
  medianMs: number;
  /** Population standard deviation of the offsets: how steady the tapping was. */
  spreadMs: number;
  /** Enough taps (CAL_MIN_TAPS) to use the median. */
  usable: boolean;
}

/** Results for each source that tapped at least once, keyboard first. */
export function calibrationResults(state: CalibrationState): SourceResult[] {
  const out: SourceResult[] = [];
  for (const source of ['keyboard', 'gamepad'] as const) {
    const offsets = state.taps.filter((t) => t.source === source).map((t) => t.offsetMs);
    if (offsets.length === 0) continue;
    out.push({
      source,
      count: offsets.length,
      medianMs: median(offsets),
      spreadMs: stdDev(offsets),
      usable: offsets.length >= CAL_MIN_TAPS,
    });
  }
  return out;
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length === 0) return NaN;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function stdDev(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}
