// Attempt state machine: idle → armed → running → done (SPEC §3–4).
// Every function is pure: it takes a state and returns a new one. Calls that make
// no sense for the current phase return the state unchanged.

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
  Combo,
  PressEvent,
  Settings,
  Step,
  StepResult,
} from './types';

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
}

const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

/** Returns a list of problems; empty means the combo is valid. */
export function validateCombo(combo: Combo): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(combo.fps) || combo.fps <= 0) errors.push('fps must be a positive number');
  if (combo.steps.length === 0) errors.push('combo must have at least one step');
  combo.steps.forEach((s, i) => {
    if (!s.button) errors.push(`step ${i + 1}: button is required`);
    if (!isNonNegInt(s.targetFrame)) errors.push(`step ${i + 1}: targetFrame must be an integer ≥ 0`);
    if (!isNonNegInt(s.tolEarly)) errors.push(`step ${i + 1}: tolEarly must be an integer ≥ 0`);
    if (!isNonNegInt(s.tolLate)) errors.push(`step ${i + 1}: tolLate must be an integer ≥ 0`);
  });
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
  return { ...state, phase: 'done', results: [...state.results, result], endedBy };
}

function missedResult(state: AttemptState, index: number): StepResult {
  return { stepIndex: index, expected: stepAt(state, index).button, grade: 'MISSED' };
}

/** Feeds one press edge into the attempt. */
export function press(state: AttemptState, ev: PressEvent): AttemptState {
  if (state.phase === 'armed') return pressWhileArmed(state, ev);
  if (state.phase === 'running') return pressWhileRunning(state, ev);
  return state;
}

function pressWhileArmed(state: AttemptState, ev: PressEvent): AttemptState {
  // In countdown mode, presses before start() are ignored.
  if (state.combo.startMode !== 'firstInput') return state;

  const step = stepAt(state, 0);
  const t = correctedTimestamp(ev, state.settings);

  if (ev.button !== step.button) {
    if (!state.settings.strict) return { ...state, ignoredPresses: [...state.ignoredPresses, ev] };
    return finish(
      state,
      { stepIndex: 0, expected: step.button, grade: 'WRONG_BUTTON', press: ev, correctedTimestamp: t },
      'wrongButton',
    );
  }

  // The first press defines frame 0 and is always on time (SPEC §3, startMode firstInput).
  const result: StepResult = {
    stepIndex: 0,
    expected: step.button,
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

function pressWhileRunning(state: AttemptState, ev: PressEvent): AttemptState {
  const index = state.results.length;
  const step = stepAt(state, index);
  const fps = state.combo.fps;
  const t = correctedTimestamp(ev, state.settings);
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
    expected: step.button,
    press: ev,
    correctedTimestamp: t,
    elapsedMs,
    inputFrame: timing.inputFrame,
    deltaFrames: timing.deltaFrames,
    deltaMs: timing.deltaMs,
  };

  if (ev.button !== step.button) {
    if (!state.settings.strict) return { ...state, ignoredPresses: [...state.ignoredPresses, ev] };
    return finish(state, { ...base, grade: 'WRONG_BUTTON' }, 'wrongButton');
  }

  const result: StepResult = { ...base, grade: timing.grade };
  if (index === state.combo.steps.length - 1) return finish(state, result, 'completed');
  return { ...state, results: [...state.results, result], lastInputFrame: pressFrame };
}

/**
 * Advances time with no input, ending the attempt with MISSED once the awaited step's
 * window has passed. `now` is a raw performance.now() time. It is corrected with the
 * largest latency offset, so a step is never declared missed while a press that would
 * still count could arrive.
 */
export function tick(state: AttemptState, now: number): AttemptState {
  if (state.phase !== 'running') return state;
  const index = state.results.length;
  const step = stepAt(state, index);
  const maxOffset = Math.max(...Object.values(state.settings.latencyOffsetMs));
  const { frame0, refFrame } = referenceFor(state, index);
  const frames = gridFrame(now - maxOffset, frame0, state.combo.fps) - refFrame;
  if (frames > lastAcceptedFrame(step, state.settings.timeoutFrames)) {
    return finish(state, missedResult(state, index), 'missed');
  }
  return state;
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
