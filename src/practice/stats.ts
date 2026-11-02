// Session stats (SPEC §7): per-step on-time rate, average and spread of deltaFrames,
// and a running streak. Pure; the UI decides when a session resets.

import type { AttemptResult, Grade } from '../engine/types';

const GRADES: readonly Grade[] = ['ON_TIME', 'EARLY', 'LATE', 'SPLIT', 'PARTIAL', 'WRONG_BUTTON', 'MISSED'];

const noCounts = (): Record<Grade, number> =>
  Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>;

export interface StepStats {
  /** Attempts that got as far as this step (it received any grade). */
  readonly reached: number;
  readonly onTime: number;
  /** How many times the step got each grade. */
  readonly counts: Readonly<Record<Grade, number>>;
  /** deltaFrames of every correct-button press (ON_TIME, EARLY, LATE, or a complete SPLIT chord). */
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
  counts: Readonly<Record<Grade, number>>;
  /** onTime / reached, or null before the step has been reached. */
  onTimeRate: number | null;
  meanDelta: number | null;
  /** Population standard deviation of deltaFrames, or null with no presses. */
  spread: number | null;
}

export function emptyStepStats(): StepStats {
  return { reached: 0, onTime: 0, counts: noCounts(), deltas: [] };
}

export function emptyStats(stepCount: number): SessionStats {
  return {
    attempts: 0,
    successes: 0,
    streak: 0,
    bestStreak: 0,
    steps: Array.from({ length: stepCount }, emptyStepStats),
  };
}

/** Adds one finished attempt. */
export function recordAttempt(stats: SessionStats, result: AttemptResult): SessionStats {
  const steps = stats.steps.map((s, i) => {
    const r = result.results.find((x) => x.stepIndex === i);
    if (!r) return s;
    const timed = r.grade === 'ON_TIME' || r.grade === 'EARLY' || r.grade === 'LATE' || r.grade === 'SPLIT';
    return {
      reached: s.reached + 1,
      onTime: s.onTime + (r.grade === 'ON_TIME' ? 1 : 0),
      counts: { ...s.counts, [r.grade]: s.counts[r.grade] + 1 },
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
    counts: s.counts,
    onTimeRate: s.reached > 0 ? s.onTime / s.reached : null,
    meanDelta: mean,
    spread,
  };
}
