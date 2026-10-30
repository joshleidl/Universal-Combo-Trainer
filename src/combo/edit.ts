// Pure combo-editing helpers used by the editor (Layer 3). No DOM. Every function returns a
// new combo and leaves its input untouched.

import { DEFAULT_FPS, frameToMs } from '../engine/timing';
import type { Combo, Step } from '../engine/types';

export const DEFAULT_STEP: Readonly<Step> = { button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0 };

export function newCombo(name = 'New combo'): Combo {
  return {
    name,
    steps: [{ ...DEFAULT_STEP }],
    fps: DEFAULT_FPS,
    timingMode: 'relative',
    startMode: 'firstInput',
  };
}

export function cloneCombo(combo: Combo): Combo {
  return { ...combo, steps: combo.steps.map((s) => ({ ...s })) };
}

/** The step "Add step" appends: a copy of the last step without its label, or the default. */
export function nextStep(steps: readonly Step[]): Step {
  const last = steps.at(-1);
  if (!last) return { ...DEFAULT_STEP };
  return { button: last.button, targetFrame: last.targetFrame, tolEarly: last.tolEarly, tolLate: last.tolLate };
}

export function addStep(combo: Combo, step: Step = nextStep(combo.steps)): Combo {
  return { ...combo, steps: [...combo.steps, { ...step }] };
}

/** Removes the step at `index`. Out-of-range indexes return the combo unchanged. */
export function removeStep(combo: Combo, index: number): Combo {
  if (!inRange(combo, index)) return combo;
  return { ...combo, steps: combo.steps.filter((_, i) => i !== index) };
}

/** Moves a step from one index to another. Out-of-range indexes return the combo unchanged. */
export function moveStep(combo: Combo, from: number, to: number): Combo {
  if (!inRange(combo, from) || !inRange(combo, to) || from === to) return combo;
  const steps = [...combo.steps];
  const [moved] = steps.splice(from, 1);
  if (moved) steps.splice(to, 0, moved);
  return { ...combo, steps };
}

export type StepPatch = Partial<Omit<Step, 'label'>> & { label?: string | undefined };

/**
 * Applies a patch to one step. An empty or whitespace-only label removes the label.
 * Out-of-range indexes return the combo unchanged.
 */
export function updateStep(combo: Combo, index: number, patch: StepPatch): Combo {
  const current = combo.steps[index];
  if (!current) return combo;
  const { label, ...rest } = patch;
  const next: Step = { ...current, ...rest };
  if ('label' in patch) {
    const trimmed = label?.trim() ?? '';
    if (trimmed) next.label = label as string;
    else delete next.label;
  }
  return { ...combo, steps: combo.steps.map((s, i) => (i === index ? next : s)) };
}

/** True when two combos have the same content (key order and missing labels don't matter). */
export function combosEqual(a: Combo, b: Combo): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(c: Combo): unknown {
  return [
    c.name,
    c.fps,
    c.timingMode,
    c.startMode,
    c.steps.map((s) => [s.button, s.targetFrame, s.tolEarly, s.tolLate, s.label ?? '']),
  ];
}

function inRange(combo: Combo, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < combo.steps.length;
}

export interface OnTimeWindow {
  firstFrame: number;
  lastFrame: number;
  /** Start of the first on-time frame, in ms from the step's reference. */
  startMs: number;
  /** End of the last on-time frame (exclusive), in ms from the step's reference. */
  endMs: number;
}

/** The frames a step counts as on time, and the time span they cover (SPEC §3). */
export function onTimeWindow(step: Step, fps: number): OnTimeWindow {
  const firstFrame = step.targetFrame - step.tolEarly;
  const lastFrame = step.targetFrame + step.tolLate;
  return { firstFrame, lastFrame, startMs: frameToMs(firstFrame, fps), endMs: frameToMs(lastFrame + 1, fps) };
}
