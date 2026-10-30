import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEP,
  addStep,
  cloneCombo,
  combosEqual,
  moveStep,
  newCombo,
  nextStep,
  onTimeWindow,
  removeStep,
  updateStep,
} from '../../src/combo/edit';
import { EXAMPLE_COMBOS } from '../../src/combo/examples';
import { validateCombo } from '../../src/engine/attempt';
import type { Combo, Step } from '../../src/engine/types';

const s = (button: string, targetFrame: number, extra: Partial<Step> = {}): Step => ({
  button,
  targetFrame,
  tolEarly: 0,
  tolLate: 0,
  ...extra,
});

const combo = (steps: Step[]): Combo => ({ ...newCombo('c'), steps });

describe('newCombo', () => {
  it('uses the spec defaults and is valid', () => {
    const c = newCombo();
    expect(c).toEqual({
      name: 'New combo',
      steps: [DEFAULT_STEP],
      fps: 60,
      timingMode: 'relative',
      startMode: 'firstInput',
    });
    expect(validateCombo(c)).toEqual([]);
  });
});

describe('nextStep / addStep', () => {
  it('copies the last step without its label', () => {
    expect(nextStep([s('LP', 0), s('HK', 7, { tolEarly: 1, tolLate: 2, label: 'x' })])).toEqual(
      s('HK', 7, { tolEarly: 1, tolLate: 2 }),
    );
  });

  it('falls back to the default step when there are none', () => {
    expect(nextStep([])).toEqual(DEFAULT_STEP);
  });

  it('appends without mutating the input', () => {
    const c = combo([s('LP', 0)]);
    const next = addStep(c);
    expect(next.steps).toHaveLength(2);
    expect(c.steps).toHaveLength(1);
    expect(next.steps[1]).not.toBe(next.steps[0]);
  });

  it('appends a given step', () => {
    expect(addStep(combo([]), s('MK', 4)).steps).toEqual([s('MK', 4)]);
  });
});

describe('removeStep', () => {
  it('removes by index', () => {
    const c = combo([s('LP', 0), s('MP', 1), s('HP', 2)]);
    expect(removeStep(c, 1).steps.map((x) => x.button)).toEqual(['LP', 'HP']);
    expect(c.steps).toHaveLength(3);
  });

  it('can remove the last remaining step', () => {
    expect(removeStep(combo([s('LP', 0)]), 0).steps).toEqual([]);
  });

  it('ignores out-of-range indexes', () => {
    const c = combo([s('LP', 0)]);
    expect(removeStep(c, 1)).toBe(c);
    expect(removeStep(c, -1)).toBe(c);
  });
});

describe('moveStep', () => {
  const c = combo([s('A', 0), s('B', 1), s('C', 2)]);
  const order = (x: Combo) => x.steps.map((st) => st.button).join('');

  it('moves up and down', () => {
    expect(order(moveStep(c, 2, 1))).toBe('ACB');
    expect(order(moveStep(c, 0, 1))).toBe('BAC');
    expect(order(moveStep(c, 0, 2))).toBe('BCA');
    expect(order(c)).toBe('ABC');
  });

  it('ignores out-of-range or no-op moves', () => {
    expect(moveStep(c, 0, 3)).toBe(c);
    expect(moveStep(c, -1, 0)).toBe(c);
    expect(moveStep(c, 1, 1)).toBe(c);
  });
});

describe('updateStep', () => {
  it('patches fields of one step', () => {
    const c = combo([s('LP', 0), s('MP', 5)]);
    const next = updateStep(c, 1, { button: 'HK', tolLate: 2 });
    expect(next.steps[1]).toEqual(s('HK', 5, { tolLate: 2 }));
    expect(next.steps[0]).toBe(c.steps[0]);
    expect(c.steps[1]).toEqual(s('MP', 5));
  });

  it('sets and clears labels; blank labels are removed', () => {
    const c = combo([s('LP', 0)]);
    const labelled = updateStep(c, 0, { label: 'cr.LP' });
    expect(labelled.steps[0]?.label).toBe('cr.LP');
    expect('label' in updateStep(labelled, 0, { label: '   ' }).steps[0]!).toBe(false);
    expect('label' in updateStep(labelled, 0, { label: undefined }).steps[0]!).toBe(false);
  });

  it('leaves the label alone when the patch has no label key', () => {
    const c = combo([s('LP', 0, { label: 'keep' })]);
    expect(updateStep(c, 0, { targetFrame: 3 }).steps[0]?.label).toBe('keep');
  });

  it('ignores out-of-range indexes', () => {
    const c = combo([s('LP', 0)]);
    expect(updateStep(c, 4, { button: 'HP' })).toBe(c);
  });
});

describe('combosEqual / cloneCombo', () => {
  it('treats a clone as equal but not the same object', () => {
    const c = combo([s('LP', 0, { label: 'a' })]);
    const k = cloneCombo(c);
    expect(combosEqual(c, k)).toBe(true);
    expect(k.steps[0]).not.toBe(c.steps[0]);
  });

  it('ignores key order and a missing vs empty label', () => {
    const a: Combo = { name: 'x', fps: 60, timingMode: 'relative', startMode: 'firstInput', steps: [s('LP', 0)] };
    const b: Combo = { startMode: 'firstInput', steps: [{ tolLate: 0, tolEarly: 0, targetFrame: 0, button: 'LP' }], timingMode: 'relative', fps: 60, name: 'x' };
    expect(combosEqual(a, b)).toBe(true);
  });

  it('detects any changed field', () => {
    const base = combo([s('LP', 0), s('MP', 3)]);
    expect(combosEqual(base, { ...base, name: 'other' })).toBe(false);
    expect(combosEqual(base, { ...base, fps: 30 })).toBe(false);
    expect(combosEqual(base, { ...base, timingMode: 'absolute' })).toBe(false);
    expect(combosEqual(base, { ...base, startMode: 'countdown' })).toBe(false);
    expect(combosEqual(base, updateStep(base, 1, { tolEarly: 1 }))).toBe(false);
    expect(combosEqual(base, updateStep(base, 1, { label: 'x' }))).toBe(false);
    expect(combosEqual(base, moveStep(base, 0, 1))).toBe(false);
  });
});

describe('EXAMPLE_COMBOS', () => {
  it('ships 2–3 valid examples with unique ids', () => {
    expect(EXAMPLE_COMBOS.length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLE_COMBOS.length).toBeLessThanOrEqual(3);
    expect(new Set(EXAMPLE_COMBOS.map((e) => e.id)).size).toBe(EXAMPLE_COMBOS.length);
    for (const e of EXAMPLE_COMBOS) expect(validateCombo(e.combo)).toEqual([]);
  });
});

describe('onTimeWindow', () => {
  it('covers target ± tolerances, ending at the end of the last frame', () => {
    expect(onTimeWindow(s('LP', 12, { tolEarly: 2, tolLate: 1 }), 60)).toEqual({
      firstFrame: 10,
      lastFrame: 13,
      startMs: (10 * 1000) / 60,
      endMs: (14 * 1000) / 60,
    });
  });

  it('is one frame wide with no tolerance, at any fps', () => {
    expect(onTimeWindow(s('LP', 3), 30)).toEqual({ firstFrame: 3, lastFrame: 3, startMs: 100, endMs: 1000 / 30 * 4 });
    const w = onTimeWindow(s('LP', 3), 120);
    expect(w.endMs - w.startMs).toBeCloseTo(1000 / 120);
  });

  it('can start before frame 0 when the early tolerance is larger than the target', () => {
    expect(onTimeWindow(s('LP', 1, { tolEarly: 2 }), 60).firstFrame).toBe(-1);
  });
});
