// Timeline geometry for an attempt (SPEC §7): where each step's on-time window and actual
// input fall, in frames since frame 0. Pure; the UI only scales these numbers to pixels.

import type { AttemptState } from '../engine/attempt';
import { correctedTimestamp, frameMs, lastAcceptedFrame } from '../engine/timing';
import type { ButtonId, Grade } from '../engine/types';

export interface TimelineStep {
  stepIndex: number;
  expected: ButtonId;
  label?: string;
  grade: Grade;
  /** First-input start step: it defines frame 0, so it has no window. */
  isStart: boolean;
  /** On-time window, from the start of its first frame to the end of its last. */
  windowStart: number;
  windowEnd: number;
  /** Start of the target frame. */
  target: number;
  /** When the press landed (latency-corrected), or null for MISSED. */
  input: number | null;
  /** The button actually pressed, when it differs from `expected`. */
  pressed?: ButtonId;
  /** For MISSED: the end of the last frame a press would still have counted. */
  deadline?: number;
}

export interface TimelineMark {
  frame: number;
  button: ButtonId;
}

export interface Timeline {
  fps: number;
  steps: TimelineStep[];
  /** Wrong presses ignored in non-strict mode, after frame 0. */
  ignored: TimelineMark[];
  /** Whole frame where the ruler should end (includes a little padding). */
  endFrame: number;
}

/** Builds the timeline for an attempt, or null if it never reached frame 0. */
export function buildTimeline(state: AttemptState): Timeline | null {
  const { combo, settings, frame0, results } = state;
  if (frame0 === null) return null;
  const fms = frameMs(combo.fps);
  const toFrame = (t: number) => (t - frame0) / fms;

  const steps: TimelineStep[] = results.map((r, i) => {
    const step = combo.steps[r.stepIndex];
    if (!step) throw new Error(`No step at index ${r.stepIndex}`);
    const prev = results[i - 1];
    const refTime =
      combo.timingMode === 'relative' && i > 0 && prev?.correctedTimestamp !== undefined
        ? prev.correctedTimestamp
        : frame0;
    const ref = toFrame(refTime);
    const isStart = combo.startMode === 'firstInput' && r.stepIndex === 0;
    const out: TimelineStep = {
      stepIndex: r.stepIndex,
      expected: r.expected,
      grade: r.grade,
      isStart,
      windowStart: isStart ? 0 : ref + step.targetFrame - step.tolEarly,
      windowEnd: isStart ? 0 : ref + step.targetFrame + step.tolLate + 1,
      target: isStart ? 0 : ref + step.targetFrame,
      input: r.correctedTimestamp !== undefined ? toFrame(r.correctedTimestamp) : null,
    };
    if (step.label) out.label = step.label;
    if (r.press && r.press.button !== r.expected) out.pressed = r.press.button;
    if (r.grade === 'MISSED') out.deadline = ref + lastAcceptedFrame(step, settings.timeoutFrames) + 1;
    return out;
  });

  const ignored = state.ignoredPresses
    .map((p) => ({ frame: toFrame(correctedTimestamp(p, settings)), button: p.button }))
    .filter((m) => m.frame >= 0);

  const furthest = Math.max(
    1,
    ...steps.flatMap((s) => [s.windowEnd, s.input ?? 0, s.deadline ?? 0]),
    ...ignored.map((m) => m.frame),
  );
  return { fps: combo.fps, steps, ignored, endFrame: Math.ceil(furthest) + 2 };
}

/** A tick spacing that gives roughly 10 or fewer labelled ticks. */
export function rulerStep(endFrame: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (endFrame / step <= 10) return step;
  }
  return Math.ceil(endFrame / 10 / 600) * 600;
}
