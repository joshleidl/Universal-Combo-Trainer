// The direction+button proposal's worked examples (docs/proposals/2026-11-02-dir-plus-button-inputs-spec.md,
// section 2), except the position-step cases L1, L1e and L2, which are out of scope.
//
// Shared setup, as in the proposal: 60 fps, relative mode, the previous step landed on frame 0.
// Step 1 is LK (first-input start, pressed at T0 = frame 0); step 2 is the case's step, target
// frame 10, on time on frames 9–11; step 3 is a plain HK so "the attempt continues" can be seen.

import { describe, expect, it } from 'vitest';
import {
  arm,
  attemptResult,
  createAttempt,
  currentStepIndex,
  press,
  release,
  start,
  tick,
  type AttemptState,
} from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import { settle } from './settle';
import type { ButtonId, Combo, Grade, HeldPosition, InputSource, Settings, Step } from '../../src/engine/types';

const T0 = 1000;
/** ms timestamp `ms` into grid frame `frame` (frame 0 = T0), at 60 fps. Default: 5 ms in. */
const at = (frame: number, ms = 5) => T0 + frameToMs(frame, 60) + ms;

type Input = { edge: 'press' | 'release'; button: ButtonId; timestamp: number; source: InputSource };
const P = (button: ButtonId, timestamp: number, source: InputSource = 'keyboard'): Input => ({ edge: 'press', button, timestamp, source });
const R = (button: ButtonId, timestamp: number, source: InputSource = 'keyboard'): Input => ({ edge: 'release', button, timestamp, source });

const feed = (state: AttemptState, inputs: Input[]) =>
  inputs.reduce((st, { edge, ...ev }) => (edge === 'press' ? press(st, ev) : release(st, ev)), state);

const step = (buttons: ButtonId[], over: Partial<Step> = {}): Step => ({
  buttons,
  targetFrame: 10,
  tolEarly: 1,
  tolLate: 1,
  ...(buttons.length > 1 ? { chordWindow: { size: 2, unit: 'frames' as const } } : {}),
  ...over,
});

const combo = (steps: Step[], over: Partial<Combo> = {}): Combo => ({
  name: 'worked examples',
  steps,
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  ...over,
});

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

const RIGHT_MP = step(['MP'], { direction: 6, directionMatch: 'exact' });

interface Case {
  name: string;
  step: Step;
  /** Directions held when the attempt arms (from before the previous step). */
  held?: ButtonId[];
  /** Inputs after the step-1 press at T0. */
  inputs: Input[];
  grade: Grade;
  /** The check's held position, or null when no check ran. */
  checkedHeld: HeldPosition | null;
  mistake?: 'missing' | 'wrong';
  /** Per-press timing of a chord step. */
  pressTimings?: string[];
}

const cases: Case[] = [
  { name: 'H1 → held since before the previous step', step: RIGHT_MP, held: ['RIGHT'], inputs: [P('MP', at(10))], grade: 'ON_TIME', checkedHeld: 6 },
  { name: 'H2 → pressed on 8, still held', step: RIGHT_MP, inputs: [P('RIGHT', at(8)), P('MP', at(10))], grade: 'ON_TIME', checkedHeld: 6 },
  {
    name: 'H3 → pressed on 5, released on 7',
    step: RIGHT_MP,
    inputs: [P('RIGHT', at(5)), R('RIGHT', at(7)), P('MP', at(10))],
    grade: 'PARTIAL',
    checkedHeld: 5,
    mistake: 'missing',
  },
  { name: 'H4 MP on 10, → on 11', step: RIGHT_MP, inputs: [P('MP', at(10)), P('RIGHT', at(11))], grade: 'PARTIAL', checkedHeld: 5, mistake: 'missing' },
  { name: 'O1 MP at 170 ms, → at 173 ms', step: RIGHT_MP, inputs: [P('MP', T0 + 170), P('RIGHT', T0 + 173)], grade: 'ON_TIME', checkedHeld: 6 },
  {
    name: 'O2 MP and → in one pad poll, MP first',
    step: RIGHT_MP,
    inputs: [P('MP', at(10), 'gamepad'), P('RIGHT', at(10), 'gamepad')],
    grade: 'ON_TIME',
    checkedHeld: 6,
  },
  {
    name: 'O4 → released at 168 ms, MP at 171 ms',
    step: RIGHT_MP,
    held: ['RIGHT'],
    inputs: [R('RIGHT', T0 + 168), P('MP', T0 + 171)],
    grade: 'PARTIAL',
    checkedHeld: 5,
    mistake: 'missing',
  },
  { name: 'M2 ← held', step: RIGHT_MP, held: ['LEFT'], inputs: [P('MP', at(10))], grade: 'WRONG_BUTTON', checkedHeld: 4, mistake: 'wrong' },
  { name: 'M3 ↘ held, exact', step: RIGHT_MP, held: ['DOWN', 'RIGHT'], inputs: [P('MP', at(10))], grade: 'WRONG_BUTTON', checkedHeld: 3, mistake: 'wrong' },
  {
    name: 'M3a ↘ held, at least',
    step: step(['MP'], { direction: 6, directionMatch: 'atLeast' }),
    held: ['DOWN', 'RIGHT'],
    inputs: [P('MP', at(10))],
    grade: 'ON_TIME',
    checkedHeld: 3,
  },
  {
    name: 'X1 ↓+MK at least, ↙ held',
    step: step(['MK'], { direction: 2, directionMatch: 'atLeast' }),
    held: ['DOWN', 'LEFT'],
    inputs: [P('MK', at(10))],
    grade: 'ON_TIME',
    checkedHeld: 1,
  },
  {
    name: 'X2 ↘+HP exact, ↓ held',
    step: step(['HP'], { direction: 3, directionMatch: 'exact' }),
    held: ['DOWN'],
    inputs: [P('HP', at(10))],
    grade: 'PARTIAL',
    checkedHeld: 2,
    mistake: 'missing',
  },
  {
    name: 'M4 HP exact (neutral), ↓ held',
    step: step(['HP'], { directionMatch: 'exact' }),
    held: ['DOWN'],
    inputs: [P('HP', at(10))],
    grade: 'WRONG_BUTTON',
    checkedHeld: 2,
    mistake: 'wrong',
  },
  { name: 'M5 HP at least, ↓ held', step: step(['HP']), held: ['DOWN'], inputs: [P('HP', at(10))], grade: 'ON_TIME', checkedHeld: null },
  {
    name: 'S1 → then ← added on 9 (SOCD neutral)',
    step: RIGHT_MP,
    held: ['RIGHT'],
    inputs: [P('LEFT', at(9)), P('MP', at(10))],
    grade: 'PARTIAL',
    checkedHeld: 5,
    mistake: 'missing',
  },
  {
    name: 'C1 ←+LP+LK, ← held, LP on 10, LK on 11',
    step: step(['LP', 'LK'], { direction: 4, directionMatch: 'exact' }),
    held: ['LEFT'],
    inputs: [P('LP', at(10)), P('LK', at(11))],
    grade: 'ON_TIME',
    checkedHeld: 4,
    pressTimings: ['ON_TIME', 'ON_TIME'],
  },
  {
    name: 'C2 ← released during 11',
    step: step(['LP', 'LK'], { direction: 4, directionMatch: 'exact' }),
    held: ['LEFT'],
    inputs: [P('LP', at(10)), P('LK', at(11)), R('LEFT', at(11, 9))],
    grade: 'PARTIAL',
    checkedHeld: 5,
    mistake: 'missing',
    pressTimings: ['ON_TIME', 'ON_TIME'],
  },
  {
    name: 'C3 ← pressed on 12',
    step: step(['LP', 'LK'], { direction: 4, directionMatch: 'exact' }),
    inputs: [P('LP', at(10)), P('LK', at(11)), P('LEFT', at(12))],
    grade: 'PARTIAL',
    checkedHeld: 5,
    mistake: 'missing',
    pressTimings: ['ON_TIME', 'ON_TIME'],
  },
];

describe('worked examples (proposal section 2)', () => {
  it.each(cases)('$name', (c) => {
    const c3 = combo([step(['LK'], { targetFrame: 0, tolEarly: 0, tolLate: 0 }), c.step, step(['HK'], { targetFrame: 20, tolEarly: 5, tolLate: 5 })]);
    let st = arm(createAttempt(c3), c.held ?? []);
    // LK (step 1) is let go on frame 1, so a chord with LK can press it again.
    st = feed(st, [P('LK', T0), R('LK', at(1)), ...c.inputs]);
    st = tick(st, at(14)); // past the end of every case's checked frame

    const r = st.results[1];
    expect(r?.grade).toBe(c.grade);
    // Timing is kept, even when the grade is replaced. A chord is graded on its last press (LK on 11).
    expect(r?.inputFrame).toBe(c.step.buttons.length > 1 ? 11 : 10);
    if (c.checkedHeld === null) expect(r?.direction).toBeUndefined();
    else expect(r?.direction?.held).toBe(c.checkedHeld);
    expect(r?.directionMistake).toBe(c.mistake);
    if (c.pressTimings) expect(r?.presses?.map((x) => x.timing)).toEqual(c.pressTimings);
    // Direction mistakes never end the attempt.
    expect(st.phase).toBe('running');
    expect(currentStepIndex(st)).toBe(2);
    expect(st.ignoredPresses).toEqual([]);
  });

  it('C4 ←+LP+LK, LP on 10, HP on 11: the chord mistake wins and strict ends the attempt', () => {
    const c = combo([step(['LK'], { targetFrame: 0 }), step(['LP', 'LK'], { direction: 4, directionMatch: 'exact' }), step(['HK'])]);
    const st = settle(feed(arm(createAttempt(c), ['LEFT']), [P('LK', T0), R('LK', at(1)), P('LP', at(10)), P('HP', at(11))]));
    expect(st.phase).toBe('done');
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[1]?.grade).toBe('WRONG_BUTTON');
    expect(st.results[1]?.direction).toBeUndefined();
  });

  it('D1 a stray direction while step 1 ↓+MK is awaited is not a mistake', () => {
    const c = combo([step(['MK'], { targetFrame: 0, direction: 2, directionMatch: 'atLeast' }), step(['HK'])]);
    let st = arm(createAttempt(c));
    st = feed(st, [P('DOWN', T0 - 50), P('RIGHT', T0 - 30)]); // the lever rolls ↓ → ↘
    expect(st.phase).toBe('armed');
    expect(st.results).toEqual([]);
    expect(st.ignoredPresses).toEqual([]);
    st = tick(feed(st, [P('MK', T0)]), at(1));
    expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', direction: { wanted: 2, held: 3, match: 'atLeast' } });
  });

  describe('K: countdown start, step 1 ↓+MK, target 0', () => {
    const c = combo([step(['MK'], { targetFrame: 0, tolEarly: 0, tolLate: 0, direction: 2, directionMatch: 'exact' }), step(['HK'])], {
      startMode: 'countdown',
    });

    it('K1 ↓ held from before the restart', () => {
      let st = start(arm(createAttempt(c), ['DOWN']), T0);
      st = tick(press(st, { button: 'MK', timestamp: at(0), source: 'keyboard' }), at(1));
      expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', inputFrame: 0, direction: { held: 2 } });
    });

    it('K2 ↓ pressed during the countdown', () => {
      let st = arm(createAttempt(c));
      st = press(st, { button: 'DOWN', timestamp: T0 - 1500, source: 'keyboard' }); // before start()
      st = start(st, T0);
      st = tick(press(st, { button: 'MK', timestamp: at(0), source: 'keyboard' }), at(1));
      expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', inputFrame: 0, direction: { held: 2 } });
    });
  });

  describe('F: step 2 →+MP, step 3 HP with relative target 0; MP at 170 ms, HP at 178 ms', () => {
    const c = combo([step(['LK'], { targetFrame: 0 }), RIGHT_MP, step(['HP'], { targetFrame: 0, tolEarly: 0, tolLate: 0 })]);
    const inputs = [P('LK', T0), P('MP', T0 + 170), P('HP', T0 + 178)];

    it('F1 strict: step 2 is WRONG_BUTTON (extra press) and the attempt ends', () => {
      const st = settle(feed(arm(createAttempt(c), ['RIGHT']), inputs));
      expect(st.phase).toBe('done');
      expect(st.endedBy).toBe('wrongButton');
      expect(st.results).toHaveLength(2);
      expect(st.results[1]).toMatchObject({ stepIndex: 1, grade: 'WRONG_BUTTON', press: { button: 'HP' } });
      expect(st.results[1]?.direction).toBeUndefined();
    });

    it('F2 non-strict: MP and HP are ignored and step 2 keeps waiting', () => {
      // MP is let go on frame 10 too, so it can be pressed again on 11.
      let st = settle(feed(arm(createAttempt(c, settings({ strict: false })), ['RIGHT']), [...inputs, R('MP', T0 + 181)]));
      expect(st.phase).toBe('running');
      expect(currentStepIndex(st)).toBe(1);
      expect(st.results).toHaveLength(1);
      expect(st.ignoredPresses.map((e) => [e.button, e.timestamp])).toEqual([
        ['MP', T0 + 170],
        ['HP', T0 + 178],
      ]);
      // Step 2 is still awaited: MP on 11 grades it.
      st = tick(feed(st, [P('MP', at(11))]), at(12));
      expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', inputFrame: 11 });
    });
  });

  it('result of a finished case: a direction mistake on the last step completes the attempt, not a success', () => {
    const c = combo([step(['LK'], { targetFrame: 0 }), RIGHT_MP]);
    const st = tick(feed(arm(createAttempt(c), ['LEFT']), [P('LK', T0), P('MP', at(10))]), at(11));
    const result = attemptResult(st);
    expect(result?.endedBy).toBe('completed');
    expect(result?.success).toBe(false);
    expect(result?.results[1]?.grade).toBe('WRONG_BUTTON');
  });
});
