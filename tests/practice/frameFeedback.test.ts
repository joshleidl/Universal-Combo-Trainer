// Feedback text for frame-based inputs (SPEC §7, "Timing text" and "Frame notes"; plan M6).

import { describe, expect, it } from 'vitest';
import { arm, createAttempt, press, release, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { ButtonId, Combo, Step, StepResult } from '../../src/engine/types';
import { describeStep, directionNote, signedFrameFraction } from '../../src/practice/format';
import { settle } from '../engine/settle';

const tol = { tolEarly: 1, tolLate: 1 };
const MISSED: StepResult = { stepIndex: 1, expected: ['MP'], grade: 'MISSED' };
const result = (over: Partial<StepResult>): StepResult => ({
  stepIndex: 1,
  expected: ['MP'],
  grade: 'ON_TIME',
  press: { button: 'MP', timestamp: 0, source: 'keyboard' },
  deltaFrames: 0,
  deltaMs: 0,
  ...over,
});

describe('frame fraction', () => {
  it('is deltaMs / frameMs, one decimal, with the sign of the ms', () => {
    expect(signedFrameFraction(38.3, 60)).toBe('+2.3f');
    expect(signedFrameFraction(-31.4, 60)).toBe('−1.9f');
    expect(signedFrameFraction(3.3, 60)).toBe('+0.2f');
    expect(signedFrameFraction(0, 60)).toBe('+0.0f');
    expect(signedFrameFraction(-0.02, 60)).toBe('+0.0f'); // the ms reads +0.0 too
    expect(signedFrameFraction(-0.3, 60)).toBe('−0.0f');
    expect(signedFrameFraction(38.3, 30)).toBe('+1.1f');
  });
});

describe('timing text (SPEC §7)', () => {
  const text = (over: Partial<StepResult>) => describeStep(result(over), false, tol, 60);

  it('writes every example from SPEC §7', () => {
    expect(text({ deltaMs: 3.3 })).toBe('On time (+3.3 ms, +0.2f)');
    expect(text({ deltaFrames: 1, deltaMs: 20.1 })).toBe('On time, 1f late (+20.1 ms, +1.2f)');
    expect(text({ grade: 'EARLY', deltaFrames: -2, deltaMs: -31.4 })).toBe('2f early (−31.4 ms, −1.9f)');
    // F12: frames count from the target (user's call, M6).
    expect(text({ grade: 'LATE', deltaFrames: 2, deltaMs: 38.3 })).toBe('2f late (+38.3 ms, +2.3f)');
  });

  it('adds the fraction wherever the ms is shown, including a wrong button', () => {
    expect(text({ grade: 'WRONG_BUTTON', press: { button: 'LP', timestamp: 0, source: 'keyboard' }, deltaMs: 3.3 })).toBe(
      'Wrong button: LP at 0f (+3.3 ms, +0.2f)',
    );
  });

  it('leaves out the fraction without the fps, and on texts with no ms', () => {
    expect(describeStep(result({ deltaMs: 3.3 }), false, tol)).toBe('On time (+3.3 ms)');
    expect(describeStep(result({}), true, tol, 60)).toBe('Start');
    expect(describeStep(MISSED, false, tol, 60)).toBe('Missed');
  });
});

describe('frame notes (SPEC §7)', () => {
  const RIGHT = { wanted: 6 as const, held: 5 as const, match: 'exact' as const };

  it('ignored direction tap', () => {
    const r = result({ grade: 'PARTIAL', deltaMs: 4.3, direction: RIGHT, directionMistake: 'missing', reports: { directionTaps: ['RIGHT'] } });
    expect(describeStep(r, false, tol, 60)).toBe('On time (+4.3 ms, +0.3f) · Direction: none, wanted → · → tapped, not held at end of frame');
  });

  it('opposite directions go inside the direction note', () => {
    expect(directionNote(RIGHT, ['LEFT_RIGHT'])).toBe('Direction: none, wanted → (← and → both held)');
    expect(directionNote(RIGHT, ['LEFT_RIGHT', 'UP_DOWN'])).toBe('Direction: none, wanted → (← and → both held, ↑ and ↓ both held)');
    const r = result({ grade: 'PARTIAL', deltaMs: 3.3, direction: RIGHT, directionMistake: 'missing', reports: { opposites: ['LEFT_RIGHT'] } });
    expect(describeStep(r, false, tol, 60)).toBe('On time (+3.3 ms, +0.2f) · Direction: none, wanted → (← and → both held)');
  });

  it('lost re-press, on any result, once per button', () => {
    const lost = { lostRepresses: [{ button: 'LP', frame: 10, timestamp: 0 }, { button: 'LP', frame: 11, timestamp: 0 }] };
    expect(describeStep(result({ grade: 'LATE', deltaFrames: 2, deltaMs: 38.3, reports: lost }), false, tol, 60)).toBe(
      '2f late (+38.3 ms, +2.3f) · LP pressed again while held (not counted)',
    );
    expect(describeStep({ ...MISSED, reports: lost }, false, tol, 60)).toBe(
      'Missed · LP pressed again while held (not counted)',
    );
  });

  it('a start step keeps "Start" and still gets its notes', () => {
    const lost = { lostRepresses: [{ button: 'MK', frame: 0, timestamp: 0 }] };
    expect(describeStep(result({ stepIndex: 0, reports: lost }), true, tol, 60)).toBe('Start · MK pressed again while held (not counted)');
  });
});

describe('worked examples through the engine (F6, F7, F12)', () => {
  const T0 = 1000;
  const step = (over: Partial<Step> = {}): Step => ({ buttons: ['MP'], targetFrame: 10, tolEarly: 1, tolLate: 1, ...over });
  const run = (s: Step, held: ButtonId[], inputs: [boolean, ButtonId, number][]): StepResult => {
    const c: Combo = {
      name: 'F',
      steps: [{ buttons: ['MK'], targetFrame: 0, tolEarly: 0, tolLate: 0 }, s],
      fps: 60,
      timingMode: 'relative',
      startMode: 'firstInput',
    };
    let st: AttemptState = press(arm(createAttempt(c, DEFAULT_SETTINGS), held), { button: 'MK', timestamp: T0, source: 'keyboard' });
    for (const [down, button, ms] of inputs) {
      const ev = { button, timestamp: T0 + ms, source: 'keyboard' as const };
      st = down ? press(st, ev) : release(st, ev);
    }
    return settle(st).results[1] as StepResult;
  };
  const RIGHT_MP = step({ direction: 6, directionMatch: 'exact' });

  it('F6', () => {
    const r = run(RIGHT_MP, [], [[true, 'RIGHT', 168], [true, 'MP', 171], [false, 'RIGHT', 175]]);
    expect(describeStep(r, false, RIGHT_MP, 60)).toBe('On time (+4.3 ms, +0.3f) · Direction: none, wanted → · → tapped, not held at end of frame');
  });

  it('F7', () => {
    const r = run(RIGHT_MP, ['LEFT', 'RIGHT'], [[true, 'MP', 170]]);
    expect(describeStep(r, false, RIGHT_MP, 60)).toBe('On time (+3.3 ms, +0.2f) · Direction: none, wanted → (← and → both held)');
  });

  it('F12', () => {
    const r = run(step(), [], [[true, 'MP', 205]]);
    expect(describeStep(r, false, step(), 60)).toBe('2f late (+38.3 ms, +2.3f)');
  });

  it('F1', () => {
    expect(frameToMs(10, 60)).toBeCloseTo(166.67, 2);
    const r = run(step(), [], [[true, 'MP', 170]]);
    expect(describeStep(r, false, step(), 60)).toBe('On time (+3.3 ms, +0.2f)');
  });
});
