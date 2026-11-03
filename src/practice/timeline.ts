// Timeline geometry for an attempt (SPEC §7): where each step's on-time window and actual
// input fall, in frames since frame 0. Pure; the UI only scales these numbers to pixels.

import { attemptResult, type AttemptState } from '../engine/attempt';
import { hasDirectionCheck } from '../engine/direction';
import { correctedTimestamp, frameMs, lastAcceptedFrame, msToFrame } from '../engine/timing';
import type { ButtonId, Grade, HeldPosition, Position } from '../engine/types';

export interface TimelineStep {
  stepIndex: number;
  expected: ButtonId[];
  label?: string;
  grade: Grade;
  /** First-input start step: it defines frame 0, so it has no window. */
  isStart: boolean;
  /** On-time window, from the start of its first frame to the end of its last. */
  windowStart: number;
  windowEnd: number;
  /** Start of the target frame. */
  target: number;
  /** When the graded press landed (latency-corrected; a chord's last press), or null for MISSED. */
  input: number | null;
  /** Single-button steps: the button actually pressed, when it differs from `expected`. */
  pressed?: ButtonId;
  /** Chord steps: every press of the chord, in order. `wrong` marks the press that broke it. */
  chordPresses?: TimelineMark[];
  /** Chord steps: from the chord's first press to the end of its window. */
  chordWindow?: { start: number; end: number };
  /** For MISSED: the end of the last frame a press would still have counted. */
  deadline?: number;
  /**
   * Steps that ran a direction check: the position held at the end of the graded press's frame,
   * tagged on that press's dot (a chord's last press), and whether the check failed.
   */
  direction?: { held: HeldPosition; mistake: boolean };
}

/** One stretch of the stick lane: a position held from the start of `start` to the start of `end`. */
export interface StickSegment {
  start: number;
  end: number;
  position: Position;
}

export interface TimelineMark {
  frame: number;
  button: ButtonId;
  wrong?: boolean;
}

export interface Timeline {
  fps: number;
  steps: TimelineStep[];
  /** Wrong presses ignored in non-strict mode, after frame 0. */
  ignored: TimelineMark[];
  /**
   * The stick lane, or null when it isn't drawn: drawn only if the combo has a step with a
   * direction check or a direction was held during the attempt. Neutral stretches are left out.
   */
  stick: StickSegment[] | null;
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
    // Relative windows start at the frame the previous press landed on (fixed frame grid),
    // so they line up with the ruler's frame ticks.
    const ref =
      combo.timingMode === 'relative' && i > 0 && prev?.correctedTimestamp !== undefined
        ? msToFrame(prev.correctedTimestamp - frame0, combo.fps)
        : 0;
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
    if (r.presses) {
      const last = r.presses.length - 1;
      out.chordPresses = r.presses.map((p, k) => {
        const mark: TimelineMark = { frame: toFrame(p.correctedTimestamp), button: p.press.button };
        if (r.grade === 'WRONG_BUTTON' && k === last) mark.wrong = true;
        return mark;
      });
      const first = r.presses[0];
      const win = step.chordWindow;
      if (first && win) {
        const start = toFrame(first.correctedTimestamp);
        // Frames: to the end of the last frame allowed; ms: exactly `size` ms after the first press.
        const end =
          win.unit === 'frames'
            ? msToFrame(first.correctedTimestamp - frame0, combo.fps) + win.size + 1
            : start + win.size / fms;
        out.chordWindow = { start, end };
      }
    } else if (r.press && r.press.button !== r.expected[0]) {
      out.pressed = r.press.button;
    }
    if (r.grade === 'MISSED') out.deadline = ref + lastAcceptedFrame(step, settings.timeoutFrames) + 1;
    if (r.direction) out.direction = { held: r.direction.held, mistake: r.directionMistake !== undefined };
    return out;
  });

  // Position history: the position at each frame's end, from frame 0 (finished attempts only).
  const positions = attemptResult(state)?.positions ?? [];
  const showStick = combo.steps.some(hasDirectionCheck) || positions.some((c) => c.position !== 5);

  const ignored = state.ignoredPresses
    .map((p) => ({ frame: toFrame(correctedTimestamp(p, settings)), button: p.button }))
    .filter((m) => m.frame >= 0);

  const furthest = Math.max(
    1,
    ...steps.flatMap((s) => [
      s.windowEnd,
      s.input ?? 0,
      s.deadline ?? 0,
      s.chordWindow?.end ?? 0,
      ...(s.chordPresses ?? []).map((m) => m.frame),
    ]),
    ...ignored.map((m) => m.frame),
    // A position change is drawn from the start of its frame through its end.
    ...(showStick ? positions.map((c) => c.frame + 1) : []),
  );
  const endFrame = Math.ceil(furthest) + 2;
  return { fps: combo.fps, steps, ignored, stick: showStick ? stickSegments(positions, endFrame) : null, endFrame };
}

/**
 * Stick lane segments from the position history: each position from the frame it was held at
 * the end of, to the next change; the last one runs to the end of the ruler. Neutral is skipped.
 */
function stickSegments(positions: readonly { frame: number; position: HeldPosition }[], endFrame: number): StickSegment[] {
  const out: StickSegment[] = [];
  positions.forEach((c, i) => {
    if (c.position === 5) return;
    out.push({ start: c.frame, end: positions[i + 1]?.frame ?? endFrame, position: c.position });
  });
  return out;
}

/** A tick spacing that gives roughly 10 or fewer labelled ticks. */
export function rulerStep(endFrame: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (endFrame / step <= 10) return step;
  }
  return Math.ceil(endFrame / 10 / 600) * 600;
}
