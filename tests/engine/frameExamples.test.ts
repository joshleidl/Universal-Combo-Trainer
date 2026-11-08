// The frame-based inputs proposal's worked examples F1–F12
// (docs/proposals/2026-11-08-frame-based-inputs-spec.md, section 2), as one table.
//
// Shared setup, as in the proposal: 60 fps, relative mode, strict unless noted, latency offset 0.
// Step 1 is MK, a first-input start pressed at T0 (frame 0) and let go on frame 1. Step 2 is the
// case's step, target frame 10, tolerance 1/1 (on time on frames 9–11). Step 3 is a plain HK.
// Frame 10 covers 166.7–183.3 ms after T0; frame 12 covers 200.0–216.7 ms.
//
// Feedback text for these cases is tested with the practice side (plan milestone M6).

import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, currentStepIndex, press, release, tick, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { AttemptEnd, ButtonId, Combo, Grade, InputSource, Step, StepReports } from '../../src/engine/types';
import { settle } from './settle';

const T0 = 1000;
const f = (frames: number) => frameToMs(frames, 60);

type Input = { edge: 'press' | 'release'; button: ButtonId; timestamp: number; source: InputSource };
const P = (button: ButtonId, ms: number, source: InputSource = 'keyboard'): Input => ({ edge: 'press', button, timestamp: T0 + ms, source });
const R = (button: ButtonId, ms: number, source: InputSource = 'keyboard'): Input => ({ edge: 'release', button, timestamp: T0 + ms, source });
const feed = (state: AttemptState, inputs: Input[]) =>
  inputs.reduce((st, { edge, ...ev }) => (edge === 'press' ? press(st, ev) : release(st, ev)), state);

const step = (buttons: ButtonId[], over: Partial<Step> = {}): Step => ({
  buttons,
  targetFrame: 10,
  tolEarly: 1,
  tolLate: 1,
  ...over,
});
const START = step(['MK'], { targetFrame: 0, tolEarly: 0, tolLate: 0 });
const TAIL = step(['HK'], { targetFrame: 20, tolEarly: 5, tolLate: 5 });
const combo = (steps: Step[]): Combo => ({ name: 'F cases', steps, fps: 60, timingMode: 'relative', startMode: 'firstInput' });

const RIGHT_MP = step(['MP'], { direction: 6, directionMatch: 'exact' });
const LP_LK_5MS = step(['LP', 'LK'], { chordWindow: { size: 5, unit: 'ms' } });

interface Case {
  name: string;
  /** Step 2 (steps 1 and 3 are MK and HK), or every step when `steps` is given. */
  step?: Step;
  steps?: Step[];
  strict?: boolean;
  /** Controls held when the attempt arms. */
  held?: ButtonId[];
  /** Inputs after MK at T0 (and its release on frame 1), in ms after T0. */
  inputs: Input[];
  /** Graded: the step-2 result, known when frame `frame` closes. */
  graded?: { frame: number; grade: Grade; inputFrame: number; deltaMs?: number; reports?: StepReports; endedBy?: AttemptEnd };
  /** Not graded: step 2 keeps waiting, with these presses ignored. */
  waiting?: { ignored: ButtonId[] };
}

const cases: Case[] = [
  { name: 'F1 MP at 170 ms: on time, known when frame 10 closes', step: step(['MP']), inputs: [P('MP', 170)], graded: { frame: 10, grade: 'ON_TIME', inputFrame: 10, deltaMs: 3.33 } },
  {
    name: 'F2 MP awaited, LP and MP in one pad poll, LP first',
    step: step(['MP']),
    inputs: [P('LP', 170, 'gamepad'), P('MP', 170, 'gamepad')],
    graded: { frame: 10, grade: 'WRONG_BUTTON', inputFrame: 10, endedBy: 'wrongButton' },
  },
  {
    name: 'F2 MP awaited, LP and MP in one pad poll, MP first',
    step: step(['MP']),
    inputs: [P('MP', 170, 'gamepad'), P('LP', 170, 'gamepad')],
    graded: { frame: 10, grade: 'WRONG_BUTTON', inputFrame: 10, endedBy: 'wrongButton' },
  },
  { name: 'F2n as F2, non-strict: both presses ignored, step keeps waiting', step: step(['MP']), strict: false, inputs: [P('LP', 170, 'gamepad'), P('MP', 170, 'gamepad')], waiting: { ignored: ['LP', 'MP'] } },
  { name: 'F3 LP tapped inside frame 10 registers', step: step(['LP']), inputs: [P('LP', 171), R('LP', 178)], graded: { frame: 10, grade: 'ON_TIME', inputFrame: 10, deltaMs: 4.33 } },
  {
    name: 'F5 LP double tap on frame 10: one press, ms from 179',
    step: step(['LP']),
    inputs: [P('LP', 170), R('LP', 174), P('LP', 179)],
    graded: { frame: 10, grade: 'ON_TIME', inputFrame: 10, deltaMs: 12.33 },
  },
  {
    name: 'F6 →+MP exact, → tapped around MP: missing, with an ignored tap',
    step: RIGHT_MP,
    inputs: [P('RIGHT', 168), P('MP', 171), R('RIGHT', 175)],
    graded: { frame: 10, grade: 'PARTIAL', inputFrame: 10, reports: { directionTaps: ['RIGHT'] } },
  },
  {
    name: 'F7 →+MP exact, ← and → held: neutral (SOCD), with opposite directions',
    step: RIGHT_MP,
    held: ['LEFT', 'RIGHT'],
    inputs: [P('MP', 170)],
    graded: { frame: 10, grade: 'PARTIAL', inputFrame: 10, reports: { opposites: ['LEFT_RIGHT'] } },
  },
  { name: 'F8 →+MP, MP at 170, → at 173: → held at the end of 10', step: RIGHT_MP, inputs: [P('MP', 170), P('RIGHT', 173)], graded: { frame: 10, grade: 'ON_TIME', inputFrame: 10 } },
  {
    name: 'F9 LP+LK, 5 ms window, 13 ms apart on frame 10: complete (same frame always fits)',
    step: LP_LK_5MS,
    inputs: [P('LP', 168), P('LK', 181)],
    graded: { frame: 10, grade: 'ON_TIME', inputFrame: 10 },
  },
  {
    name: 'F10 LP+LK, 5 ms window, 6 ms apart on frames 10 and 11: partial',
    step: LP_LK_5MS,
    inputs: [P('LP', 180), P('LK', 186)],
    graded: { frame: 11, grade: 'PARTIAL', inputFrame: 10, endedBy: 'partial' },
  },
  {
    name: 'F11 step 2 MP, step 3 HP at relative target 0: HP is a stray on MP’s frame',
    steps: [START, step(['MP']), step(['HP'], { targetFrame: 0, tolEarly: 0, tolLate: 0 })],
    inputs: [P('MP', 170), P('HP', 174)],
    graded: { frame: 10, grade: 'WRONG_BUTTON', inputFrame: 10, endedBy: 'wrongButton' },
  },
  { name: 'F12 MP at 205 ms (frame 12): late, +38.3 ms', step: step(['MP']), inputs: [P('MP', 205)], graded: { frame: 12, grade: 'LATE', inputFrame: 12, deltaMs: 38.33 } },
];

function begin(c: Case): AttemptState {
  const steps = c.steps ?? [START, c.step as Step, TAIL];
  const st = arm(createAttempt(combo(steps), { ...DEFAULT_SETTINGS, strict: c.strict ?? true }), c.held ?? []);
  return feed(st, [P('MK', 0), R('MK', f(1) + 5), ...c.inputs]);
}

describe('frame-based inputs: worked examples F1–F12 (proposal section 2)', () => {
  it.each(cases)('$name', (c) => {
    const st = begin(c);
    if (c.graded) {
      const g = c.graded;
      // Not known while its frame is open; known the moment it closes.
      expect(tick(st, T0 + f(g.frame + 1) - 0.01).results).toHaveLength(1);
      const after = tick(st, T0 + f(g.frame + 1));
      const r = after.results[1];
      expect(r).toMatchObject({ stepIndex: 1, grade: g.grade, inputFrame: g.inputFrame, deltaFrames: g.inputFrame - 10 });
      if (g.deltaMs !== undefined) expect(r?.deltaMs).toBeCloseTo(g.deltaMs, 2);
      expect(r?.reports).toEqual(g.reports);
      if (g.endedBy) expect(after.endedBy).toBe(g.endedBy);
      else expect(after.phase).toBe('running');
    }
    if (c.waiting) {
      const after = tick(st, T0 + f(13));
      expect(after.phase).toBe('running');
      expect(currentStepIndex(after)).toBe(1);
      expect(after.results).toHaveLength(1);
      expect(after.ignoredPresses.map((e) => e.button)).toEqual(c.waiting.ignored);
    }
  });

  it('F2: the stray named in the result is LP, in either arrival order', () => {
    for (const order of [['LP', 'MP'], ['MP', 'LP']]) {
      const st = settle(begin({ name: '', step: step(['MP']), inputs: order.map((b) => P(b, 170, 'gamepad')) }));
      expect(st.results[1]?.press?.button).toBe('LP');
    }
  });

  it('F4: LP held from step 1, released and pressed again on frame 10: no press, a lost re-press reported on step 2', () => {
    const c = combo([step(['LP'], { targetFrame: 0, tolEarly: 0, tolLate: 0 }), step(['LP']), TAIL]);
    let st = feed(arm(createAttempt(c)), [P('LP', 0), R('LP', 170), P('LP', 176)]);
    st = tick(st, T0 + f(11));
    // LP was held at the end of frame 9, so frame 10 has no press: step 2 keeps waiting.
    expect(st.phase).toBe('running');
    expect(st.results).toHaveLength(1);
    // Released on 11 and pressed on 12 (late), step 2 is graded and carries the report.
    st = settle(feed(st, [R('LP', f(11) + 5), P('LP', f(12) + 5)]));
    expect(st.results[1]).toMatchObject({ grade: 'LATE', inputFrame: 12 });
    expect(st.results[1]?.reports).toEqual({ lostRepresses: [{ button: 'LP', frame: 10, timestamp: T0 + 176 }] });
  });
});

describe('reports: edge cases', () => {
  it('a passing check reports no taps or opposites', () => {
    // ↓+MP at least: ↓ held, → tapped on the graded frame; the check passes.
    const s = step(['MP'], { direction: 2 });
    const st = settle(begin({ name: '', step: s, held: ['DOWN'], inputs: [P('RIGHT', 168), P('MP', 170), R('RIGHT', 175)] }));
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', direction: { held: 2 } });
    expect(st.results[1]?.reports).toBeUndefined();
  });

  it('only wanted directions count as ignored taps', () => {
    // ↓ tapped on the graded frame of a →+MP step: the check fails, but ↓ isn't a wanted direction.
    const st = settle(begin({ name: '', step: RIGHT_MP, inputs: [P('DOWN', 168), P('MP', 170), R('DOWN', 175)] }));
    expect(st.results[1]).toMatchObject({ grade: 'PARTIAL', directionMistake: 'missing' });
    expect(st.results[1]?.reports).toBeUndefined();
  });

  it('opposite directions held on a failed check are reported with the taps', () => {
    const st = settle(begin({ name: '', step: RIGHT_MP, held: ['UP', 'DOWN'], inputs: [P('RIGHT', 168), P('MP', 170), R('RIGHT', 175)] }));
    expect(st.results[1]?.reports).toEqual({ directionTaps: ['RIGHT'], opposites: ['UP_DOWN'] });
  });

  it('a lost re-press is reported on a MISSED step too', () => {
    const c = combo([step(['LP'], { targetFrame: 0, tolEarly: 0, tolLate: 0 }), step(['MP'], { tolLate: 0 }), TAIL]);
    const missed = tick(feed(arm(createAttempt(c, { ...DEFAULT_SETTINGS, timeoutFrames: 0 })), [P('LP', 0), R('LP', 100), P('LP', 104)]), T0 + f(20));
    expect(missed.results[1]).toMatchObject({ grade: 'MISSED', reports: { lostRepresses: [{ button: 'LP', frame: 6 }] } });
  });

  it('lost re-presses on several frames all go on the awaited step’s result', () => {
    const c = combo([step(['LP'], { targetFrame: 0, tolEarly: 0, tolLate: 0 }), step(['MP']), TAIL]);
    let st = feed(arm(createAttempt(c)), [P('LP', 0), R('LP', 50), P('LP', 52), R('LP', 100), P('LP', 104)]);
    st = settle(feed(st, [P('MP', 170)]));
    expect(st.results[1]?.reports?.lostRepresses?.map((x) => x.frame)).toEqual([3, 6]);
  });

  it('nothing is reported when no step is awaited (after the attempt ends)', () => {
    const c = combo([START, step(['MP'])]);
    const st = settle(feed(arm(createAttempt(c)), [P('MK', 0), P('MP', 170)]));
    expect(st.phase).toBe('done');
    const after = settle(feed(st, [R('MP', 200), P('MP', 202)]));
    expect(attemptResult(after)?.results.every((r) => r.reports === undefined)).toBe(true);
  });
});
