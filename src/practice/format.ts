// Feedback text for results (SPEC §7), e.g. "2f late (+31.4 ms)". Pure string formatting.

import type { AttemptResult, ButtonId, ChordPress, StepResult } from '../engine/types';

const MINUS = '−';

/** "+31.4 ms" / "−4.0 ms" / "+0.0 ms". */
export function signedMs(ms: number): string {
  const rounded = Math.round(ms * 10) / 10;
  const sign = rounded < 0 ? MINUS : '+';
  return `${sign}${Math.abs(rounded).toFixed(1)} ms`;
}

/** "+2f" / "−1f" / "0f". */
export function signedFrames(frames: number): string {
  if (frames === 0) return '0f';
  return `${frames < 0 ? MINUS : '+'}${Math.abs(frames)}f`;
}

/** "LP+MP": a step's buttons as one name. */
export function buttonsName(buttons: readonly ButtonId[]): string {
  return buttons.join('+');
}

/** How one chord press landed: "3f early", "on time", "on time (+1f)", "2f late". */
function pressTimingText(p: ChordPress): string {
  const d = p.deltaFrames ?? 0;
  switch (p.timing) {
    case 'EARLY':
      return `${Math.abs(d)}f early`;
    case 'LATE':
      return `${d}f late`;
    case 'ON_TIME':
      return d === 0 ? 'on time' : `on time (${signedFrames(d)})`;
    default:
      return '';
  }
}

/** One-line feedback for a graded step. `isStart` marks a first-input start step. */
export function describeStep(r: StepResult, isStart: boolean): string {
  const ms = r.deltaMs !== undefined ? ` (${signedMs(r.deltaMs)})` : '';
  const d = r.deltaFrames ?? 0;
  switch (r.grade) {
    case 'ON_TIME':
      if (isStart) return 'Start';
      if (d === 0) return `On time${ms}`;
      return `On time, ${Math.abs(d)}f ${d < 0 ? 'early' : 'late'}${ms}`;
    case 'EARLY':
      return `${Math.abs(d)}f early${ms}`;
    case 'LATE':
      return `${d}f late${ms}`;
    case 'SPLIT': {
      const parts = (r.presses ?? []).map((p) => `${p.press.button} ${pressTimingText(p)}`.trim());
      return `Split: ${parts.join(', ')}`;
    }
    case 'PARTIAL': {
      const pressed = (r.presses ?? []).map((p) => p.press.button);
      const missing = r.expected.filter((b) => !pressed.includes(b));
      const got = pressed.length === 1 ? `${pressed[0]} only` : buttonsName(pressed);
      return `Partial: ${got}, ${buttonsName(missing)} missing`;
    }
    case 'WRONG_BUTTON': {
      const pressed = r.presses ? buttonsName(r.presses.map((p) => p.press.button)) : (r.press?.button ?? '?');
      const what = `Wrong button: ${pressed}`;
      if (isStart || r.deltaFrames === undefined) return what;
      return `${what} at ${signedFrames(d)}${ms}`;
    }
    case 'MISSED':
      return 'Missed';
  }
}

/** One-line summary of a finished attempt. */
export function describeAttempt(result: AttemptResult): string {
  const total = result.combo.steps.length;
  const last = result.results.at(-1);
  const stepNo = last ? last.stepIndex + 1 : 1;
  switch (result.endedBy) {
    case 'completed': {
      if (result.success) return 'Clean! Every step on time.';
      const onTime = result.results.filter((r) => r.grade === 'ON_TIME').length;
      return `Completed: ${onTime} of ${total} steps on time.`;
    }
    case 'missed':
      return `Missed step ${stepNo}.`;
    case 'wrongButton':
      return `Wrong button on step ${stepNo}.`;
    case 'partial':
      return `Partial chord on step ${stepNo}.`;
  }
}
