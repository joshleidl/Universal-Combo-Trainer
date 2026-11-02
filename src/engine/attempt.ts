// Attempt state machine: idle → armed → running → done (SPEC §3–4).
// Every function is pure: it takes a state and returns a new one. Calls that make
// no sense for the current phase return the state unchanged.

import { chordGrade, chordWindowOf, insideChordWindow, isChord } from './chord';
import {
  DEFAULT_SETTINGS,
  correctedTimestamp,
  frameToMs,
  gradeFrames,
  lastAcceptedFrame,
  msToFrame,
} from './timing';
import type {
  AttemptEnd,
  AttemptPhase,
  AttemptResult,
  ButtonId,
  ChordPress,
  Combo,
  Grade,
  PressEvent,
  Settings,
  Step,
  StepResult,
} from './types';
import { DIRECTION_BUTTONS } from './types';

export interface AttemptState {
  readonly phase: AttemptPhase;
  readonly combo: Combo;
  readonly settings: Settings;
  readonly results: readonly StepResult[];
  readonly ignoredPresses: readonly PressEvent[];
  /** Frame 0 timestamp (latency-corrected for firstInput; the countdown time for countdown). */
  readonly frame0: number | null;
  /** Grid frame (frames since frame 0) the most recent graded press landed on. */
  readonly lastInputFrame: number | null;
  readonly endedBy: AttemptEnd | null;
  /** The awaited chord step's presses so far, or null when no chord is being collected. */
  readonly chord: PendingChord | null;
}

/** A press of a chord being collected, with its latency-corrected timestamp. */
export interface PendingPress {
  readonly ev: PressEvent;
  readonly t: number;
}

/** A chord being collected for the awaited step (SPEC §3, "Chords"). */
export interface PendingChord {
  /** Presses so far, in order. */
  readonly presses: readonly PendingPress[];
  /**
   * Every button has been pressed. The chord stays open until the end of the grid frame it
   * completed on, so a press on that frame counts as an extra press.
   */
  readonly complete: boolean;
}

const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

/** Returns a list of problems; empty means the combo is valid. */
export function validateCombo(combo: Combo): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(combo.fps) || combo.fps <= 0) errors.push('fps must be a positive number');
  if (combo.steps.length === 0) errors.push('combo must have at least one step');
  combo.steps.forEach((s, i) => {
    errors.push(...buttonErrors(s, i + 1));
    if (!isNonNegInt(s.targetFrame)) errors.push(`step ${i + 1}: targetFrame must be an integer ≥ 0`);
    if (!isNonNegInt(s.tolEarly)) errors.push(`step ${i + 1}: tolEarly must be an integer ≥ 0`);
    if (!isNonNegInt(s.tolLate)) errors.push(`step ${i + 1}: tolLate must be an integer ≥ 0`);
  });
  return errors;
}

function buttonErrors(s: Step, n: number): string[] {
  if (!Array.isArray(s.buttons) || s.buttons.length === 0 || s.buttons.some((b) => !b)) {
    return [`step ${n}: button is required`];
  }
  const errors: string[] = [];
  const twice = s.buttons.find((b, j) => s.buttons.indexOf(b) !== j);
  if (twice !== undefined) errors.push(`step ${n}: ${twice} is in the chord twice`);
  if (s.buttons.length > 1) {
    const dirs = s.buttons.filter((b) => DIRECTION_BUTTONS.includes(b));
    if (dirs.length > 0) errors.push(`step ${n}: directions can't be part of a chord (${dirs.join(', ')})`);
    const w = s.chordWindow;
    if (!w) errors.push(`step ${n}: chordWindow is required for a chord`);
    else if (w.unit === 'frames') {
      if (!isNonNegInt(w.size)) errors.push(`step ${n}: chordWindow must be a whole number of frames ≥ 0`);
    } else if (w.unit === 'ms') {
      if (!Number.isFinite(w.size) || w.size < 0) errors.push(`step ${n}: chordWindow must be a number of ms ≥ 0`);
    } else {
      errors.push(`step ${n}: chordWindow unit must be frames or ms`);
    }
  }
  return errors;
}

export function validateSettings(settings: Settings): string[] {
  const errors: string[] = [];
  if (!isNonNegInt(settings.timeoutFrames)) errors.push('timeoutFrames must be an integer ≥ 0');
  for (const [source, ms] of Object.entries(settings.latencyOffsetMs)) {
    if (!Number.isFinite(ms)) errors.push(`latencyOffsetMs.${source} must be a finite number`);
  }
  return errors;
}

/** Creates an idle attempt. Throws if the combo or settings are invalid. */
export function createAttempt(combo: Combo, settings: Settings = DEFAULT_SETTINGS): AttemptState {
  const errors = [...validateCombo(combo), ...validateSettings(settings)];
  if (errors.length > 0) throw new Error(`Invalid attempt: ${errors.join('; ')}`);
  return {
    phase: 'idle',
    combo,
    settings,
    results: [],
    ignoredPresses: [],
    frame0: null,
    lastInputFrame: null,
    endedBy: null,
    chord: null,
  };
}

/** Readies an attempt for input. From `done`, this starts a fresh attempt (quick restart). */
export function arm(state: AttemptState): AttemptState {
  if (state.phase === 'idle') return { ...state, phase: 'armed' };
  if (state.phase === 'done') return { ...createAttempt(state.combo, state.settings), phase: 'armed' };
  return state;
}

/**
 * Countdown mode only: sets frame 0 and starts running. `frame0Timestamp` may be in
 * the future (the UI can schedule the end of its countdown); presses before it grade EARLY.
 */
export function start(state: AttemptState, frame0Timestamp: number): AttemptState {
  if (state.phase !== 'armed' || state.combo.startMode !== 'countdown') return state;
  return { ...state, phase: 'running', frame0: frame0Timestamp };
}

/** Index of the step currently awaited, or null if none. */
export function currentStepIndex(state: AttemptState): number | null {
  if (state.phase === 'running') return state.results.length;
  if (state.phase === 'armed' && state.combo.startMode === 'firstInput') return 0;
  return null;
}

/**
 * Where the given step is counted from, on the fixed frame grid that starts at frame 0
 * (DECISIONS.md, "Fixed frame grid"). Relative steps count from the frame the previous
 * press landed on; absolute steps and the first step count from frame 0.
 */
function referenceFor(state: AttemptState, stepIndex: number): { frame0: number; refFrame: number } {
  if (state.frame0 === null) throw new Error('No frame 0: attempt is not running');
  const relative = state.combo.timingMode === 'relative' && stepIndex > 0;
  if (relative && state.lastInputFrame === null) throw new Error('No previous input frame');
  return { frame0: state.frame0, refFrame: relative ? (state.lastInputFrame as number) : 0 };
}

/** Frames since frame 0 for a corrected timestamp. */
function gridFrame(t: number, frame0: number, fps: number): number {
  return msToFrame(t - frame0, fps);
}

function stepAt(state: AttemptState, index: number): Step {
  const step = state.combo.steps[index];
  if (!step) throw new Error(`No step at index ${index}`);
  return step;
}

function finish(state: AttemptState, result: StepResult, endedBy: AttemptEnd): AttemptState {
  return { ...state, phase: 'done', results: [...state.results, result], endedBy, chord: null };
}

function missedResult(state: AttemptState, index: number): StepResult {
  return { stepIndex: index, expected: [...stepAt(state, index).buttons], grade: 'MISSED' };
}

const isStartStep = (state: AttemptState, index: number) =>
  index === 0 && state.combo.startMode === 'firstInput';

/** Buttons of the awaited chord pressed so far, or null when no chord is being collected. */
export function chordProgress(state: AttemptState): ButtonId[] | null {
  return state.chord ? state.chord.presses.map((p) => p.ev.button) : null;
}

/** Feeds one press edge into the attempt. */
export function press(state: AttemptState, ev: PressEvent): AttemptState {
  // In countdown mode, presses before start() are ignored.
  const accepts = state.phase === 'running' || (state.phase === 'armed' && state.combo.startMode === 'firstInput');
  if (!accepts) return state;
  const t = correctedTimestamp(ev, state.settings);
  // A chord that is due to close by now closes before this press is looked at.
  const st = resolveChord(state, t);
  if (st.phase === 'armed') return pressWhileArmed(st, ev, t);
  if (st.phase === 'running') return pressWhileRunning(st, ev, t);
  return st;
}

function pressWhileArmed(state: AttemptState, ev: PressEvent, t: number): AttemptState {
  const step = stepAt(state, 0);
  if (isChord(step)) return chordPress(state, 0, ev, t);

  if (ev.button !== step.buttons[0]) {
    if (!state.settings.strict) return { ...state, ignoredPresses: [...state.ignoredPresses, ev] };
    return finish(
      state,
      { stepIndex: 0, expected: [...step.buttons], grade: 'WRONG_BUTTON', press: ev, correctedTimestamp: t },
      'wrongButton',
    );
  }

  // The first press defines frame 0 and is always on time (SPEC §3, startMode firstInput).
  const result: StepResult = {
    stepIndex: 0,
    expected: [...step.buttons],
    grade: 'ON_TIME',
    press: ev,
    correctedTimestamp: t,
    elapsedMs: 0,
    inputFrame: 0,
    deltaFrames: 0,
    deltaMs: 0,
  };
  const next: AttemptState = {
    ...state,
    phase: 'running',
    frame0: t,
    lastInputFrame: 0,
    results: [result],
  };
  return state.combo.steps.length === 1 ? { ...next, phase: 'done', endedBy: 'completed' } : next;
}

function pressWhileRunning(state: AttemptState, ev: PressEvent, t: number): AttemptState {
  const index = state.results.length;
  const step = stepAt(state, index);
  if (isChord(step)) return chordPress(state, index, ev, t);
  const fps = state.combo.fps;
  const { frame0, refFrame } = referenceFor(state, index);
  const pressFrame = gridFrame(t, frame0, fps);
  // Whole-frame math on the grid, so float error can't move a press across a frame edge.
  const inputFrame = pressFrame - refFrame;
  const elapsedMs = t - (frame0 + frameToMs(refFrame, fps));

  // A press past the timeout means the step was already missed, whatever the button.
  if (inputFrame > lastAcceptedFrame(step, state.settings.timeoutFrames)) {
    return finish(state, missedResult(state, index), 'missed');
  }

  const timing = gradeFrames(step, inputFrame, elapsedMs, fps);
  const base = {
    stepIndex: index,
    expected: [...step.buttons],
    press: ev,
    correctedTimestamp: t,
    elapsedMs,
    inputFrame: timing.inputFrame,
    deltaFrames: timing.deltaFrames,
    deltaMs: timing.deltaMs,
  };

  if (ev.button !== step.buttons[0]) {
    if (!state.settings.strict) return { ...state, ignoredPresses: [...state.ignoredPresses, ev] };
    return finish(state, { ...base, grade: 'WRONG_BUTTON' }, 'wrongButton');
  }

  const result: StepResult = { ...base, grade: timing.grade };
  if (index === state.combo.steps.length - 1) return finish(state, result, 'completed');
  return { ...state, results: [...state.results, result], lastInputFrame: pressFrame };
}

// --- chords (SPEC §3, "Chords") ----------------------------------------------

/**
 * A press while a chord step is awaited. `resolveChord` has already run for this press's time,
 * so a pending chord's window is still open, and a complete chord is still on its last frame.
 */
function chordPress(state: AttemptState, index: number, ev: PressEvent, t: number): AttemptState {
  const step = stepAt(state, index);
  const chord = state.chord;
  if (!chord) {
    // The chord's first press is subject to the MISSED rule, whatever its button.
    if (state.phase === 'running') {
      const { frame0, refFrame } = referenceFor(state, index);
      if (gridFrame(t, frame0, state.combo.fps) - refFrame > lastAcceptedFrame(step, state.settings.timeoutFrames)) {
        return finish(state, missedResult(state, index), 'missed');
      }
    }
    if (step.buttons.includes(ev.button)) return { ...state, chord: { presses: [{ ev, t }], complete: false } };
    return chordMistake(state, index, [], { ev, t });
  }
  const pressed = chord.presses.map((p) => p.ev.button);
  if (!chord.complete && step.buttons.includes(ev.button) && !pressed.includes(ev.button)) {
    const presses = [...chord.presses, { ev, t }];
    return { ...state, chord: { presses, complete: presses.length === step.buttons.length } };
  }
  // A button not in the chord, one pressed twice, or any press on the frame it completed on.
  return chordMistake(state, index, chord.presses, { ev, t });
}

/** Strict: WRONG_BUTTON. Non-strict: every press of the broken chord is ignored and it resets. */
function chordMistake(
  state: AttemptState,
  index: number,
  pending: readonly PendingPress[],
  wrong: PendingPress,
): AttemptState {
  if (!state.settings.strict) {
    return { ...state, chord: null, ignoredPresses: [...state.ignoredPresses, ...pending.map((p) => p.ev), wrong.ev] };
  }
  return finish(state, chordResult(state, index, 'WRONG_BUTTON', [...pending, wrong]), 'wrongButton');
}

/** Grid frame 0 for a chord: frame 0 if known, else the chord's first press (first-input start). */
function chordAnchor(state: AttemptState, chord: PendingChord): number {
  const first = chord.presses[0];
  if (!first) throw new Error('Empty chord');
  return state.frame0 ?? first.t;
}

/**
 * Closes the pending chord if it is due by corrected time `t`: a complete chord once `t` is past
 * the frame it completed on (graded), an incomplete one once its window has run out (PARTIAL).
 */
function resolveChord(state: AttemptState, t: number): AttemptState {
  const chord = state.chord;
  if (!chord) return state;
  const index = state.results.length;
  const step = stepAt(state, index);
  const fps = state.combo.fps;
  const anchor = chordAnchor(state, chord);
  const first = chord.presses[0];
  const last = chord.presses.at(-1);
  if (!first || !last) throw new Error('Empty chord');
  const frameAt = gridFrame(t, anchor, fps);
  if (chord.complete) {
    return frameAt > gridFrame(last.t, anchor, fps) ? gradeChord(state, index, chord) : state;
  }
  const opened = { t: first.t, frame: gridFrame(first.t, anchor, fps) };
  if (insideChordWindow(chordWindowOf(step), opened, { t, frame: frameAt })) return state;
  // The window ran out with some buttons missing.
  if (!state.settings.strict) {
    return { ...state, chord: null, ignoredPresses: [...state.ignoredPresses, ...chord.presses.map((p) => p.ev)] };
  }
  return finish(state, chordResult(state, index, 'PARTIAL', chord.presses), 'partial');
}

/** Grades a complete chord on its last press (SPEC §3 Chords, rules 4–5 and 7). */
function gradeChord(state: AttemptState, index: number, chord: PendingChord): AttemptState {
  const fps = state.combo.fps;
  const last = chord.presses.at(-1);
  if (!last) throw new Error('Empty chord');
  const cleared: AttemptState = { ...state, chord: null };

  if (isStartStep(state, index)) {
    // The chord's first press is frame 0; the next relative step counts from its last press.
    const frame0 = chordAnchor(state, chord);
    const result: StepResult = {
      ...chordResult(state, index, 'ON_TIME', chord.presses),
      elapsedMs: 0,
      inputFrame: 0,
      deltaFrames: 0,
      deltaMs: 0,
    };
    const next: AttemptState = {
      ...cleared,
      phase: 'running',
      frame0,
      lastInputFrame: gridFrame(last.t, frame0, fps),
      results: [result],
    };
    return state.combo.steps.length === 1 ? { ...next, phase: 'done', endedBy: 'completed' } : next;
  }

  const result = chordResult(state, index, null, chord.presses);
  if (index === state.combo.steps.length - 1) return finish(cleared, result, 'completed');
  const { frame0 } = referenceFor(state, index);
  return { ...cleared, results: [...state.results, result], lastInputFrame: gridFrame(last.t, frame0, fps) };
}

/**
 * A chord step's result. Each press gets its own timing; the step-level timing fields are the
 * last press's. `grade` null means grade the complete chord by its presses' timing.
 */
function chordResult(
  state: AttemptState,
  index: number,
  grade: Grade | null,
  presses: readonly PendingPress[],
): StepResult {
  const step = stepAt(state, index);
  const fps = state.combo.fps;
  const timed = !isStartStep(state, index) && state.frame0 !== null;
  const ref = timed ? referenceFor(state, index) : null;
  const timings = presses.map((p) => {
    if (!ref) return null;
    const inputFrame = gridFrame(p.t, ref.frame0, fps) - ref.refFrame;
    const elapsedMs = p.t - (ref.frame0 + frameToMs(ref.refFrame, fps));
    return { ...gradeFrames(step, inputFrame, elapsedMs, fps), elapsedMs };
  });
  const chordPresses: ChordPress[] = presses.map((p, i) => {
    const tm = timings[i];
    const out: ChordPress = { press: p.ev, correctedTimestamp: p.t };
    if (tm) Object.assign(out, { inputFrame: tm.inputFrame, deltaFrames: tm.deltaFrames, deltaMs: tm.deltaMs, timing: tm.grade });
    return out;
  });
  const last = presses.at(-1);
  if (!last) throw new Error('A chord result needs at least one press');
  const lastTiming = timings.at(-1);
  let finalGrade: Grade;
  if (grade !== null) finalGrade = grade;
  else finalGrade = chordGrade(timings.map((tm) => tm?.grade ?? 'ON_TIME'));
  const result: StepResult = {
    stepIndex: index,
    expected: [...step.buttons],
    grade: finalGrade,
    press: last.ev,
    correctedTimestamp: last.t,
    presses: chordPresses,
  };
  if (lastTiming) {
    result.elapsedMs = lastTiming.elapsedMs;
    result.inputFrame = lastTiming.inputFrame;
    result.deltaFrames = lastTiming.deltaFrames;
    result.deltaMs = lastTiming.deltaMs;
  }
  return result;
}

/**
 * Advances time with no input: ends the attempt with MISSED once the awaited step's window
 * has passed, and closes a chord whose window or last frame has passed. `now` is a raw
 * performance.now() time. It is corrected with the largest latency offset, so nothing is
 * declared missed or closed while a press that would still count could arrive.
 */
export function tick(state: AttemptState, now: number): AttemptState {
  if (state.phase !== 'running' && !(state.phase === 'armed' && state.chord)) return state;
  const maxOffset = Math.max(...Object.values(state.settings.latencyOffsetMs));
  const t = now - maxOffset;
  // A chord being collected closes once it's due; the MISSED timer is paused while it's open.
  const st = resolveChord(state, t);
  if (st.phase !== 'running' || st.chord) return st;
  const index = st.results.length;
  const step = stepAt(st, index);
  const { frame0, refFrame } = referenceFor(st, index);
  const frames = gridFrame(t, frame0, st.combo.fps) - refFrame;
  if (frames > lastAcceptedFrame(step, st.settings.timeoutFrames)) {
    return finish(st, missedResult(st, index), 'missed');
  }
  return st;
}

/** Final result of a finished attempt, or null while it is still in progress. */
export function attemptResult(state: AttemptState): AttemptResult | null {
  if (state.phase !== 'done' || state.endedBy === null) return null;
  return {
    combo: state.combo,
    results: [...state.results],
    ignoredPresses: [...state.ignoredPresses],
    endedBy: state.endedBy,
    success:
      state.endedBy === 'completed' &&
      state.results.length === state.combo.steps.length &&
      state.results.every((r) => r.grade === 'ON_TIME'),
  };
}
