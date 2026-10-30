// Practice session flow (Layer 4): runs attempts back to back on top of the engine, records
// stats, and re-arms after each attempt. Pure, like the engine: every function returns a new
// state. All timestamps are in the performance.now() clock.

import { arm, attemptResult, createAttempt, press, tick, type AttemptState } from '../engine/attempt';
import type { Combo, PressEvent, Settings } from '../engine/types';
import { emptyStats, recordAttempt, type SessionStats } from './stats';

/** After an attempt ends, the next one arms once there has been no input for this long. */
export const REARM_QUIET_MS = 1000;

export interface PracticeState {
  /** The attempt taking input now. */
  readonly attempt: AttemptState;
  /** The most recent finished attempt, kept for display while the next one waits to start. */
  readonly lastFinished: AttemptState | null;
  readonly stats: SessionStats;
  /** Time of the latest press or attempt end, used for the quiet period before re-arming. */
  readonly lastActivityAt: number | null;
}

/** Starts a session with an armed attempt. Throws if the combo or settings are invalid. */
export function createPractice(combo: Combo, settings: Settings, stats?: SessionStats): PracticeState {
  return {
    attempt: arm(createAttempt(combo, settings)),
    lastFinished: null,
    stats: stats && stats.steps.length === combo.steps.length ? stats : emptyStats(combo.steps.length),
    lastActivityAt: null,
  };
}

/** Feeds a mapped press into the current attempt. */
export function practicePress(state: PracticeState, ev: PressEvent): PracticeState {
  const attempt = press(state.attempt, ev);
  return afterStep({ ...state, lastActivityAt: latest(state.lastActivityAt, ev.timestamp) }, attempt, ev.timestamp);
}

/**
 * Advances time: ends the attempt with MISSED once its window has passed, and arms the next
 * attempt after REARM_QUIET_MS without input.
 */
export function practiceTick(state: PracticeState, now: number): PracticeState {
  const next = afterStep(state, tick(state.attempt, now), now);
  if (next.attempt.phase === 'done' && next.lastActivityAt !== null && now - next.lastActivityAt >= REARM_QUIET_MS) {
    return { ...next, attempt: arm(next.attempt) };
  }
  return next;
}

/**
 * Quick restart: arms a fresh attempt right away. An attempt in progress is abandoned and
 * not counted in the stats.
 */
export function practiceRestart(state: PracticeState): PracticeState {
  if (state.attempt.phase === 'armed' && state.attempt.results.length === 0) return state;
  return { ...state, attempt: arm(createAttempt(state.attempt.combo, state.attempt.settings)) };
}

/** Switches settings (e.g. strict mode). Arms a fresh attempt; stats and the last result stay. */
export function practiceWithSettings(state: PracticeState, settings: Settings): PracticeState {
  return { ...state, attempt: arm(createAttempt(state.attempt.combo, settings)) };
}

export function resetStats(state: PracticeState): PracticeState {
  return { ...state, stats: emptyStats(state.attempt.combo.steps.length), lastFinished: null };
}

/**
 * The attempt to show: the current one once it has a graded step or has ended, otherwise
 * the last finished one (so results stay on screen until the next attempt begins).
 */
export function shownAttempt(state: PracticeState): AttemptState {
  const a = state.attempt;
  if (a.results.length > 0 || a.phase === 'done' || !state.lastFinished) return a;
  return state.lastFinished;
}

function afterStep(state: PracticeState, attempt: AttemptState, at: number): PracticeState {
  if (attempt === state.attempt) return state;
  const justFinished = attempt.phase === 'done' && state.attempt.phase !== 'done';
  if (!justFinished) return { ...state, attempt };
  const result = attemptResult(attempt);
  return {
    attempt,
    lastFinished: attempt,
    stats: result ? recordAttempt(state.stats, result) : state.stats,
    lastActivityAt: latest(state.lastActivityAt, at),
  };
}

function latest(a: number | null, b: number): number {
  return a === null ? b : Math.max(a, b);
}
