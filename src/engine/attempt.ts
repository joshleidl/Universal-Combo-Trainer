// Attempt state machine: idle → armed → running → done (SPEC §3–4).
// Every function is pure: it takes a state and returns a new one. Calls that make
// no sense for the current phase return the state unchanged.
//
// Every press and release goes to the frame layer first (engine/frames.ts). Grading reads one
// closed frame at a time (SPEC §3 "Frames", "Grading"), so a step's result comes when its
// frame closes: on a later input or on tick().

import { chordGrade, chordWindowLastFrame, chordWindowOf, insideChordWindow, isChord, type PressPoint } from './chord';
import { directionMistake, hasDirectionCheck, isDirection, positionMatches, resolvePosition } from './direction';
import {
  addInput,
  clearOrigin,
  closeBefore,
  createFrames,
  frameOf,
  lastClosedFrame,
  setOrigin,
  type FrameBuffer,
  type FramePress,
  type FrameRecord,
} from './frames';
import { DEFAULT_SETTINGS, correctedTimestamp, frameToMs, gradeFrames, lastAcceptedFrame, msToFrame } from './timing';
import type {
  AttemptEnd,
  AttemptPhase,
  AttemptResult,
  ButtonId,
  ChordPress,
  Combo,
  Grade,
  HeldPosition,
  PositionChange,
  PressEvent,
  ReleaseEvent,
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
  /**
   * Frame 0 timestamp (latency-corrected for firstInput; the countdown time for countdown). In
   * first-input mode it's set once step 1 is graded; until then the frame layer keeps the grid.
   */
  readonly frame0: number | null;
  /** Grid frame (frames since frame 0) the most recent graded step was graded on. */
  readonly lastInputFrame: number | null;
  readonly endedBy: AttemptEnd | null;
  /** The awaited chord step's presses so far, or null when no chord is being collected. */
  readonly chord: PendingChord | null;
  /** Controls held right now (buttons and directions, in press order), in every phase. */
  readonly held: readonly ButtonId[];
  /** The frame layer: the grid, the open frame and the held set (SPEC §4 "Engine API: frames"). */
  readonly frames: FrameBuffer;
  /**
   * The position held at arm (time -Infinity), then each change of the resolved position with
   * its corrected time. `attemptResult` turns it into `positions`. While there is no grid yet
   * only the current position is kept.
   */
  readonly positionLog: readonly PositionLogEntry[];
}

/** One change of the resolved stick position. */
export interface PositionLogEntry {
  /** Corrected time of the input that made the change; -Infinity for the position at arm. */
  readonly t: number;
  readonly position: HeldPosition;
}

/** A press of a chord being collected: its last down event, corrected time and grid frame. */
export interface PendingPress {
  readonly ev: PressEvent;
  readonly t: number;
  readonly frame: number;
}

/** A chord being collected for the awaited step, over closed frames (SPEC §3, "Chords"). */
export interface PendingChord {
  /** Presses so far, in order. */
  readonly presses: readonly PendingPress[];
}

const isNonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

/** Returns a list of problems; empty means the combo is valid. */
export function validateCombo(combo: Combo): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(combo.fps) || combo.fps <= 0) errors.push('fps must be a positive number');
  if (combo.steps.length === 0) errors.push('combo must have at least one step');
  combo.steps.forEach((s, i) => {
    errors.push(...buttonErrors(s, i + 1));
    errors.push(...directionErrors(s, i + 1));
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
  // Directions are never a step's button (single-direction steps were removed; DECISIONS.md).
  const dirs = s.buttons.filter((b) => DIRECTION_BUTTONS.includes(b));
  if (dirs.length > 0) errors.push(`step ${n}: directions can't be a step's button (${dirs.join(', ')})`);
  if (s.buttons.length > 1) {
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

const POSITIONS: readonly number[] = [1, 2, 3, 4, 6, 7, 8, 9];

function directionErrors(s: Step, n: number): string[] {
  const errors: string[] = [];
  if (s.direction !== undefined && !POSITIONS.includes(s.direction)) {
    errors.push(`step ${n}: direction must be a numpad position 1–9 other than 5`);
  }
  if (s.directionMatch !== undefined && s.directionMatch !== 'exact' && s.directionMatch !== 'atLeast') {
    errors.push(`step ${n}: directionMatch must be exact or atLeast`);
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
    held: [],
    frames: createFrames(combo.fps),
    positionLog: [{ t: -Infinity, position: 5 }],
  };
}

/**
 * Readies an attempt for input. From `done`, this starts a fresh attempt (quick restart).
 * `held` is the controls held right now; left out, the held set the state already has is kept.
 */
export function arm(state: AttemptState, held?: readonly ButtonId[]): AttemptState {
  if (state.phase === 'idle') return armedWith({ ...state, phase: 'armed' }, held ?? state.held);
  if (state.phase === 'done') {
    return armedWith({ ...createAttempt(state.combo, state.settings), phase: 'armed' }, held ?? state.held);
  }
  return state;
}

function armedWith(state: AttemptState, held: readonly ButtonId[]): AttemptState {
  const frames = createFrames(state.combo.fps, held);
  return { ...state, frames, held: frames.held, positionLog: [{ t: -Infinity, position: resolvePosition(frames.held) }] };
}

/** The position the held directions resolve to (SOCD neutral), for the live input display. */
export function heldPosition(state: AttemptState): HeldPosition {
  return resolvePosition(state.held);
}

/**
 * Countdown mode only: sets frame 0 and starts running. `frame0Timestamp` may be in the future
 * (the UI can schedule the end of its countdown); frames before it are negative, and presses on
 * them grade EARLY.
 */
export function start(state: AttemptState, frame0Timestamp: number): AttemptState {
  if (state.phase !== 'armed' || state.combo.startMode !== 'countdown') return state;
  return { ...state, phase: 'running', frame0: frame0Timestamp, frames: setOrigin(state.frames, frame0Timestamp) };
}

/** Index of the step currently awaited, or null if none. */
export function currentStepIndex(state: AttemptState): number | null {
  if (state.phase === 'running') return state.results.length;
  if (state.phase === 'armed' && state.combo.startMode === 'firstInput') return 0;
  return null;
}

/** Buttons of the awaited chord pressed so far (closed frames only), or null when none is collected. */
export function chordProgress(state: AttemptState): ButtonId[] | null {
  return state.chord ? state.chord.presses.map((p) => p.ev.button) : null;
}

/** Feeds one press edge (button or direction) into the attempt. */
export function press(state: AttemptState, ev: PressEvent): AttemptState {
  return input(state, ev, true);
}

/** Feeds one release edge (button or direction) into the attempt. */
export function release(state: AttemptState, ev: ReleaseEvent): AttemptState {
  return input(state, ev, false);
}

/**
 * Advances time with no input. `now` is a raw performance.now() time; it is corrected with the
 * largest latency offset, so nothing closes while an input that would still count could arrive.
 * Every frame before the one `now` falls on closes: the open frame is graded, and a step whose
 * last accepted frame has closed is MISSED.
 */
export function tick(state: AttemptState, now: number): AttemptState {
  if (state.frames.origin === null) return state;
  const maxOffset = Math.max(...Object.values(state.settings.latencyOffsetMs));
  return advanceTo(state, frameOf(state.frames, now - maxOffset));
}

// --- inputs and frames (SPEC §3, "Frames") -----------------------------------

/**
 * One press or release, in any phase. Frames before the one it lands on close first (and are
 * graded); then the input joins the open frame. Without a grid it only changes the held set.
 */
function input(state: AttemptState, ev: PressEvent | ReleaseEvent, down: boolean): AttemptState {
  const t = correctedTimestamp(ev, state.settings);
  let st = state;
  if (st.frames.origin !== null) {
    const last = lastClosedFrame(st.frames);
    st = advanceTo(st, Math.max(frameOf(st.frames, t), last === null ? -Infinity : last + 1));
  }
  // First-input mode: frame 0 starts at the first button press edge (SPEC §3, "First-input start").
  if (
    st.phase === 'armed' &&
    st.combo.startMode === 'firstInput' &&
    st.frames.origin === null &&
    down &&
    !isDirection(ev.button) &&
    !st.held.includes(ev.button)
  ) {
    st = { ...st, frames: setOrigin(st.frames, t) };
  }
  const frames = addInput(st.frames, ev, t, down).buf;
  // Nothing changed (e.g. a held direction pressed again with no grid yet).
  if (st === state && frames.origin === null && frames.held === st.held) return state;
  return { ...st, frames, held: frames.held, positionLog: logPosition(st, resolvePosition(frames.held), t) };
}

/**
 * Moves time to the start of grid frame `frame`: every earlier frame closes. The open frame's
 * record is graded, then the step's deadline is checked against the last closed frame.
 */
function advanceTo(state: AttemptState, frame: number): AttemptState {
  if (state.phase === 'done' || state.frames.origin === null) return state;
  const { buf, closed } = closeBefore(state.frames, frame);
  let st: AttemptState = { ...state, frames: buf };
  if (closed) st = gradeFrame(st, closed);
  return checkDeadline(st);
}

/** The position log after the position becomes `position` at corrected time `t`. */
function logPosition(state: AttemptState, position: HeldPosition, t: number): readonly PositionLogEntry[] {
  const log = state.positionLog;
  // After the attempt ends the history is final.
  if (state.phase === 'done' || log.at(-1)?.position === position) return log;
  // Until there is a grid, every change is before frame 0, so only the latest one matters.
  return state.frames.origin !== null ? [...log, { t, position }] : [{ t: -Infinity, position }];
}

// --- grading (SPEC §3, "Grading") --------------------------------------------

/**
 * Where the given step is counted from, on the fixed frame grid that starts at frame 0
 * (DECISIONS.md, "Fixed frame grid"). Relative steps count from the frame the previous step
 * was graded on; absolute steps and the first step count from frame 0.
 */
function referenceFor(state: AttemptState, stepIndex: number): { frame0: number; refFrame: number } {
  if (state.frame0 === null) throw new Error('No frame 0: attempt is not running');
  const relative = state.combo.timingMode === 'relative' && stepIndex > 0;
  if (relative && state.lastInputFrame === null) throw new Error('No previous input frame');
  return { frame0: state.frame0, refFrame: relative ? (state.lastInputFrame as number) : 0 };
}

function stepAt(state: AttemptState, index: number): Step {
  const step = state.combo.steps[index];
  if (!step) throw new Error(`No step at index ${index}`);
  return step;
}

const isStartStep = (state: AttemptState, index: number) =>
  index === 0 && state.combo.startMode === 'firstInput';

function finish(state: AttemptState, result: StepResult, endedBy: AttemptEnd): AttemptState {
  return {
    ...state,
    phase: 'done',
    results: [...state.results, result],
    endedBy,
    chord: null,
    frames: clearOrigin(state.frames),
  };
}

/** A graded first-input start step: sets frame 0 and starts running (or finishes a 1-step combo). */
function startRunning(state: AttemptState, result: StepResult, frame0: number, lastInputFrame: number): AttemptState {
  const next: AttemptState = { ...state, phase: 'running', frame0, lastInputFrame, results: [result] };
  return state.combo.steps.length === 1 ? finish({ ...next, results: [] }, result, 'completed') : next;
}

/** A graded step after the start: moves to the next step, or completes the attempt. */
function advance(state: AttemptState, result: StepResult, frame: number): AttemptState {
  if (result.stepIndex === state.combo.steps.length - 1) return finish(state, result, 'completed');
  return { ...state, results: [...state.results, result], lastInputFrame: frame };
}

function missedResult(state: AttemptState, index: number): StepResult {
  return { stepIndex: index, expected: [...stepAt(state, index).buttons], grade: 'MISSED' };
}

/**
 * The time-based checks once frames have closed: a collecting chord whose window's last frame
 * has closed is PARTIAL ("Chords", rule 6); otherwise the step is MISSED once its last accepted
 * frame has closed ("Grading", rule 1). A collecting chord pauses the MISSED timer.
 */
function checkDeadline(state: AttemptState): AttemptState {
  const last = lastClosedFrame(state.frames);
  if (last === null || state.phase === 'done') return state;
  if (state.chord) {
    const index = currentStepIndex(state) as number;
    const end = chordWindowLastFrame(chordWindowOf(stepAt(state, index)), chordFirst(state.chord), (t) => frameOf(state.frames, t));
    if (last < end) return state;
    // Non-strict resets the chord, so the MISSED timer runs again.
    return checkDeadline(chordMistake(state, index, 'PARTIAL', state.chord.presses));
  }
  if (state.phase !== 'running') return state;
  const index = state.results.length;
  const { refFrame } = referenceFor(state, index);
  if (last - refFrame < lastAcceptedFrame(stepAt(state, index), state.settings.timeoutFrames)) return state;
  return finish(state, missedResult(state, index), 'missed');
}

/** Grades one closed frame against the awaited step. */
function gradeFrame(state: AttemptState, rec: FrameRecord): AttemptState {
  const index = currentStepIndex(state);
  if (index === null) return state;
  const step = stepAt(state, index);
  const buttons = rec.presses.filter((p) => !isDirection(p.button));
  if (buttons.length === 0) return state;
  if (isChord(step)) return chordFrame(state, index, rec, buttons);

  const want = step.buttons[0];
  const hit = buttons.find((p) => p.button === want);
  const stray = buttons.find((p) => p.button !== want);

  // A stray button on the frame, with or without the step's button (extra press, rule 1).
  if (stray) {
    if (!state.settings.strict) {
      const ignored: AttemptState = { ...state, ignoredPresses: [...state.ignoredPresses, ...buttons.map((p) => p.ev)] };
      // A first-input step 1 goes back to waiting, and frame 0 is cleared.
      return isStartStep(state, index) ? backToWaiting(ignored) : ignored;
    }
    const result: StepResult = isStartStep(state, index)
      ? { stepIndex: index, expected: [...step.buttons], grade: 'WRONG_BUTTON', press: stray.ev, correctedTimestamp: stray.t }
      : { ...framedResult(state, index, rec.frame, stray), grade: 'WRONG_BUTTON' };
    return finish(state, result, 'wrongButton');
  }
  if (!hit) return state;

  if (isStartStep(state, index)) {
    // Frame 0 is always on time (SPEC §3, startMode firstInput); a direction check still runs.
    const frame0 = state.frames.origin as number;
    const result: StepResult = {
      stepIndex: 0,
      expected: [...step.buttons],
      grade: 'ON_TIME',
      press: hit.ev,
      correctedTimestamp: hit.t,
      elapsedMs: 0,
      inputFrame: 0,
      deltaFrames: 0,
      deltaMs: 0,
    };
    return startRunning(state, withDirectionCheck(step, result, rec.held), frame0, rec.frame);
  }

  const result = framedResult(state, index, rec.frame, hit);
  if ((result.inputFrame as number) > lastAcceptedFrame(step, state.settings.timeoutFrames)) {
    return finish(state, missedResult(state, index), 'missed');
  }
  return advance(state, withDirectionCheck(step, result, rec.held), rec.frame);
}

/** Non-strict first-input step 1 failed: back to waiting for a new frame 0, held state kept. */
function backToWaiting(state: AttemptState): AttemptState {
  return {
    ...state,
    chord: null,
    frames: clearOrigin(state.frames),
    positionLog: [{ t: -Infinity, position: resolvePosition(state.held) }],
  };
}

/** A press on grid frame `frame`, graded against the given step's window. */
function framedResult(state: AttemptState, index: number, frame: number, p: FramePress): StepResult {
  const step = stepAt(state, index);
  const fps = state.combo.fps;
  const { frame0, refFrame } = referenceFor(state, index);
  // Whole-frame math on the grid, so float error can't move a press across a frame edge.
  const elapsedMs = p.t - (frame0 + frameToMs(refFrame, fps));
  const timing = gradeFrames(step, frame - refFrame, elapsedMs, fps);
  return {
    stepIndex: index,
    expected: [...step.buttons],
    grade: timing.grade,
    press: p.ev,
    correctedTimestamp: p.t,
    elapsedMs,
    inputFrame: timing.inputFrame,
    deltaFrames: timing.deltaFrames,
    deltaMs: timing.deltaMs,
  };
}

// --- chords (SPEC §3, "Chords") ----------------------------------------------

/** Where the chord's window opens: its first frame, and the earliest press ms on it. */
function chordFirst(chord: PendingChord): PressPoint {
  const first = chord.presses[0];
  if (!first) throw new Error('Empty chord');
  const onFirst = chord.presses.filter((p) => p.frame === first.frame).map((p) => p.t);
  return { t: Math.min(...onFirst), frame: first.frame };
}

/**
 * A closed frame with button presses while a chord step is awaited. A button outside the chord,
 * or one already pressed on an earlier frame, breaks it (WRONG_BUTTON); that includes any other
 * press on the frame it completes on. Presses that don't fit the window (an ms window's last
 * frame) mean it ran out: PARTIAL.
 */
function chordFrame(state: AttemptState, index: number, rec: FrameRecord, buttons: readonly FramePress[]): AttemptState {
  const step = stepAt(state, index);
  const earlier = state.chord?.presses ?? [];
  const already = earlier.map((p) => p.ev.button);
  const pending = (p: FramePress): PendingPress => ({ ev: p.ev, t: p.t, frame: rec.frame });
  const valid = buttons.filter((p) => step.buttons.includes(p.button) && !already.includes(p.button));
  const strays = buttons.filter((p) => !valid.includes(p));
  if (strays.length > 0) {
    // The wrong presses go last, so the result's press is one of them.
    return chordMistake(state, index, 'WRONG_BUTTON', [...earlier, ...valid.map(pending), ...strays.map(pending)]);
  }
  const first = state.chord ? chordFirst(state.chord) : null;
  const fits = (p: FramePress) => first === null || insideChordWindow(chordWindowOf(step), first, { t: p.t, frame: rec.frame });
  // Presses on one frame in time order, so the graded (last) press is the latest.
  const inWindow = valid.filter(fits).sort((a, b) => a.t - b.t).map(pending);
  const outside = valid.filter((p) => !fits(p)).map(pending);
  const presses = [...earlier, ...inWindow];
  if (presses.length === step.buttons.length) return gradeChord(state, index, presses, rec);
  if (outside.length > 0) return chordMistake(state, index, 'PARTIAL', presses, outside);
  return { ...state, chord: { presses } };
}

/**
 * A broken chord. Strict: WRONG_BUTTON or PARTIAL ends the attempt. Non-strict: every press of
 * the chord (and `alsoIgnored`) is logged as ignored and the chord resets; a first-input step 1
 * goes back to waiting.
 */
function chordMistake(
  state: AttemptState,
  index: number,
  grade: 'WRONG_BUTTON' | 'PARTIAL',
  presses: readonly PendingPress[],
  alsoIgnored: readonly PendingPress[] = [],
): AttemptState {
  if (state.settings.strict) {
    return finish(state, chordResult(state, index, grade, presses), grade === 'PARTIAL' ? 'partial' : 'wrongButton');
  }
  const ignored: AttemptState = {
    ...state,
    chord: null,
    ignoredPresses: [...state.ignoredPresses, ...[...presses, ...alsoIgnored].map((p) => p.ev)],
  };
  return isStartStep(state, index) ? backToWaiting(ignored) : ignored;
}

/** A complete chord, graded on the frame it completed on (rules 3–5, 7; Directions rule 8). */
function gradeChord(state: AttemptState, index: number, presses: readonly PendingPress[], rec: FrameRecord): AttemptState {
  const step = stepAt(state, index);
  const cleared: AttemptState = { ...state, chord: null };
  if (isStartStep(state, index)) {
    const result: StepResult = {
      ...chordResult(state, index, 'ON_TIME', presses),
      elapsedMs: 0,
      inputFrame: 0,
      deltaFrames: 0,
      deltaMs: 0,
    };
    return startRunning(cleared, withDirectionCheck(step, result, rec.held), state.frames.origin as number, rec.frame);
  }
  return advance(cleared, withDirectionCheck(step, chordResult(state, index, null, presses), rec.held), rec.frame);
}

/**
 * A chord step's result. Each press gets its own timing by its frame; the step-level timing
 * fields are the last press's. `grade` null means grade the complete chord by its presses'
 * timing (SPLIT rule).
 */
function chordResult(state: AttemptState, index: number, grade: Grade | null, presses: readonly PendingPress[]): StepResult {
  const step = stepAt(state, index);
  const fps = state.combo.fps;
  const ref = !isStartStep(state, index) && state.frame0 !== null ? referenceFor(state, index) : null;
  const timings = presses.map((p) => {
    if (!ref) return null;
    const elapsedMs = p.t - (ref.frame0 + frameToMs(ref.refFrame, fps));
    return { ...gradeFrames(step, p.frame - ref.refFrame, elapsedMs, fps), elapsedMs };
  });
  const chordPresses: ChordPress[] = presses.map((p, i) => {
    const tm = timings[i];
    const out: ChordPress = { press: p.ev, correctedTimestamp: p.t };
    if (tm) Object.assign(out, { inputFrame: tm.inputFrame, deltaFrames: tm.deltaFrames, deltaMs: tm.deltaMs, timing: tm.grade });
    return out;
  });
  const last = presses.at(-1);
  if (!last) throw new Error('A chord result needs at least one press');
  const result: StepResult = {
    stepIndex: index,
    expected: [...step.buttons],
    grade: grade ?? chordGrade(timings.map((tm) => tm?.grade ?? 'ON_TIME')),
    press: last.ev,
    correctedTimestamp: last.t,
    presses: chordPresses,
  };
  const lastTiming = timings.at(-1);
  if (lastTiming) {
    result.elapsedMs = lastTiming.elapsedMs;
    result.inputFrame = lastTiming.inputFrame;
    result.deltaFrames = lastTiming.deltaFrames;
    result.deltaMs = lastTiming.deltaMs;
  }
  return result;
}

/** The result with the step's direction check applied on the graded frame's end state (rule 6). */
function withDirectionCheck(step: Step, result: StepResult, held: readonly ButtonId[]): StepResult {
  if (!hasDirectionCheck(step)) return result;
  const wanted: HeldPosition = step.direction ?? 5;
  const match = step.directionMatch ?? 'atLeast';
  const position = resolvePosition(held);
  const checked: StepResult = { ...result, direction: { wanted, held: position, match } };
  if (positionMatches(wanted, position, match)) return checked;
  const mistake = directionMistake(wanted, position);
  return { ...checked, grade: mistake === 'missing' ? 'PARTIAL' : 'WRONG_BUTTON', directionMistake: mistake };
}

// --- results -----------------------------------------------------------------

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
    positions: state.frame0 === null ? [] : positionsFrom(state.positionLog, state.frame0, state.combo.fps),
  };
}

/**
 * The position at the end of frame 0, then one entry per frame whose ending position differs
 * from the frame before (SPEC §4, `AttemptResult.positions`). Changes before frame 0 count
 * toward frame 0. The log is in arrival order; a change whose corrected time falls on an earlier
 * frame than the one before it (inputs from two sources with different latency offsets) counts
 * on that later frame.
 */
/** Frames since frame 0 for a corrected timestamp. */
function gridFrame(t: number, frame0: number, fps: number): number {
  return msToFrame(t - frame0, fps);
}

function positionsFrom(log: readonly PositionLogEntry[], frame0: number, fps: number): PositionChange[] {
  const out: PositionChange[] = [{ frame: 0, position: 5, timestamp: frame0 }];
  for (const e of log) {
    const last = out.at(-1) as PositionChange;
    const frame = Math.max(gridFrame(e.t, frame0, fps), last.frame);
    if (frame <= 0) {
      out[0] = { ...last, position: e.position };
      continue;
    }
    // A later change on the same frame replaces that frame's entry.
    if (frame === last.frame) out.pop();
    if (e.position !== (out.at(-1) as PositionChange).position) out.push({ frame, position: e.position, timestamp: e.t });
  }
  return out;
}
