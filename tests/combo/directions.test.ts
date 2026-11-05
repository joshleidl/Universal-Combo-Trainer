// Direction+button steps, session B: the new Step fields, their validation, and storage.
// Grading with directions comes in session C.
import { describe, expect, it } from 'vitest';
import { cloneCombo, combosEqual, newCombo } from '../../src/combo/edit';
import { validateCombo } from '../../src/engine/attempt';
import type { Combo, Step } from '../../src/engine/types';
import { ComboStore, COMBOS_BACKUP_KEY, COMBOS_KEY, memoryStorage, parseCombo } from '../../src/storage/combos';

const step = (extra: Partial<Step> = {}): Step => ({ buttons: ['MP'], targetFrame: 0, tolEarly: 0, tolLate: 0, ...extra });
const combo = (steps: Step[]): Combo => ({ ...newCombo('c'), steps });
const base = { name: 'n', fps: 60, timingMode: 'relative', startMode: 'firstInput' };

describe('direction validation', () => {
  it('accepts every numpad position but 5, with either match or none', () => {
    for (const d of [1, 2, 3, 4, 6, 7, 8, 9] as const) {
      expect(validateCombo(combo([step({ direction: d })]))).toEqual([]);
      expect(validateCombo(combo([step({ direction: d, directionMatch: 'exact' })]))).toEqual([]);
      expect(validateCombo(combo([step({ direction: d, directionMatch: 'atLeast' })]))).toEqual([]);
    }
  });

  it('accepts a match on a plain step (exact = neutral required)', () => {
    expect(validateCombo(combo([step({ directionMatch: 'exact' })]))).toEqual([]);
    expect(validateCombo(combo([step({ directionMatch: 'atLeast' })]))).toEqual([]);
  });

  it('accepts a direction on a chord', () => {
    const chord = step({ buttons: ['LP', 'LK'], chordWindow: { size: 2, unit: 'frames' }, direction: 4 });
    expect(validateCombo(combo([chord]))).toEqual([]);
  });

  it('rejects 5, out-of-range and non-integer directions', () => {
    for (const d of [5, 0, 10, -1, 2.5, Number.NaN]) {
      const errors = validateCombo(combo([step({ direction: d as never })]));
      expect(errors).toEqual(['step 1: direction must be a numpad position 1–9 other than 5']);
    }
  });

  it('rejects an unknown match', () => {
    expect(validateCombo(combo([step({ direction: 6, directionMatch: 'atMost' as never })]))).toEqual([
      'step 1: directionMatch must be exact or atLeast',
    ]);
  });

  it('still needs a button: a direction alone is not a step', () => {
    expect(validateCombo(combo([step({ buttons: [], direction: 2 })]))).toEqual(['step 1: button is required']);
  });
});

describe('direction fields in storage', () => {
  const dirSteps: Step[] = [
    step({ buttons: ['MK'], direction: 2, label: 'cr.MK' }),
    step({ buttons: ['HP'], targetFrame: 3, direction: 3, directionMatch: 'exact' }),
    step({ buttons: ['LP', 'LK'], targetFrame: 5, chordWindow: { size: 2, unit: 'frames' }, direction: 4, directionMatch: 'atLeast' }),
    step({ buttons: ['MP'], targetFrame: 2, directionMatch: 'exact' }),
  ];

  it('round-trips direction and directionMatch through save and reload', () => {
    const storage = memoryStorage();
    const store = new ComboStore(storage, { examples: [], makeId: () => 'x' });
    store.create(combo(dirSteps));
    const reloaded = new ComboStore(storage, { examples: [] }).get('x');
    expect(reloaded?.combo.steps).toEqual(dirSteps);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBeNull();
  });

  it('loads a step without the fields as a plain step, with no fields added', () => {
    const loaded = parseCombo({ ...base, steps: [step()] });
    expect(loaded?.steps[0]).toEqual(step());
    expect(loaded?.steps[0]).not.toHaveProperty('direction');
    expect(loaded?.steps[0]).not.toHaveProperty('directionMatch');
  });

  it('drops unknown fields but keeps the direction ones', () => {
    const loaded = parseCombo({ ...base, steps: [{ ...step({ direction: 6 }), facing: 'left' }] });
    expect(loaded?.steps[0]).toEqual(step({ direction: 6 }));
  });

  it('rejects a combo with a bad direction or match', () => {
    expect(parseCombo({ ...base, steps: [step({ direction: 5 as never })] })).toBeNull();
    expect(parseCombo({ ...base, steps: [{ ...step(), direction: '6' }] })).toBeNull();
    expect(parseCombo({ ...base, steps: [{ ...step(), direction: null }] })).toBeNull();
    expect(parseCombo({ ...base, steps: [{ ...step(), directionMatch: 'any' }] })).toBeNull();
  });

  it('backs up and drops a saved combo with a bad direction, keeping the rest', () => {
    const good = { id: 'a', combo: combo([step({ direction: 6 })]) };
    const bad = { id: 'b', combo: combo([step({ direction: 5 as never })]) };
    const raw = JSON.stringify({ version: 1, combos: [good, bad] });
    const storage = memoryStorage({ [COMBOS_KEY]: raw });
    const store = new ComboStore(storage, { examples: [] });
    expect(store.list()).toEqual([good]);
    expect(storage.getItem(COMBOS_BACKUP_KEY)).toBe(raw);
  });

  it('keeps direction fields when the single-direction conversion runs', () => {
    const steps = [step({ buttons: ['DOWN'], targetFrame: 2 }), step({ targetFrame: 1, direction: 3, directionMatch: 'exact' })];
    expect(parseCombo({ ...base, steps })?.steps).toEqual([step({ targetFrame: 3, direction: 3, directionMatch: 'exact' })]);
  });

  it('refuses to save an invalid direction', () => {
    const store = new ComboStore(memoryStorage(), { examples: [] });
    expect(() => store.create(combo([step({ direction: 5 as never })]))).toThrow(/direction/);
  });
});

describe('combosEqual / cloneCombo with directions', () => {
  it('copies the fields', () => {
    const c = combo([step({ direction: 9, directionMatch: 'exact' })]);
    expect(cloneCombo(c).steps[0]).toEqual(c.steps[0]);
  });

  it('notices a changed direction or match', () => {
    const a = combo([step({ direction: 6, directionMatch: 'exact' })]);
    expect(combosEqual(a, combo([step({ direction: 3, directionMatch: 'exact' })]))).toBe(false);
    expect(combosEqual(a, combo([step({ direction: 6, directionMatch: 'atLeast' })]))).toBe(false);
    expect(combosEqual(a, combo([step({ directionMatch: 'exact' })]))).toBe(false);
  });

  it('treats a missing match as at least', () => {
    expect(combosEqual(combo([step({ direction: 2 })]), combo([step({ direction: 2, directionMatch: 'atLeast' })]))).toBe(true);
    expect(combosEqual(combo([step()]), combo([step({ directionMatch: 'atLeast' })]))).toBe(true);
    expect(combosEqual(combo([step()]), combo([step({ directionMatch: 'exact' })]))).toBe(false);
  });
});
