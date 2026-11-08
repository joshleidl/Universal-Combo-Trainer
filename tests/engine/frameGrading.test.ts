// Grading one closed frame at a time (SPEC §3 "Frames", "Grading", "First-input start"), for
// single-button steps (plan milestone M3). The full F1–F12 table, with reports, is in M5.
//
// Setup as in the proposal's worked examples: 60 fps, relative mode, strict unless noted. Step 1
// is LK, a first-input start pressed at T0 (frame 0). Step 2 targets frame 10 with tolerance 1/1,
// so on time is frames 9–11. Frame 10 covers 166.7–183.3 ms after T0.

import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, currentStepIndex, press, release, start, tick, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { ButtonId, Combo, InputSource, Settings, Step } from '../../src/engine/types';
import { settle } from './settle';

const T0 = 1000;
const at = (frame: number, ms = 5) => T0 + frameToMs(frame, 60) + ms;

type Input = { edge: 'press' | 'release'; button: ButtonId; timestamp: number; source: InputSource };
const P = (button: ButtonId, timestamp: number, source: InputSource = 'keyboard'): Input => ({ edge: 'press', button, timestamp, source });
const R = (button: ButtonId, timestamp: number, source: InputSource = 'keyboard'): Input => ({ edge: 'release', button, timestamp, source });
const feed = (state: AttemptState, inputs: Input[]) =>
  inputs.reduce((st, { edge, ...ev }) => (edge === 'press' ? press(st, ev) : release(st, ev)), state);

const step = (button: ButtonId, over: Partial<Step> = {}): Step => ({ buttons: [button], targetFrame: 10, tolEarly: 1, tolLate: 1, ...over });
const combo = (steps: Step[], over: Partial<Combo> = {}): Combo => ({
  name: 'frame grading',
  steps,
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  ...over,
});
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const START = step('LK', { targetFrame: 0, tolEarly: 0, tolLate: 0 });
const TAIL = step('HK', { targetFrame: 20, tolEarly: 5, tolLate: 5 });

/** LK at T0 (step 1), then `inputs`, with step 2 = `s`, step 3 = HK. */
function run(s: Step, inputs: Input[], opts: { strict?: boolean; held?: ButtonId[] } = {}): AttemptState {
  const c = combo([START, s, TAIL]);
  const st = arm(createAttempt(c, settings({ strict: opts.strict ?? true })), opts.held ?? []);
  return feed(st, [P('LK', T0), R('LK', at(1)), ...inputs]);
}

describe('results arrive when the frame closes', () => {
  it('F1: MP at 170 ms is ON_TIME, known when frame 10 closes at 183.3 ms', () => {
    let st = run(step('MP'), [P('MP', T0 + 170)]);
    expect(st.results).toHaveLength(1);
    st = tick(st, T0 + 183.3);
    expect(st.results).toHaveLength(1);
    st = tick(st, T0 + 183.4);
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', inputFrame: 10, deltaFrames: 0 });
    expect(st.results[1]?.deltaMs).toBeCloseTo(3.33, 2);
  });

  it('a later input on another frame closes the frame too', () => {
    const st = run(step('MP'), [P('MP', T0 + 170), R('MP', at(11))]);
    expect(st.results[1]?.grade).toBe('ON_TIME');
  });

  it('F12: MP on frame 12 is LATE, +38.3 ms from the start of the target frame', () => {
    const st = settle(run(step('MP'), [P('MP', T0 + 205)]));
    expect(st.results[1]).toMatchObject({ grade: 'LATE', inputFrame: 12, deltaFrames: 2 });
    expect(st.results[1]?.deltaMs).toBeCloseTo(38.33, 2);
  });
});

describe('the extra-press rule (every step)', () => {
  it.each([
    ['LP first', [P('LP', T0 + 170), P('MP', T0 + 170)]],
    ['MP first', [P('MP', T0 + 170), P('LP', T0 + 170)]],
    ['MP first, LP later on the frame', [P('MP', T0 + 168), P('LP', T0 + 182)]],
  ])('F2: MP awaited, LP on the same frame (%s) is WRONG_BUTTON and ends the attempt', (_, inputs) => {
    const st = settle(run(step('MP'), inputs));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[1]).toMatchObject({ stepIndex: 1, grade: 'WRONG_BUTTON', inputFrame: 10, press: { button: 'LP' } });
  });

  it('F2n: non-strict ignores every press on that frame; the step keeps waiting', () => {
    let st = settle(run(step('MP'), [P('LP', T0 + 170), P('MP', T0 + 170)], { strict: false }));
    expect(st.phase).toBe('running');
    expect(currentStepIndex(st)).toBe(1);
    expect(st.ignoredPresses.map((e) => e.button)).toEqual(['LP', 'MP']);
    st = settle(feed(st, [R('MP', at(11, 1)), P('MP', at(12, 1))]));
    expect(st.results[1]).toMatchObject({ grade: 'LATE', inputFrame: 12 });
  });

  it('a direction on the same frame is not an extra press', () => {
    const st = settle(run(step('MP'), [P('MP', T0 + 170), P('UP', T0 + 172)]));
    expect(st.results[1]?.grade).toBe('ON_TIME');
  });

  it('applies to the last step: a stray on its frame is WRONG_BUTTON', () => {
    const c = combo([START, step('MP')]);
    const st = settle(feed(arm(createAttempt(c)), [P('LK', T0), P('MP', at(10)), P('HP', at(10, 9))]));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[1]?.press?.button).toBe('HP');
  });
});

describe('one step per frame', () => {
  it('F11: step 3 HP with relative target 0 can\'t share step 2\'s frame: HP is a stray on it', () => {
    const c = combo([START, step('MP'), step('HP', { targetFrame: 0, tolEarly: 0, tolLate: 0 })]);
    const st = settle(feed(arm(createAttempt(c)), [P('LK', T0), P('MP', T0 + 170), P('HP', T0 + 174)]));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results).toHaveLength(2);
    expect(st.results[1]).toMatchObject({ stepIndex: 1, grade: 'WRONG_BUTTON', press: { button: 'HP' } });
  });

  it('two absolute steps can\'t land on the same frame: the second button is a stray', () => {
    const c = combo([START, step('MP'), step('HP')], { timingMode: 'absolute' });
    const st = settle(feed(arm(createAttempt(c)), [P('LK', T0), P('MP', at(10)), P('HP', at(10, 8))]));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[1]).toMatchObject({ stepIndex: 1, grade: 'WRONG_BUTTON', press: { button: 'HP' } });
  });

  it('a relative target of 0 can\'t be on time: the next frame is 1f late', () => {
    const c = combo([START, step('MP'), step('HP', { targetFrame: 0, tolEarly: 0, tolLate: 0 })]);
    const st = settle(feed(arm(createAttempt(c)), [P('LK', T0), P('MP', at(10)), P('HP', at(11))]));
    expect(st.results[2]).toMatchObject({ grade: 'LATE', inputFrame: 1, deltaFrames: 1 });
  });
});

describe('the press rule in grading', () => {
  it('F3: a tap pressed and released inside one frame registers', () => {
    const st = settle(run(step('LP'), [P('LP', T0 + 171), R('LP', T0 + 178)]));
    expect(st.results[1]?.grade).toBe('ON_TIME');
  });

  it('F4: a held button released and pressed again inside one frame is not a press; the step keeps waiting', () => {
    // Step 1 is LP and stays held into frame 10.
    const c = combo([step('LP', { targetFrame: 0, tolEarly: 0, tolLate: 0 }), step('LP'), TAIL]);
    let st = feed(arm(createAttempt(c)), [P('LP', T0), R('LP', T0 + 170), P('LP', T0 + 176)]);
    st = tick(st, at(11, 10));
    expect(st.phase).toBe('running');
    expect(st.results).toHaveLength(1);
    expect(currentStepIndex(st)).toBe(1);
  });

  it('F5: a double tap inside one frame is one press, timed from the second down event', () => {
    const st = settle(run(step('LP'), [P('LP', T0 + 170), R('LP', T0 + 174), P('LP', T0 + 179)]));
    expect(st.results[1]?.grade).toBe('ON_TIME');
    expect(st.results[1]?.press?.timestamp).toBe(T0 + 179);
    expect(st.results[1]?.deltaMs).toBeCloseTo(12.33, 2);
  });

  it('a button held when the attempt arms counts only once it is released and pressed again', () => {
    let st = arm(createAttempt(combo([START, step('MP')])), ['LK']);
    st = press(st, { button: 'LK', timestamp: 900, source: 'gamepad' }); // a second source, no release
    expect(st.frames.origin).toBeNull();
    st = feed(st, [R('LK', 950), P('LK', T0)]);
    expect(st.frames.origin).toBe(T0);
  });
});

describe('first-input start', () => {
  it('frame 0 starts at the first button press; directions before it don\'t start it', () => {
    let st = feed(arm(createAttempt(combo([START, step('MP')]))), [P('RIGHT', 900)]);
    expect(st.frames.origin).toBeNull();
    st = press(st, { button: 'LK', timestamp: T0, source: 'keyboard' });
    expect(st.frames.origin).toBe(T0);
    expect(st.phase).toBe('armed');
    st = settle(st);
    expect(st).toMatchObject({ phase: 'running', frame0: T0, lastInputFrame: 0 });
  });

  it('strict: a stray on frame 0 is WRONG_BUTTON with no timing', () => {
    const st = settle(feed(arm(createAttempt(combo([START, step('MP')]))), [P('LK', T0), P('HP', T0 + 10)]));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[0]).toEqual({
      stepIndex: 0,
      expected: ['LK'],
      grade: 'WRONG_BUTTON',
      press: { button: 'HP', timestamp: T0 + 10, source: 'keyboard' },
      correctedTimestamp: T0 + 10,
    });
    expect(st.frame0).toBeNull();
  });

  it('non-strict: a stray on frame 0 ignores both presses, clears frame 0 and keeps the held set', () => {
    let st = arm(createAttempt(combo([START, step('MP')]), settings({ strict: false })));
    st = settle(feed(st, [P('LK', T0), P('HP', T0 + 10)]));
    expect(st.phase).toBe('armed');
    expect(st.frames.origin).toBeNull();
    expect(st.held).toEqual(['LK', 'HP']);
    expect(st.ignoredPresses.map((e) => e.button)).toEqual(['LK', 'HP']);
    st = settle(feed(st, [R('LK', T0 + 300), P('LK', T0 + 500)]));
    expect(st).toMatchObject({ phase: 'running', frame0: T0 + 500 });
  });
});

describe('countdown start', () => {
  const c = combo([step('LP', { targetFrame: 0, tolEarly: 0, tolLate: 0 }), step('MP')], { startMode: 'countdown' });

  it('a press before Go is graded EARLY when its negative frame closes', () => {
    let st = press(start(arm(createAttempt(c)), T0), { button: 'LP', timestamp: T0 - 20, source: 'keyboard' });
    expect(st.results).toEqual([]);
    st = tick(st, T0 - 1);
    expect(st.results[0]).toMatchObject({ grade: 'EARLY', inputFrame: -2, deltaFrames: -2 });
  });

  it('a stray on the graded frame is an extra press for step 1 too', () => {
    const st = settle(feed(start(arm(createAttempt(c)), T0), [P('LP', at(0)), P('HP', at(0, 8))]));
    expect(st.endedBy).toBe('wrongButton');
    expect(st.results[0]).toMatchObject({ grade: 'WRONG_BUTTON', inputFrame: 0, press: { button: 'HP' } });
  });
});

describe('closing', () => {
  it('an input whose corrected time falls on an already closed frame counts on the open frame', () => {
    // The keyboard has no offset, the pad 20 ms. A keyboard input on frame 11 closes frame 10;
    // a pad press arriving after it, corrected back onto frame 10, counts on frame 11.
    const lag = settings({ latencyOffsetMs: { keyboard: 0, gamepad: 20 } });
    const c = combo([START, step('MP', { targetFrame: 11, tolEarly: 0, tolLate: 0 }), TAIL]);
    let st = feed(arm(createAttempt(c, lag)), [P('LK', T0), P('UP', at(11, 1)), P('MP', at(11, 3), 'gamepad')]);
    st = settle(st);
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', inputFrame: 11, correctedTimestamp: at(11, 3) - 20 });
  });

  it('the attempt result is final once the last frame closes', () => {
    const c = combo([START, step('MP')]);
    const st = settle(feed(arm(createAttempt(c)), [P('LK', T0), P('MP', at(10))]));
    expect(attemptResult(st)).toMatchObject({ endedBy: 'completed', success: true });
  });
});
