// Feedback text for results (SPEC §7), e.g. "2f late (+31.4 ms)". Pure string formatting.

import { chordGrade } from '../engine/chord';
import { positionDirections } from '../engine/direction';
import type { AttemptResult, ButtonId, ChordPress, DirectionMatch, Grade, HeldPosition, PressTiming, Step, StepResult } from '../engine/types';
import type { ResultKind } from './stats';

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

/** Arrows for stick positions in numpad layout (SPEC §7, "Directions in the UI"); 5 is neutral. */
const ARROWS: Readonly<Record<HeldPosition, string>> = {
  1: '↙',
  2: '↓',
  3: '↘',
  4: '←',
  5: '•',
  6: '→',
  7: '↖',
  8: '↑',
  9: '↗',
};

/** "↘" for 3, "•" for neutral. */
export function positionArrow(p: HeldPosition): string {
  return ARROWS[p];
}

const POSITION_NAMES: Readonly<Record<HeldPosition, string>> = {
  1: 'down-left',
  2: 'down',
  3: 'down-right',
  4: 'left',
  5: 'none',
  6: 'right',
  7: 'up-left',
  8: 'up',
  9: 'up-right',
};

/** "↘ down-right" for 3, "• none" for neutral: the editor's direction choices. */
export function positionChoiceText(p: HeldPosition): string {
  return `${ARROWS[p]} ${POSITION_NAMES[p]}`;
}

type NotationStep = Pick<Step, 'buttons' | 'direction' | 'directionMatch'>;

/**
 * A step's notation in pieces, so the page can color the direction by how it must match (SPEC
 * §7: exact and at-least directions differ by color, not by a symbol). `match` is the step's
 * directionMatch, at least when it's missing. `neutral` marks an exact plain step.
 */
export interface StepNotationParts {
  direction?: { arrow: string; match: DirectionMatch };
  buttons: string;
  neutral: boolean;
}

export function stepNotationParts(step: NotationStep): StepNotationParts {
  const buttons = buttonsName(step.buttons);
  if (step.direction !== undefined) {
    return { direction: { arrow: positionArrow(step.direction), match: step.directionMatch ?? 'atLeast' }, buttons, neutral: false };
  }
  return { buttons, neutral: step.directionMatch === 'exact' };
}

/**
 * A step in arrow notation as plain text: "→+MP", "←+LP+LK", "HP (neutral)" for an exact plain
 * step, plain "MP" otherwise. Exact and at-least directions read the same here; the page tells
 * them apart by color (`stepNotationParts`).
 */
export function stepNotation(step: NotationStep): string {
  const p = stepNotationParts(step);
  if (p.direction) return `${p.direction.arrow}+${p.buttons}`;
  return p.neutral ? `${p.buttons} (neutral)` : p.buttons;
}

/** "exactly ↓" / "at least ↓": what a direction's color means, for titles and screen readers. */
export function directionMatchText(arrow: string, match: DirectionMatch): string {
  return match === 'exact' ? `exactly ${arrow}` : `at least ${arrow}`;
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

/**
 * One-line feedback for a graded step. `isStart` marks a first-input start step. A direction
 * mistake gets the timing text its presses earned, then a direction note: "On time (+5.2 ms) ·
 * Direction: ↘, wanted → exactly". Wording that timing needs the step's tolerances; without
 * `step` they count as 0.
 */
export function describeStep(r: StepResult, isStart: boolean, step?: Pick<Step, 'tolEarly' | 'tolLate'>): string {
  if (r.directionMistake && r.direction) {
    const timing = describeGrade({ ...r, grade: timingGrade(r, step ?? { tolEarly: 0, tolLate: 0 }) }, isStart);
    return `${timing} · ${directionNote(r.direction)}`;
  }
  return describeGrade(r, isStart);
}

/**
 * The grade a step's presses earned on timing alone, before a failed direction check replaced
 * it: a chord's per-press timings (split rule), or a single press's deltaFrames against the
 * step's tolerances.
 */
export function timingGrade(r: StepResult, step: Pick<Step, 'tolEarly' | 'tolLate'>): Grade {
  if (r.presses) {
    const timings = r.presses.map((p) => p.timing).filter((t): t is PressTiming => t !== undefined);
    // A first-input start chord has no timing; it counts as on time like any start step.
    return timings.length > 0 ? chordGrade(timings) : 'ON_TIME';
  }
  const d = r.deltaFrames ?? 0;
  if (d < -step.tolEarly) return 'EARLY';
  if (d > step.tolLate) return 'LATE';
  return 'ON_TIME';
}

/**
 * "Direction: ↘, wanted → exactly" (SPEC §7): "exactly" when an exact step's held position
 * contains the wanted one, "any ↓" for at least, "neutral" for an exact plain step, and
 * "none" when nothing was held.
 */
export function directionNote(d: NonNullable<StepResult['direction']>): string {
  const held = d.held === 5 ? 'none' : positionArrow(d.held);
  let wanted: string;
  if (d.wanted === 5) wanted = 'neutral';
  else if (d.match === 'atLeast') wanted = `any ${positionArrow(d.wanted)}`;
  else {
    const heldDirs = positionDirections(d.held);
    const contains = positionDirections(d.wanted).every((x) => heldDirs.includes(x));
    wanted = contains ? `${positionArrow(d.wanted)} exactly` : positionArrow(d.wanted);
  }
  return `Direction: ${held}, wanted ${wanted}`;
}

function describeGrade(r: StepResult, isStart: boolean): string {
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

/** Labels for "Other results" in the stats table, in display order (SPEC §7). */
const OTHER_RESULTS: readonly [ResultKind, string][] = [
  ['EARLY', 'early'],
  ['LATE', 'late'],
  ['SPLIT', 'split'],
  ['PARTIAL', 'partial'],
  ['WRONG_BUTTON', 'wrong'],
  ['wrongDirection', 'wrong direction'],
  ['missingDirection', 'missing direction'],
  ['MISSED', 'missed'],
];

/** Results other than on time, e.g. "2 early · 1 wrong direction", or "—" when there are none. */
export function otherResultsText(counts: Readonly<Record<ResultKind, number>>): string {
  const parts = OTHER_RESULTS.filter(([k]) => counts[k] > 0).map(([k, name]) => `${counts[k]} ${name}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
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
