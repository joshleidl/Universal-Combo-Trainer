// Frame/ms conversion and per-step grading (SPEC §3). Pure functions only.

import type { Grade, InputSource, PressEvent, Settings, Step } from './types';

// Absorbs float error at exact frame boundaries (e.g. 50 ms at 60 fps must be frame 3).
// Far below timestamp precision, so it never changes a real result.
const FRAME_EPSILON = 1e-9;

export const DEFAULT_FPS = 60;
export const DEFAULT_TIMEOUT_FRAMES = 30;

export const DEFAULT_SETTINGS: Settings = {
  strict: true,
  timeoutFrames: DEFAULT_TIMEOUT_FRAMES,
  latencyOffsetMs: { keyboard: 0, gamepad: 0 },
};

export function frameMs(fps: number): number {
  return 1000 / fps;
}

/** floor(elapsedMs / frameMs), computed as elapsedMs * fps / 1000 to avoid float drift. */
export function msToFrame(elapsedMs: number, fps: number): number {
  return Math.floor((elapsedMs * fps) / 1000 + FRAME_EPSILON);
}

/** Start time of a frame, in ms from the reference. */
export function frameToMs(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

export function latencyOffsetFor(source: InputSource, settings: Settings): number {
  return settings.latencyOffsetMs[source];
}

/** Press timestamp with the latency offset for its source subtracted. */
export function correctedTimestamp(press: PressEvent, settings: Settings): number {
  return press.timestamp - latencyOffsetFor(press.source, settings);
}

/** Last frame (inclusive) on which a press still counts for this step; later is MISSED. */
export function lastAcceptedFrame(step: Step, timeoutFrames: number): number {
  return step.targetFrame + step.tolLate + timeoutFrames;
}

export interface TimingGrade {
  grade: Extract<Grade, 'ON_TIME' | 'EARLY' | 'LATE'>;
  inputFrame: number;
  deltaFrames: number;
  deltaMs: number;
}

/** Grades a correct-button press by its elapsed time since the reference (SPEC §3 steps 2–5). */
export function gradeTiming(step: Step, elapsedMs: number, fps: number): TimingGrade {
  const inputFrame = msToFrame(elapsedMs, fps);
  const deltaFrames = inputFrame - step.targetFrame;
  const deltaMs = elapsedMs - frameToMs(step.targetFrame, fps);

  let grade: TimingGrade['grade'];
  if (deltaFrames < -step.tolEarly) grade = 'EARLY';
  else if (deltaFrames > step.tolLate) grade = 'LATE';
  else grade = 'ON_TIME';

  return { grade, inputFrame, deltaFrames, deltaMs };
}
