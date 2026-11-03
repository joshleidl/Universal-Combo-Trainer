// Step notation on the page (SPEC §7, "Directions in the UI"): "→+MP", with the arrow colored by
// how it must match (blue exact, orange at least) and "(neutral)" in the exact color. The text
// comes from practice/format.ts so the editor and the practice page share one notation.

import type { DirectionMatch, Step } from '../engine/types';
import { directionMatchText, stepNotationParts } from '../practice';
import { el } from './dom';

/** CSS class for a direction's match color. */
export function matchClass(match: DirectionMatch): string {
  return match === 'exact' ? 'dir-exact' : 'dir-at-least';
}

/**
 * A direction arrow in its match color. The title (and hidden text for screen readers) says
 * "exactly ↓" / "at least ↓", so the meaning doesn't rest on color alone.
 */
export function directionArrow(arrow: string, match: DirectionMatch): HTMLElement {
  const text = directionMatchText(arrow, match);
  return el('span', { className: `dir-arrow ${matchClass(match)}`, title: text }, [
    el('span', { textContent: arrow, ariaHidden: 'true' }),
    el('span', { className: 'sr-only', textContent: text }),
  ]);
}

/**
 * A step's notation as nodes. `buttons` replaces the plain "LP+LK" text when the caller draws
 * the buttons itself (the practice step cards mark chord buttons already pressed).
 */
export function notationNodes(
  step: Pick<Step, 'buttons' | 'direction' | 'directionMatch'>,
  buttons?: (Node | string)[],
): (Node | string)[] {
  const p = stepNotationParts(step);
  const out: (Node | string)[] = [];
  if (p.direction) out.push(directionArrow(p.direction.arrow, p.direction.match), '+');
  out.push(...(buttons ?? [p.buttons]));
  if (p.neutral) out.push(' ', el('span', { className: 'ps-neutral dir-exact', textContent: '(neutral)', title: 'neutral required' }));
  return out;
}
