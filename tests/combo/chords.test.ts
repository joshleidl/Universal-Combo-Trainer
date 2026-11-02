import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHORD_WINDOW,
  addChordButton,
  cloneCombo,
  combosEqual,
  convertChordWindow,
  newCombo,
  nextChordButton,
  nextStep,
  removeChordButton,
  setStepButton,
  updateStep,
} from '../../src/combo/edit';
import { decodeCombo, encodeCombo } from '../../src/combo/share';
import type { Combo, Step } from '../../src/engine/types';
import { ComboStore, COMBOS_KEY, memoryStorage, parseCombo } from '../../src/storage/combos';

const single = (button: string, targetFrame = 0): Step => ({ buttons: [button], targetFrame, tolEarly: 0, tolLate: 0 });
const chordStep: Step = {
  buttons: ['LP', 'MP'],
  targetFrame: 10,
  tolEarly: 1,
  tolLate: 1,
  chordWindow: { size: 2, unit: 'frames' },
  label: 'throw',
};
const combo = (steps: Step[]): Combo => ({ ...newCombo('c'), steps });
const json = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('chord editing helpers', () => {
  it('adding a button makes a chord with the default window', () => {
    const c = addChordButton(combo([single('LP')]), 0, 'MP');
    expect(c.steps[0]).toEqual({ ...single('LP'), buttons: ['LP', 'MP'], chordWindow: DEFAULT_CHORD_WINDOW });
    expect(c.steps[0]!.chordWindow).not.toBe(DEFAULT_CHORD_WINDOW);
  });

  it('a chord keeps its own window when it grows', () => {
    const c = addChordButton(combo([chordStep]), 0, 'HP');
    expect(c.steps[0]).toMatchObject({ buttons: ['LP', 'MP', 'HP'], chordWindow: { size: 2, unit: 'frames' } });
  });

  it('removing down to one button drops the window; the last button stays', () => {
    const one = removeChordButton(combo([chordStep]), 0, 0);
    expect(one.steps[0]!.buttons).toEqual(['MP']);
    expect(one.steps[0]).not.toHaveProperty('chordWindow');
    expect(removeChordButton(one, 0, 0)).toBe(one);
  });

  it('sets one slot', () => {
    expect(setStepButton(combo([chordStep]), 0, 1, 'HK').steps[0]!.buttons).toEqual(['LP', 'HK']);
    const c = combo([chordStep]);
    expect(setStepButton(c, 0, 5, 'HK')).toBe(c);
  });

  it('picks the next free button', () => {
    expect(nextChordButton(chordStep, ['LP', 'MP', 'HP'])).toBe('HP');
    expect(nextChordButton(chordStep, ['LP', 'MP'])).toBeNull();
  });

  it('updates the window without sharing objects', () => {
    const win = { size: 25, unit: 'ms' as const };
    const c = updateStep(combo([chordStep]), 0, { chordWindow: win });
    expect(c.steps[0]!.chordWindow).toEqual(win);
    expect(c.steps[0]!.chordWindow).not.toBe(win);
  });

  it('Add step copies the buttons and the window, not the label', () => {
    const next = nextStep([chordStep]);
    expect(next).toEqual({ buttons: ['LP', 'MP'], targetFrame: 10, tolEarly: 1, tolLate: 1, chordWindow: { size: 2, unit: 'frames' } });
    expect(next.buttons).not.toBe(chordStep.buttons);
  });

  it('cloneCombo deep-copies buttons and windows', () => {
    const c = combo([chordStep]);
    const copy = cloneCombo(c);
    copy.steps[0]!.buttons.push('HP');
    copy.steps[0]!.chordWindow!.size = 9;
    expect(c.steps[0]).toEqual(chordStep);
  });

  it('combosEqual sees button order and window changes', () => {
    const c = combo([chordStep]);
    expect(combosEqual(c, cloneCombo(c))).toBe(true);
    expect(combosEqual(c, setStepButton(setStepButton(c, 0, 0, 'MP'), 0, 1, 'LP'))).toBe(false);
    expect(combosEqual(c, updateStep(c, 0, { chordWindow: { size: 3, unit: 'frames' } }))).toBe(false);
    expect(combosEqual(c, updateStep(c, 0, { chordWindow: { size: 2, unit: 'ms' } }))).toBe(false);
  });

  it('converts a window between units at the combo fps', () => {
    expect(convertChordWindow({ size: 2, unit: 'frames' }, 'ms', 60)).toEqual({ size: 33.3, unit: 'ms' });
    expect(convertChordWindow({ size: 33.3, unit: 'ms' }, 'frames', 60)).toEqual({ size: 2, unit: 'frames' });
    expect(convertChordWindow({ size: 5, unit: 'ms' }, 'frames', 60)).toEqual({ size: 0, unit: 'frames' });
    expect(convertChordWindow({ size: 2, unit: 'frames' }, 'frames', 60)).toEqual({ size: 2, unit: 'frames' });
    expect(convertChordWindow({ size: 2.4, unit: 'ms' }, 'frames', Number.NaN)).toEqual({ size: 2, unit: 'frames' });
  });
});

describe('saved combos with chords', () => {
  it('loads combos saved before chords (single `button` field)', () => {
    const old = { name: 'old', fps: 60, timingMode: 'relative', startMode: 'firstInput', steps: [{ button: 'LP', targetFrame: 0, tolEarly: 0, tolLate: 0 }] };
    expect(parseCombo(old)?.steps[0]).toEqual(single('LP'));
    const storage = memoryStorage();
    storage.setItem(COMBOS_KEY, JSON.stringify({ version: 1, combos: [{ id: 'a', combo: old }] }));
    expect(new ComboStore(storage, { examples: [] }).get('a')?.combo.steps[0]!.buttons).toEqual(['LP']);
  });

  it('saves and reloads a chord with its window', () => {
    const storage = memoryStorage();
    const store = new ComboStore(storage, { examples: [], makeId: () => 'x' });
    store.create(combo([single('HK'), chordStep]));
    expect(new ComboStore(storage, { examples: [] }).get('x')?.combo.steps[1]).toEqual(chordStep);
  });

  it('strips a window from a single-button step and rejects a chord without one', () => {
    const base = { name: 'n', fps: 60, timingMode: 'relative', startMode: 'firstInput' };
    const withWin = parseCombo({ ...base, steps: [{ ...single('LP'), chordWindow: { size: 2, unit: 'frames' } }] });
    expect(withWin?.steps[0]).not.toHaveProperty('chordWindow');
    expect(parseCombo({ ...base, steps: [{ ...single('LP'), buttons: ['LP', 'MP'] }] })).toBeNull();
    expect(parseCombo({ ...base, steps: [{ ...chordStep, chordWindow: { size: 2, unit: 'beats' } }] })).toBeNull();
    expect(parseCombo({ ...base, steps: [{ ...chordStep, buttons: ['LP', 3] }] })).toBeNull();
  });
});

describe('share links with chords', () => {
  it('round-trips chords in both units (v2)', () => {
    const { label: _label, ...unlabelled } = chordStep;
    const c: Combo = combo([single('HK'), chordStep, { ...unlabelled, chordWindow: { size: 12.5, unit: 'ms' } }]);
    const code = encodeCombo(c);
    expect(JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/'))).v).toBe(2);
    expect(decodeCombo(code)).toEqual(c);
  });

  it('still opens v1 links', () => {
    const v1 = { v: 1, n: 'old', f: 60, t: 'r', s: 'f', p: [['LP', 0, 0, 0, 'jab'], ['MP', 3, 1, 1]] };
    expect(decodeCombo(json(v1))?.steps).toEqual([{ ...single('LP'), label: 'jab' }, { ...single('MP', 3), tolEarly: 1, tolLate: 1 }]);
  });

  it('rejects bad v2 rows', () => {
    const ok = { v: 2, n: 'x', f: 60, t: 'r', s: 'f', p: [[['LP', 'MP'], 0, 0, 0, '', [2, 'f']]] };
    expect(decodeCombo(json(ok))).not.toBeNull();
    expect(decodeCombo(json({ ...ok, p: [['LP', 0, 0, 0]] }))).toBeNull(); // v2 needs a list
    expect(decodeCombo(json({ ...ok, p: [[['LP', 'MP'], 0, 0, 0]] }))).toBeNull(); // chord without a window
    expect(decodeCombo(json({ ...ok, p: [[['LP', 'MP'], 0, 0, 0, '', [2, 'x']]] }))).toBeNull();
    expect(decodeCombo(json({ ...ok, p: [[['LP', 'MP'], 0, 0, 0, '', [2]]] }))).toBeNull();
    expect(decodeCombo(json({ ...ok, p: [[['LP', 'UP'], 0, 0, 0, '', [2, 'f']]] }))).toBeNull(); // engine validation
  });
});
