// Core engine types (SPEC §3–4). No DOM, no input, no UI imports.

/** A mapped button ID, e.g. "LP", "HK", "UP". */
export type ButtonId = string;

export type InputSource = 'keyboard' | 'gamepad';

/** A single press edge, in the performance.now() clock. */
export interface PressEvent {
  button: ButtonId;
  /** Milliseconds, same clock as performance.now() / KeyboardEvent.timeStamp. */
  timestamp: number;
  source: InputSource;
}

/** A release edge. Only direction releases matter to the engine (SPEC §3, "Directions"). */
export interface ReleaseEvent {
  button: ButtonId;
  /** Milliseconds, same clock as performance.now() / KeyboardEvent.timeStamp. */
  timestamp: number;
  source: InputSource;
}

/** Direction IDs. They are never a step's button (SPEC §3). */
export const DIRECTION_BUTTONS: readonly ButtonId[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

/**
 * A stick position in numpad layout: 1 ↙, 2 ↓, 3 ↘, 4 ←, 6 →, 7 ↖, 8 ↑, 9 ↗ (SPEC §3,
 * "Directions"). This is what a step stores; neutral (5) never is.
 */
export type Position = 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9;

/** What the stick can read: a Position, or 5 for neutral. */
export type HeldPosition = Position | 5;

/**
 * `exact`: the held position must be exactly the step's direction (neutral on a plain step).
 * `atLeast`: every direction in it must be held, others may be too (anything on a plain step).
 */
export type DirectionMatch = 'exact' | 'atLeast';

/**
 * Why a direction check failed: `missing` when the held position is a strict part of the wanted
 * one (including nothing held), `wrong` otherwise.
 */
export type DirectionMistake = 'missing' | 'wrong';

export type ChordWindowUnit = 'frames' | 'ms';

/** How far apart a chord's presses may be: grid frames (integer) or corrected ms. */
export interface ChordWindow {
  size: number;
  unit: ChordWindowUnit;
}

export interface Step {
  /** Required input(s). One button is a normal step; two or more is a chord (any order). */
  buttons: ButtonId[];
  /** Integer frame the input should land on. */
  targetFrame: number;
  /** Frames early still counted as on time. */
  tolEarly: number;
  /** Frames late still counted as on time. */
  tolLate: number;
  label?: string;
  /** Required for chords (2+ buttons); ignored on single-button steps. */
  chordWindow?: ChordWindow;
  /** Stick position held when the button (or the chord's last button) lands. */
  direction?: Position;
  /** How `direction` is matched. Absent means `atLeast`. */
  directionMatch?: DirectionMatch;
}

export type TimingMode = 'relative' | 'absolute';
export type StartMode = 'firstInput' | 'countdown';

export interface Combo {
  name: string;
  steps: Step[];
  fps: number;
  timingMode: TimingMode;
  startMode: StartMode;
}

/** Engine settings that are not part of a combo. */
export interface Settings {
  /** A wrong button ends the attempt when true; it is logged and ignored when false. */
  strict: boolean;
  /** Extra frames after the late window before a step counts as MISSED. */
  timeoutFrames: number;
  /** Subtracted from input timestamps before grading, per input source (SPEC §6). */
  latencyOffsetMs: Record<InputSource, number>;
}

export type Grade = 'ON_TIME' | 'EARLY' | 'LATE' | 'SPLIT' | 'PARTIAL' | 'WRONG_BUTTON' | 'MISSED';

/** Timing grade of a single press against a step's on-time window. */
export type PressTiming = 'EARLY' | 'ON_TIME' | 'LATE';

/** One press of a chord step, with its own timing. */
export interface ChordPress {
  press: PressEvent;
  /** press.timestamp minus the latency offset for its source. */
  correctedTimestamp: number;
  /**
   * Timing against the step's window, like the step-level fields. Absent when the step is a
   * first-input start (its timing isn't checked) or there is no frame 0 yet.
   */
  inputFrame?: number;
  deltaFrames?: number;
  deltaMs?: number;
  timing?: PressTiming;
}

export interface StepResult {
  stepIndex: number;
  expected: ButtonId[];
  grade: Grade;
  /**
   * The press that produced this result: for a chord, the last one (the one graded, or the
   * wrong press). Absent for MISSED by timeout.
   */
  press?: PressEvent;
  /** Chord steps only: every press of the chord, in order (including a wrong one). */
  presses?: ChordPress[];
  /** press.timestamp minus the latency offset for its source. */
  correctedTimestamp?: number;
  /** Corrected timestamp minus the reference timestamp. */
  elapsedMs?: number;
  inputFrame?: number;
  deltaFrames?: number;
  /** elapsedMs minus the start of the target frame (targetFrame * frameMs). */
  deltaMs?: number;
  /**
   * Set on every step that ran a direction check: the wanted position (5 for an exact plain
   * step), the position held at the end of the graded press's frame, and how they were matched.
   */
  direction?: { wanted: HeldPosition; held: HeldPosition; match: DirectionMatch };
  /** Set when the direction check failed; the grade is then PARTIAL (missing) or WRONG_BUTTON (wrong). */
  directionMistake?: DirectionMistake;
}

/** The stick position from a frame's end on (SPEC §4, "Engine API: directions"). */
export interface PositionChange {
  /** Grid frame (frames since frame 0) whose ending position this is. */
  frame: number;
  position: HeldPosition;
  /** Corrected time of the input that made the change (frame 0's timestamp for the first entry). */
  timestamp: number;
}

export type AttemptPhase = 'idle' | 'armed' | 'running' | 'done';

export type AttemptEnd = 'completed' | 'missed' | 'wrongButton' | 'partial';

export interface AttemptResult {
  combo: Combo;
  results: StepResult[];
  /** Wrong presses ignored in non-strict mode. */
  ignoredPresses: PressEvent[];
  endedBy: AttemptEnd;
  /** True when every step was graded ON_TIME. */
  success: boolean;
  /**
   * The position at the end of frame 0, then one entry for each frame whose ending position
   * differs from the frame before. Empty when the attempt ended before it had a frame 0.
   */
  positions: PositionChange[];
}
