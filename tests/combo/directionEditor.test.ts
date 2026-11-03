// Direction+button steps, session E: the editor's pure helpers, the shared notation, and the
// shipped examples.
import { describe, expect, it } from 'vitest';
import { addStep, combosEqual, newCombo, setDirectionMatch, setStepDirection } from '../../src/combo/edit';
import { EXAMPLE_COMBOS } from '../../src/combo/examples';
import { arm, attemptResult, createAttempt, press, release, tick, validateCombo } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { Combo, Step } from '../../src/engine/types';
import { directionMatchText, positionChoiceText, stepNotation, stepNotationParts } from '../../src/practice/format';

const step = (extra: Partial<Step> = {}): Step => ({ buttons: ['MP'], targetFrame: 0, tolEarly: 0, tolLate: 0, ...extra });
const combo = (steps: Step[]): Combo => ({ ...newCombo('c'), steps });

describe('setStepDirection', () => {
  it('makes a plain step an exact direction step (the default for new direction steps)', () => {
    const c = setStepDirection(combo([step()]), 0, 3);
    expect(c.steps[0]).toEqual(step({ direction: 3, directionMatch: 'exact' }));
  });

  it('turns a neutral-required plain step into an exact direction step', () => {
    const c = setStepDirection(combo([step({ directionMatch: 'exact' })]), 0, 6);
    expect(c.steps[0]).toEqual(step({ direction: 6, directionMatch: 'exact' }));
  });

  it('keeps the match when changing to another direction', () => {
    const c = setStepDirection(combo([step({ direction: 2, directionMatch: 'atLeast' })]), 0, 3);
    expect(c.steps[0]).toEqual(step({ direction: 3, directionMatch: 'atLeast' }));
  });

  it('clearing the direction makes a plain at-least step (the default for plain steps)', () => {
    const c = setStepDirection(combo([step({ direction: 2, directionMatch: 'exact' })]), 0, undefined);
    expect(c.steps[0]).toEqual(step());
    expect('direction' in c.steps[0]!).toBe(false);
    expect('directionMatch' in c.steps[0]!).toBe(false);
  });

  it('keeps chord fields and leaves the input untouched', () => {
    const chord = step({ buttons: ['LP', 'LK'], chordWindow: { size: 2, unit: 'frames' }, label: 'x' });
    const before = combo([chord]);
    const c = setStepDirection(before, 0, 4);
    expect(c.steps[0]).toEqual({ ...chord, direction: 4, directionMatch: 'exact' });
    expect(before.steps[0]).toEqual(chord);
    expect(validateCombo(c)).toEqual([]);
  });

  it('ignores an out-of-range index', () => {
    const c = combo([step()]);
    expect(setStepDirection(c, 3, 2)).toBe(c);
  });
});

describe('setDirectionMatch', () => {
  it('sets exact or at least on direction and plain steps', () => {
    const c = combo([step({ direction: 2, directionMatch: 'exact' }), step()]);
    expect(setDirectionMatch(c, 0, 'atLeast').steps[0]).toEqual(step({ direction: 2, directionMatch: 'atLeast' }));
    expect(setDirectionMatch(c, 1, 'exact').steps[1]).toEqual(step({ directionMatch: 'exact' }));
  });

  it('counts as a change for unsaved-changes checks, except at least vs missing', () => {
    const c = combo([step()]);
    expect(combosEqual(c, setDirectionMatch(c, 0, 'exact'))).toBe(false);
    expect(combosEqual(c, setDirectionMatch(c, 0, 'atLeast'))).toBe(true);
  });

  it('ignores an out-of-range index', () => {
    const c = combo([step()]);
    expect(setDirectionMatch(c, -1, 'exact')).toBe(c);
  });
});

describe('new steps', () => {
  it('a new combo starts with a plain at-least step', () => {
    const first = newCombo().steps[0]!;
    expect(first.direction).toBeUndefined();
    expect(first.directionMatch).toBeUndefined();
  });

  it('"Add step" copies the last step, direction and match included', () => {
    const c = addStep(combo([step({ direction: 3, directionMatch: 'exact', label: 'x' })]));
    expect(c.steps[1]).toEqual(step({ direction: 3, directionMatch: 'exact' }));
  });
});

describe('notation', () => {
  it('splits a step into direction (with its match), buttons and the neutral flag', () => {
    expect(stepNotationParts(step({ direction: 6, directionMatch: 'exact' }))).toEqual({
      direction: { arrow: '→', match: 'exact' },
      buttons: 'MP',
      neutral: false,
    });
    expect(stepNotationParts(step({ buttons: ['LP', 'LK'], direction: 2 }))).toEqual({
      direction: { arrow: '↓', match: 'atLeast' },
      buttons: 'LP+LK',
      neutral: false,
    });
    expect(stepNotationParts(step({ directionMatch: 'exact' }))).toEqual({ buttons: 'MP', neutral: true });
    expect(stepNotationParts(step())).toEqual({ buttons: 'MP', neutral: false });
  });

  it('reads the same as text for exact and at least (the page colors them)', () => {
    expect(stepNotation(step({ direction: 2, directionMatch: 'exact' }))).toBe('↓+MP');
    expect(stepNotation(step({ direction: 2, directionMatch: 'atLeast' }))).toBe('↓+MP');
  });

  it('names the editor choices and what each color means', () => {
    expect(positionChoiceText(3)).toBe('↘ down-right');
    expect(positionChoiceText(5)).toBe('• none');
    expect([1, 2, 4, 6, 7, 8, 9].map((p) => positionChoiceText(p as never))).toEqual([
      '↙ down-left',
      '↓ down',
      '← left',
      '→ right',
      '↖ up-left',
      '↑ up',
      '↗ up-right',
    ]);
    expect(directionMatchText('↓', 'exact')).toBe('exactly ↓');
    expect(directionMatchText('↓', 'atLeast')).toBe('at least ↓');
  });
});

describe('examples', () => {
  const byId = (id: string) => EXAMPLE_COMBOS.find((e) => e.id === id)!.combo;

  it('every "cr." step holds ↓ at least', () => {
    const crSteps = EXAMPLE_COMBOS.flatMap((e) => e.combo.steps).filter((s) => s.label?.startsWith('cr.'));
    expect(crSteps.length).toBeGreaterThan(0);
    for (const s of crSteps) {
      expect(s.direction).toBe(2);
      expect(s.directionMatch).toBe('atLeast');
    }
  });

  it('ships "Example: command normal" with ↓ at least, → exactly and neutral required', () => {
    const c = byId('example-command-normal');
    expect(c.name).toBe('Example: command normal');
    expect(c.steps.map(stepNotation)).toEqual(['↓+LP', '→+MP', 'HP (neutral)']);
    expect(c.steps.map((s) => s.directionMatch)).toEqual(['atLeast', 'exact', 'exact']);
    expect(validateCombo(c)).toEqual([]);
  });
});

describe('"Example: command normal" grades as intended', () => {
  const T0 = 1000;
  const at = (frame: number) => T0 + frameToMs(frame, 60) + 5;
  const run = (inputs: [edge: 'press' | 'release', button: string, timestamp: number][]) => {
    const c = EXAMPLE_COMBOS.find((e) => e.id === 'example-command-normal')!.combo;
    let st = arm(createAttempt(c, { ...DEFAULT_SETTINGS, strict: true }));
    for (const [edge, button, timestamp] of inputs) {
      const ev = { button, timestamp, source: 'keyboard' as const };
      st = edge === 'press' ? press(st, ev) : release(st, ev);
    }
    st = tick(st, at(60));
    return attemptResult(st)!;
  };

  it('↘+LP, →+MP, neutral HP is clean', () => {
    const r = run([
      ['press', 'DOWN', T0 - 50],
      ['press', 'RIGHT', T0 - 40],
      ['press', 'LP', at(0)],
      ['release', 'DOWN', at(5)],
      ['press', 'MP', at(10)],
      ['release', 'RIGHT', at(20)],
      ['press', 'HP', at(28)],
    ]);
    expect(r.results.map((x) => x.grade)).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME']);
    expect(r.success).toBe(true);
  });

  it('↘+MP on the command normal is a wrong direction; holding → on HP is too', () => {
    const r = run([
      ['press', 'DOWN', T0 - 50],
      ['press', 'LP', at(0)],
      ['press', 'RIGHT', at(5)],
      ['press', 'MP', at(10)],
      ['release', 'DOWN', at(12)],
      ['press', 'HP', at(28)],
    ]);
    expect(r.results.map((x) => [x.grade, x.directionMistake])).toEqual([
      ['ON_TIME', undefined],
      ['WRONG_BUTTON', 'wrong'],
      ['WRONG_BUTTON', 'wrong'],
    ]);
  });
});
