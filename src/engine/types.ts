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

export interface Step {
  /** Required input. Kept as a single button for now; could become a chord list later (SPEC §9). */
  button: ButtonId;
  /** Integer frame the input should land on. */
  targetFrame: number;
  /** Frames early still counted as on time. */
  tolEarly: number;
  /** Frames late still counted as on time. */
  tolLate: number;
  label?: string;
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

export type Grade = 'ON_TIME' | 'EARLY' | 'LATE' | 'WRONG_BUTTON' | 'MISSED';

export interface StepResult {
  stepIndex: number;
  expected: ButtonId;
  grade: Grade;
  /** The press that produced this result. Absent for MISSED by timeout. */
  press?: PressEvent;
  /** press.timestamp minus the latency offset for its source. */
  correctedTimestamp?: number;
  /** Corrected timestamp minus the reference timestamp. */
  elapsedMs?: number;
  inputFrame?: number;
  deltaFrames?: number;
  /** elapsedMs minus the start of the target frame (targetFrame * frameMs). */
  deltaMs?: number;
}

export type AttemptPhase = 'idle' | 'armed' | 'running' | 'done';

export type AttemptEnd = 'completed' | 'missed' | 'wrongButton';

export interface AttemptResult {
  combo: Combo;
  results: StepResult[];
  /** Wrong presses ignored in non-strict mode. */
  ignoredPresses: PressEvent[];
  endedBy: AttemptEnd;
  /** True when every step was graded ON_TIME. */
  success: boolean;
}
