// Which sounds a practice state change should make (SPEC §7, optional audio). Pure: the UI
// plays what these return. Timestamps are in the performance.now() clock.

import type { AttemptState } from '../engine/attempt';
import { frameToMs } from '../engine/timing';
import type { Combo } from '../engine/types';
import { COUNTDOWN_BEATS, COUNTDOWN_BEAT_MS, type PracticeState } from './session';

/** Event sounds: a step graded on time or off, and a whole attempt clean or failed. */
export type Cue = 'onTime' | 'off' | 'clean' | 'fail';

/**
 * Sounds for the change from `prev` to `next`. A finished attempt gives one clean/fail sound
 * (not also a sound for its last step). The first-input start step makes no sound, since its
 * timing isn't graded.
 */
export function practiceCues(prev: PracticeState, next: PracticeState): Cue[] {
  const a = next.attempt;
  if (a === prev.attempt) return [];
  if (a.phase === 'done' && prev.attempt.phase !== 'done') {
    return [a.results.length === a.combo.steps.length && a.results.every((r) => r.grade === 'ON_TIME') ? 'clean' : 'fail'];
  }
  const fresh = a.results.filter((r) => !prev.attempt.results.includes(r));
  return fresh
    .filter((r) => !(a.combo.startMode === 'firstInput' && r.stepIndex === 0))
    .map((r) => (r.grade === 'ON_TIME' ? 'onTime' : 'off'));
}

/** Metronome ticks sound this far into the target frame: its middle, the safest moment to press. */
export const METRONOME_FRAME_POINT = 0.5;

export interface MetronomeTick {
  /** Stable for the same tick across calls, so the UI schedules each tick once. */
  key: string;
  at: number;
}

/**
 * Metronome ticks that are known now for a running attempt. Relative timing only knows the
 * awaited step (it depends on the previous press); absolute timing knows every remaining step.
 * Ticks are in the latency-corrected clock the grading uses, so pressing on the tick (as heard,
 * with the calibrated offset) lands on the target.
 */
export function metronomeTicks(attempt: AttemptState): MetronomeTick[] {
  if (attempt.phase !== 'running' || attempt.frame0 === null) return [];
  const { combo, results, frame0, lastInput } = attempt;
  const next = results.length;
  const indexes =
    combo.timingMode === 'relative' ? [next] : combo.steps.map((_, i) => i).filter((i) => i >= next);
  const ticks: MetronomeTick[] = [];
  for (const i of indexes) {
    const step = combo.steps[i];
    if (!step || (combo.startMode === 'firstInput' && i === 0)) continue;
    const ref = combo.timingMode === 'relative' && i > 0 ? lastInput : frame0;
    if (ref === null) continue;
    const at = ref + frameToMs(step.targetFrame + METRONOME_FRAME_POINT, combo.fps);
    ticks.push({ key: `${frame0}:${i}:${at}`, at });
  }
  return ticks;
}

/** Quiet time before a timing preview's first sound. */
export const PREVIEW_LEAD_MS = 300;

export interface PreviewSound {
  kind: 'beat' | 'go' | 'press';
  /** Ms after the preview starts. */
  at: number;
  /** The step this press belongs to (press sounds only). */
  stepIndex?: number;
}

/**
 * The combo's expected timing as sounds: one press sound per step, played where a press on
 * the middle of its target frame would land (the metronome point). Relative steps follow the
 * previous expected press; absolute steps count from frame 0. The first-input start step is
 * frame 0. Countdown combos get the countdown beats and Go first, with Go as frame 0.
 */
export function timingPreview(combo: Combo): PreviewSound[] {
  const sounds: PreviewSound[] = [];
  let frame0: number;
  if (combo.startMode === 'countdown') {
    for (let k = 0; k < COUNTDOWN_BEATS; k++) sounds.push({ kind: 'beat', at: PREVIEW_LEAD_MS + k * COUNTDOWN_BEAT_MS });
    frame0 = PREVIEW_LEAD_MS + COUNTDOWN_BEATS * COUNTDOWN_BEAT_MS;
    sounds.push({ kind: 'go', at: frame0 });
  } else {
    frame0 = PREVIEW_LEAD_MS;
  }
  let prev = frame0;
  combo.steps.forEach((step, i) => {
    let at: number;
    if (combo.startMode === 'firstInput' && i === 0) at = frame0;
    else {
      const ref = combo.timingMode === 'relative' && i > 0 ? prev : frame0;
      at = ref + frameToMs(step.targetFrame + METRONOME_FRAME_POINT, combo.fps);
    }
    sounds.push({ kind: 'press', at, stepIndex: i });
    prev = at;
  });
  return sounds;
}
