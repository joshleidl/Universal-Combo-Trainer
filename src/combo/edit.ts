// Pure combo-editing helpers used by the editor (Layer 3). No DOM. Every function returns a
// new combo and leaves its input untouched.

import { DEFAULT_FPS, frameToMs } from '../engine/timing';
import type { ButtonId, ChordWindow, Combo, Step } from '../engine/types';

export const DEFAULT_STEP: Readonly<Step> = { buttons: ['LP'], targetFrame: 0, tolEarly: 0, tolLate: 0 };

/** The window a step gets when it becomes a chord. */
export const DEFAULT_CHORD_WINDOW: Readonly<ChordWindow> = { size: 2, unit: 'frames' };

/** A deep copy of one step. */
export function cloneStep(step: Step): Step {
  const out: Step = { ...step, buttons: [...step.buttons] };
  if (step.chordWindow) out.chordWindow = { ...step.chordWindow };
  return out;
}

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
  return { ...combo, steps: combo.steps.map(cloneStep) };
}

/** The step "Add step" appends: a copy of the last step without its label, or the default. */
export function nextStep(steps: readonly Step[]): Step {
  const last = steps.at(-1);
  if (!last) return cloneStep(DEFAULT_STEP);
  const { label: _label, ...rest } = cloneStep(last);
  return rest;
}

export function addStep(combo: Combo, step: Step = nextStep(combo.steps)): Combo {
  return { ...combo, steps: [...combo.steps, cloneStep(step)] };
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
 * A step that becomes a chord gets the default chord window; one that goes back to a single
 * button loses its window. Out-of-range indexes return the combo unchanged.
 */
export function updateStep(combo: Combo, index: number, patch: StepPatch): Combo {
  const current = combo.steps[index];
  if (!current) return combo;
  const { label, ...rest } = patch;
  const next: Step = { ...cloneStep(current), ...rest };
  if (rest.buttons) next.buttons = [...rest.buttons];
  if (rest.chordWindow) next.chordWindow = { ...rest.chordWindow };
  if ('label' in patch) {
    const trimmed = label?.trim() ?? '';
    if (trimmed) next.label = label as string;
    else delete next.label;
  }
  if (next.buttons.length > 1) next.chordWindow ??= { ...DEFAULT_CHORD_WINDOW };
  else delete next.chordWindow;
  return { ...combo, steps: combo.steps.map((s, i) => (i === index ? next : s)) };
}

/** Sets the button in one slot of a step's button list. */
export function setStepButton(combo: Combo, index: number, slot: number, button: ButtonId): Combo {
  const step = combo.steps[index];
  if (!step || slot < 0 || slot >= step.buttons.length) return combo;
  return updateStep(combo, index, { buttons: step.buttons.map((b, i) => (i === slot ? button : b)) });
}

/** Adds a button to a step, making it a chord (or a bigger one). */
export function addChordButton(combo: Combo, index: number, button: ButtonId): Combo {
  const step = combo.steps[index];
  if (!step) return combo;
  return updateStep(combo, index, { buttons: [...step.buttons, button] });
}

/** Removes the button in one slot. A step always keeps at least one button. */
export function removeChordButton(combo: Combo, index: number, slot: number): Combo {
  const step = combo.steps[index];
  if (!step || step.buttons.length < 2 || slot < 0 || slot >= step.buttons.length) return combo;
  return updateStep(combo, index, { buttons: step.buttons.filter((_, i) => i !== slot) });
}

/** The first of `choices` not already in the step, or null if none is free. */
export function nextChordButton(step: Step, choices: readonly ButtonId[]): ButtonId | null {
  return choices.find((b) => !step.buttons.includes(b)) ?? null;
}

/**
 * True when two combos have the same content (key order, missing labels and a missing
 * directionMatch, which means atLeast, don't matter).
 */
export function combosEqual(a: Combo, b: Combo): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(c: Combo): unknown {
  return [
    c.name,
    c.fps,
    c.timingMode,
    c.startMode,
    c.steps.map((s) => [
      s.buttons,
      s.targetFrame,
      s.tolEarly,
      s.tolLate,
      s.label ?? '',
      s.buttons.length > 1 && s.chordWindow ? [s.chordWindow.size, s.chordWindow.unit] : null,
      s.direction ?? null,
      // A step without a match is at least (SPEC §3).
      s.directionMatch ?? 'atLeast',
    ]),
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

/**
 * The same window in another unit at `fps`, so switching units doesn't jump to a very different
 * size: frames → ms rounds to 0.1 ms, ms → frames rounds to the nearest frame. Without a valid
 * fps the size is kept as is (rounded to a whole number for frames).
 */
export function convertChordWindow(win: ChordWindow, unit: ChordWindow['unit'], fps: number): ChordWindow {
  if (win.unit === unit) return { ...win };
  const fpsOk = Number.isFinite(fps) && fps > 0;
  if (unit === 'ms') {
    return { size: fpsOk ? Math.round(frameToMs(win.size, fps) * 10) / 10 : win.size, unit };
  }
  const frames = fpsOk ? (win.size * fps) / 1000 : win.size;
  return { size: Math.max(0, Math.round(frames)), unit };
}
