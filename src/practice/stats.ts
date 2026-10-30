// Session stats (SPEC §7): per-step on-time rate, average and spread of deltaFrames,
// and a running streak. Pure; the UI decides when a session resets.

import type { AttemptResult } from '../engine/types';

export interface StepStats {
  /** Attempts that got as far as this step (it received any grade). */
  readonly reached: number;
  readonly onTime: number;
  /** deltaFrames of every correct-button press (ON_TIME, EARLY or LATE). */
  readonly deltas: readonly number[];
}

export interface SessionStats {
  readonly attempts: number;
  readonly successes: number;
  /** Successful attempts in a row, ending with the latest attempt. */
  readonly streak: number;
  readonly bestStreak: number;
  readonly steps: readonly StepStats[];
}

export interface StepSummary {
  reached: number;
  onTime: number;
  /** onTime / reached, or null before the step has been reached. */
  onTimeRate: number | null;
  meanDelta: number | null;
  /** Population standard deviation of deltaFrames, or null with no presses. */
  spread: number | null;
}

export function emptyStats(stepCount: number): SessionStats {
  return {
    attempts: 0,
    successes: 0,
    streak: 0,
    bestStreak: 0,
    steps: Array.from({ length: stepCount }, () => ({ reached: 0, onTime: 0, deltas: [] })),
  };
}

/** Adds one finished attempt. */
export function recordAttempt(stats: SessionStats, result: AttemptResult): SessionStats {
  const steps = stats.steps.map((s, i) => {
    const r = result.results.find((x) => x.stepIndex === i);
    if (!r) return s;
    const timed = r.grade === 'ON_TIME' || r.grade === 'EARLY' || r.grade === 'LATE';
    return {
      reached: s.reached + 1,
      onTime: s.onTime + (r.grade === 'ON_TIME' ? 1 : 0),
      deltas: timed && r.deltaFrames !== undefined ? [...s.deltas, r.deltaFrames] : s.deltas,
    };
  });
  const streak = result.success ? stats.streak + 1 : 0;
  return {
    attempts: stats.attempts + 1,
    successes: stats.successes + (result.success ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    steps,
  };
}

export function summarizeStep(s: StepStats): StepSummary {
  const n = s.deltas.length;
  const mean = n > 0 ? s.deltas.reduce((a, b) => a + b, 0) / n : null;
  const spread =
    mean === null ? null : Math.sqrt(s.deltas.reduce((acc, d) => acc + (d - mean) ** 2, 0) / n);
  return {
    reached: s.reached,
    onTime: s.onTime,
    onTimeRate: s.reached > 0 ? s.onTime / s.reached : null,
    meanDelta: mean,
    spread,
  };
}
