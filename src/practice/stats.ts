// Session stats (SPEC §7): per-step on-time rate, average and spread of deltaFrames,
// and a running streak. Pure; the UI decides when a session resets.

import type { AttemptResult, Grade, StepResult } from '../engine/types';

/**
 * How a step's result is counted: its grade, except that a direction mistake (graded PARTIAL
 * or WRONG_BUTTON by the engine) counts on its own, as missing or wrong direction (SPEC §7).
 */
export type ResultKind = Grade | 'wrongDirection' | 'missingDirection';

const KINDS: readonly ResultKind[] = [
  'ON_TIME',
  'EARLY',
  'LATE',
  'SPLIT',
  'PARTIAL',
  'WRONG_BUTTON',
  'MISSED',
  'wrongDirection',
  'missingDirection',
];

const noCounts = (): Record<ResultKind, number> =>
  Object.fromEntries(KINDS.map((g) => [g, 0])) as Record<ResultKind, number>;

export function resultKind(r: StepResult): ResultKind {
  if (r.directionMistake === 'wrong') return 'wrongDirection';
  if (r.directionMistake === 'missing') return 'missingDirection';
  return r.grade;
}

export interface StepStats {
  /** Attempts that got as far as this step (it received any grade). */
  readonly reached: number;
  readonly onTime: number;
  /** How many times the step got each result. */
  readonly counts: Readonly<Record<ResultKind, number>>;
  /**
   * deltaFrames of every correct-button press (ON_TIME, EARLY, LATE, a complete SPLIT chord, or
   * a direction mistake: its buttons were right).
   */
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
  counts: Readonly<Record<ResultKind, number>>;
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
    const kind = resultKind(r);
    const timed = kind === 'ON_TIME' || kind === 'EARLY' || kind === 'LATE' || kind === 'SPLIT' || r.directionMistake !== undefined;
    return {
      reached: s.reached + 1,
      onTime: s.onTime + (r.grade === 'ON_TIME' ? 1 : 0),
      counts: { ...s.counts, [kind]: s.counts[kind] + 1 },
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
