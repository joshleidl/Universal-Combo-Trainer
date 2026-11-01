// Chord helpers (SPEC §3, "Chords"). Pure functions; the attempt state machine uses them.

import type { ButtonId, ChordWindow, Grade, PressTiming, Step } from './types';

// Absorbs float error when comparing ms gaps (e.g. a 33.3 ms window and a 33.3 ms gap).
const MS_EPSILON = 1e-9;

/** True for a step with two or more buttons. */
export function isChord(step: Step): boolean {
  return step.buttons.length > 1;
}

/** A chord's window. Throws for a chord without one (validation rejects that). */
export function chordWindowOf(step: Step): ChordWindow {
  if (!step.chordWindow) throw new Error('Chord step has no chord window');
  return step.chordWindow;
}

/** Where a press landed: its corrected timestamp and its grid frame. */
export interface PressPoint {
  t: number;
  frame: number;
}

/**
 * True when a press at `at` is still inside the window opened by the chord's first press.
 * Frames compare grid frames; ms compare corrected timestamps.
 */
export function insideChordWindow(win: ChordWindow, first: PressPoint, at: PressPoint): boolean {
  if (win.unit === 'frames') return at.frame - first.frame <= win.size;
  return at.t - first.t <= win.size + MS_EPSILON;
}

/**
 * Grade of a complete chord from each press's timing (SPEC §3 Chords, rule 5): SPLIT when the
 * presses don't all share one grade; otherwise that grade.
 */
export function chordGrade(timings: readonly PressTiming[]): Grade {
  const first = timings[0];
  if (first === undefined) throw new Error('A chord needs at least one press');
  return timings.every((t) => t === first) ? first : 'SPLIT';
}

/** The chord's buttons not yet pressed, in the step's order. */
export function missingButtons(step: Step, pressed: readonly ButtonId[]): ButtonId[] {
  return step.buttons.filter((b) => !pressed.includes(b));
}
