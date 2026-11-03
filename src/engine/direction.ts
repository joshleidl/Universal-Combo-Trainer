// Direction helpers (SPEC §3, "Directions"; §4, "Engine API: directions"). Pure functions; the
// attempt state machine uses them.

import type { ButtonId, DirectionMatch, DirectionMistake, HeldPosition, Step } from './types';
import { DIRECTION_BUTTONS } from './types';

/** True for UP, DOWN, LEFT and RIGHT. */
export function isDirection(button: ButtonId): boolean {
  return DIRECTION_BUTTONS.includes(button);
}

/**
 * The stick position (numpad layout) for a set of held controls. Non-directions are ignored.
 * Opposite directions cancel out (SOCD neutral): LEFT+RIGHT+DOWN is 2 (↓).
 */
export function resolvePosition(held: readonly ButtonId[]): HeldPosition {
  const has = (b: ButtonId) => (held.includes(b) ? 1 : 0);
  const horizontal = has('RIGHT') - has('LEFT');
  const vertical = has('UP') - has('DOWN');
  return (5 + horizontal + 3 * vertical) as HeldPosition;
}

/** The directions a position is made of, vertical first: 3 (↘) is DOWN, RIGHT; 5 is none. */
export function positionDirections(p: HeldPosition): ButtonId[] {
  const out: ButtonId[] = [];
  if (p >= 7) out.push('UP');
  if (p <= 3) out.push('DOWN');
  if (p % 3 === 1) out.push('LEFT');
  if (p % 3 === 0) out.push('RIGHT');
  return out;
}

/**
 * Exact: the held position is the wanted one. At least: every direction of the wanted position
 * is held (so wanted 5 accepts anything).
 */
export function positionMatches(wanted: HeldPosition, held: HeldPosition, match: DirectionMatch): boolean {
  if (match === 'exact') return held === wanted;
  const heldDirs = positionDirections(held);
  return positionDirections(wanted).every((d) => heldDirs.includes(d));
}

/**
 * Why a failed check failed: `missing` when the held position is a strict part of the wanted one
 * (including nothing held for a non-neutral position), `wrong` otherwise (a different direction,
 * or an extra one). Only meaningful for a pair that didn't match.
 */
export function directionMistake(wanted: HeldPosition, held: HeldPosition): DirectionMistake {
  const wantedDirs = positionDirections(wanted);
  const heldDirs = positionDirections(held);
  const strictPart = heldDirs.length < wantedDirs.length && heldDirs.every((d) => wantedDirs.includes(d));
  return strictPart ? 'missing' : 'wrong';
}

/** True for a step with a direction, or a plain step set to exact (which requires neutral). */
export function hasDirectionCheck(step: Step): boolean {
  return step.direction !== undefined || step.directionMatch === 'exact';
}
