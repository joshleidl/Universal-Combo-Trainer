// Practice session flow: runs attempts back to back on top of the engine, records stats, and
// runs the countdown before each attempt. Pure, like the engine: every function returns a new
// state. All timestamps are in the performance.now() clock.

import { arm, attemptResult, createAttempt, press, release, start, tick, type AttemptState } from '../engine/attempt';
import { isDirection, resolvePosition } from '../engine/direction';
import type { ButtonId, Combo, HeldPosition, PressEvent, ReleaseEvent, Settings } from '../engine/types';
import { emptyStats, recordAttempt, type SessionStats } from './stats';

/** Beats before "Go" (shown as 3, 2, 1). */
export const COUNTDOWN_BEATS = 3;
/** Time between countdown beats. */
export const COUNTDOWN_BEAT_MS = 500;
/**
 * Quiet time between whatever starts a countdown (an attempt ending, a press, restart) and its
 * first beat, so the result sound isn't drowned out and mashing doesn't keep sounding beat 3.
 */
export const COUNTDOWN_LEAD_MS = 500;

/** A countdown triggered at `t`; its first beat comes COUNTDOWN_LEAD_MS later. */
export const countdownFrom = (t: number): Countdown => ({ startAt: t + COUNTDOWN_LEAD_MS });

/** A running countdown. Beat k (0-based) sounds at `startAt + k * COUNTDOWN_BEAT_MS`; "Go" follows the last beat. */
export interface Countdown {
  readonly startAt: number;
}

export interface PracticeState {
  /** The attempt taking input now. During a countdown this may still be the finished one. */
  readonly attempt: AttemptState;
  /** The most recent finished attempt, kept for display while the next one waits to start. */
  readonly lastFinished: AttemptState | null;
  readonly stats: SessionStats;
  /** The countdown before the next attempt, or null when none is running. */
  readonly countdown: Countdown | null;
  /**
   * Every mapped control held right now (buttons and directions, in press order). Each new
   * attempt arms with it, so directions held across attempts count (SPEC §4, "Engine API:
   * directions").
   */
  readonly held: readonly ButtonId[];
}

/** What the live input display shows (SPEC §7, "Directions in the UI"). */
export interface LiveInput {
  /** The stick position after SOCD. */
  position: HeldPosition;
  /** Buttons held right now (no directions), in press order. */
  buttons: ButtonId[];
}

/** Time of "Go": frame 0 in countdown start mode; the attempt arms then in first-input mode. */
export const countdownGoAt = (c: Countdown) => c.startAt + COUNTDOWN_BEATS * COUNTDOWN_BEAT_MS;

/**
 * From this time (the last beat) presses count toward the attempt in countdown start mode,
 * so a press just before "Go" grades EARLY instead of restarting the countdown.
 */
export const countdownLiveAt = (c: Countdown) => countdownGoAt(c) - COUNTDOWN_BEAT_MS;

/** Times of every countdown sound: the beats, then "Go" last. */
export function countdownBeatTimes(c: Countdown): number[] {
  return Array.from({ length: COUNTDOWN_BEATS + 1 }, (_, k) => c.startAt + k * COUNTDOWN_BEAT_MS);
}

/**
 * What the countdown shows at `now`: beats left (3, 2, 1), 0 for "Go", or null before it
 * starts or after "Go".
 */
export function countdownShown(c: Countdown | null, now: number): number | null {
  if (!c || now < c.startAt) return null;
  const beat = Math.floor((now - c.startAt) / COUNTDOWN_BEAT_MS);
  if (beat > COUNTDOWN_BEATS) return null;
  return COUNTDOWN_BEATS - beat;
}

/**
 * Starts a session. First-input combos start armed, waiting for the first press. Countdown
 * combos wait for a button press (or restart) to start the countdown. `held` is the controls
 * held right now. Throws if the combo or settings are invalid.
 */
export function createPractice(
  combo: Combo,
  settings: Settings,
  stats?: SessionStats,
  held: readonly ButtonId[] = [],
): PracticeState {
  return {
    attempt: arm(createAttempt(combo, settings), held),
    lastFinished: null,
    stats: stats && stats.steps.length === combo.steps.length ? stats : emptyStats(combo.steps.length),
    countdown: null,
    held: [...held],
  };
}

/** The held stick position and buttons, for the live input display. */
export function liveInput(state: PracticeState): LiveInput {
  return { position: resolvePosition(state.held), buttons: state.held.filter((b) => !isDirection(b)) };
}

/** True when a countdown combo is idle, waiting for a press to start the countdown. */
export function waitingToStart(state: PracticeState): boolean {
  return (
    state.countdown === null &&
    state.attempt.combo.startMode === 'countdown' &&
    state.attempt.phase === 'armed'
  );
}

/**
 * Feeds a mapped press into the session. Only a button press starts or restarts a countdown; a
 * direction press only changes the held state (SPEC §7, "Countdowns").
 */
export function practicePress(state: PracticeState, ev: PressEvent): PracticeState {
  const t = ev.timestamp;
  // Catch up on countdown steps that are already due at the press time (ticks can lag).
  let st = withHeld(advanceCountdown(state, t), ev.button, true);

  // The engine keeps the held set in every phase, so a direction pressed during a countdown
  // counts once the attempt runs. A direction can also close a pending check.
  if (isDirection(ev.button)) return afterStep(st, press(st.attempt, ev), t);

  if (st.countdown) {
    // In countdown mode the attempt is live from the last beat; before that (and in
    // first-input mode throughout) a press restarts the countdown, so mashing out a dropped
    // combo can't start and fail the next attempt.
    if (st.attempt.phase !== 'running') return { ...st, countdown: countdownFrom(t) };
  } else if (waitingToStart(st)) {
    return { ...st, countdown: countdownFrom(t) };
  }

  return afterStep(st, press(st.attempt, ev), t);
}

/**
 * Feeds a mapped release into the session. It never starts or restarts a countdown; a
 * direction release changes the held position.
 */
export function practiceRelease(state: PracticeState, ev: ReleaseEvent): PracticeState {
  const t = ev.timestamp;
  const st = withHeld(advanceCountdown(state, t), ev.button, false);
  return afterStep(st, release(st.attempt, ev), t);
}

/**
 * Advances time: moves the countdown along, and ends the attempt with MISSED once its window
 * has passed.
 */
export function practiceTick(state: PracticeState, now: number): PracticeState {
  const st = advanceCountdown(state, now);
  return afterStep(st, tick(st.attempt, now), now);
}

/**
 * Quick restart. An attempt in progress is abandoned and not counted in the stats. First-input
 * combos arm right away; countdown combos start a fresh countdown.
 */
export function practiceRestart(state: PracticeState, now: number): PracticeState {
  const attempt = fresh(state.attempt, state.held);
  if (attempt.combo.startMode === 'countdown') return { ...state, attempt, countdown: countdownFrom(now) };
  if (attempt === state.attempt && state.countdown === null) return state;
  return { ...state, attempt, countdown: null };
}

/**
 * Switches settings (e.g. strict mode). Arms a fresh attempt with no countdown running; stats
 * and the last result stay.
 */
export function practiceWithSettings(state: PracticeState, settings: Settings): PracticeState {
  return { ...state, attempt: arm(createAttempt(state.attempt.combo, settings), state.held), countdown: null };
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

/**
 * A fresh armed attempt with the same combo and settings, armed with the controls `held` now
 * (or the current one if it already is fresh: it has been tracking the held directions itself).
 */
function fresh(attempt: AttemptState, held: readonly ButtonId[]): AttemptState {
  if (attempt.phase === 'armed' && attempt.results.length === 0 && attempt.ignoredPresses.length === 0) {
    return attempt;
  }
  return arm(createAttempt(attempt.combo, attempt.settings), held);
}

/** The state with `button` added to (down) or removed from the held controls. */
function withHeld(state: PracticeState, button: ButtonId, down: boolean): PracticeState {
  const isHeld = state.held.includes(button);
  if (down === isHeld) return state;
  return { ...state, held: down ? [...state.held, button] : state.held.filter((b) => b !== button) };
}

function advanceCountdown(state: PracticeState, now: number): PracticeState {
  const c = state.countdown;
  if (!c) return state;
  let attempt = state.attempt;
  if (attempt.combo.startMode === 'countdown') {
    // Frame 0 is "Go"; the attempt starts running at the last beat so early presses grade EARLY.
    if (attempt.phase !== 'running' && now >= countdownLiveAt(c)) {
      attempt = start(fresh(attempt, state.held), countdownGoAt(c));
    }
  } else if (now >= countdownGoAt(c)) {
    attempt = fresh(attempt, state.held);
  }
  const countdown = now >= countdownGoAt(c) ? null : c;
  if (attempt === state.attempt && countdown === c) return state;
  return { ...state, attempt, countdown };
}

function afterStep(state: PracticeState, attempt: AttemptState, at: number): PracticeState {
  if (attempt === state.attempt) return state;
  const justFinished = attempt.phase === 'done' && state.attempt.phase !== 'done';
  if (!justFinished) return { ...state, attempt };
  const result = attemptResult(attempt);
  return {
    ...state,
    attempt,
    lastFinished: attempt,
    stats: result ? recordAttempt(state.stats, result) : state.stats,
    // The countdown to the next attempt starts as soon as this one ends.
    countdown: countdownFrom(at),
  };
}
