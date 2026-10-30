import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, press, start, tick, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { AttemptResult, Combo, PressEvent, Settings, Step, StepResult } from '../../src/engine/types';
import { describeAttempt, describeStep, signedFrames, signedMs } from '../../src/practice/format';
import {
  REARM_QUIET_MS,
  createPractice,
  practicePress,
  practiceRestart,
  practiceTick,
  practiceWithSettings,
  resetStats,
  shownAttempt,
  type PracticeState,
} from '../../src/practice/session';
import { emptyStats, recordAttempt, summarizeStep } from '../../src/practice/stats';
import { buildTimeline, rulerStep } from '../../src/practice/timeline';

// --- helpers ---------------------------------------------------------------

const s = (button: string, targetFrame: number, tolEarly = 0, tolLate = 0, label?: string): Step => ({
  button,
  targetFrame,
  tolEarly,
  tolLate,
  ...(label ? { label } : {}),
});

const combo = (steps: Step[], opts: Partial<Omit<Combo, 'steps'>> = {}): Combo => ({
  name: 'test',
  steps,
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  ...opts,
});

const p = (button: string, timestamp: number): PressEvent => ({ button, timestamp, source: 'keyboard' });
const f = (frames: number, fps = 60) => frameToMs(frames, fps);
const T0 = 1000;

/** LP at frame 0, then MP 10 frames later (±1). */
const twoStep = combo([s('LP', 0), s('MP', 10, 1, 1)]);

function run(state: PracticeState, presses: PressEvent[]): PracticeState {
  return presses.reduce(practicePress, state);
}

/** Runs an attempt straight through the engine, for stats and timeline tests. */
function engineRun(c: Combo, presses: PressEvent[], settings: Settings = DEFAULT_SETTINGS, frame0?: number): AttemptState {
  let st = arm(createAttempt(c, settings));
  if (frame0 !== undefined) st = start(st, frame0);
  return presses.reduce(press, st);
}

function result(c: Combo, presses: PressEvent[], settings?: Settings): AttemptResult {
  const r = attemptResult(engineRun(c, presses, settings));
  if (!r) throw new Error('attempt not finished');
  return r;
}

// --- session ---------------------------------------------------------------

describe('practice session', () => {
  it('starts armed with empty stats', () => {
    const st = createPractice(twoStep, DEFAULT_SETTINGS);
    expect(st.attempt.phase).toBe('armed');
    expect(st.stats.attempts).toBe(0);
    expect(st.stats.steps).toHaveLength(2);
    expect(st.lastFinished).toBeNull();
  });

  it('records a finished attempt once and keeps it as lastFinished', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = run(st, [p('LP', T0), p('MP', T0 + f(10))]);
    expect(st.attempt.phase).toBe('done');
    expect(st.lastFinished).toBe(st.attempt);
    expect(st.stats.attempts).toBe(1);
    expect(st.stats.successes).toBe(1);
    // Presses after the end are ignored and don't count again.
    st = practicePress(st, p('MP', T0 + f(20)));
    expect(st.stats.attempts).toBe(1);
  });

  it('ends an attempt with MISSED on tick and records it', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', T0));
    // Last accepted frame is 10 + 1 + 30 = 41; frame 42 is a miss.
    st = practiceTick(st, T0 + f(41));
    expect(st.attempt.phase).toBe('running');
    st = practiceTick(st, T0 + f(42));
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.attempts).toBe(1);
    expect(st.stats.streak).toBe(0);
  });

  it('re-arms after the quiet period, which any press restarts', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    const end = T0 + f(10);
    st = run(st, [p('LP', T0), p('MP', end)]);
    st = practiceTick(st, end + REARM_QUIET_MS - 1);
    expect(st.attempt.phase).toBe('done');

    // A stray press while done pushes the re-arm back.
    st = practicePress(st, p('HP', end + 500));
    st = practiceTick(st, end + REARM_QUIET_MS);
    expect(st.attempt.phase).toBe('done');
    st = practiceTick(st, end + 500 + REARM_QUIET_MS);
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.results).toEqual([]);
    expect(st.stats.attempts).toBe(1);
  });

  it('re-arms after a miss too, measured from when the miss was declared', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', T0));
    const missAt = T0 + f(42);
    st = practiceTick(st, missAt);
    st = practiceTick(st, missAt + REARM_QUIET_MS - 1);
    expect(st.attempt.phase).toBe('done');
    st = practiceTick(st, missAt + REARM_QUIET_MS);
    expect(st.attempt.phase).toBe('armed');
  });

  it('restart abandons a running attempt without counting it', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', T0));
    st = practiceRestart(st);
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.results).toEqual([]);
    expect(st.stats.attempts).toBe(0);
  });

  it('restart re-arms a finished attempt immediately', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = run(st, [p('LP', T0), p('MP', T0 + f(10))]);
    st = practiceRestart(st);
    expect(st.attempt.phase).toBe('armed');
    expect(st.stats.attempts).toBe(1);
    expect(st.lastFinished?.phase).toBe('done');
  });

  it('restart on a fresh armed attempt changes nothing', () => {
    const st = createPractice(twoStep, DEFAULT_SETTINGS);
    expect(practiceRestart(st)).toBe(st);
  });

  it('shows the last finished attempt until the next one grades a step', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    expect(shownAttempt(st)).toBe(st.attempt);
    st = run(st, [p('LP', T0), p('MP', T0 + f(12))]);
    const finished = st.attempt;
    expect(shownAttempt(st)).toBe(finished);
    st = practiceRestart(st);
    expect(shownAttempt(st)).toBe(finished);
    st = practicePress(st, p('LP', T0 + 5000));
    expect(shownAttempt(st)).toBe(st.attempt);
  });

  it('keeps matching stats passed in, and ignores stats for a different step count', () => {
    const kept = recordAttempt(emptyStats(2), result(twoStep, [p('LP', T0), p('MP', T0 + f(10))]));
    expect(createPractice(twoStep, DEFAULT_SETTINGS, kept).stats).toBe(kept);
    expect(createPractice(combo([s('LP', 0)]), DEFAULT_SETTINGS, kept).stats.attempts).toBe(0);
  });

  it('switching settings arms a fresh attempt and keeps stats', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = run(st, [p('LP', T0), p('MP', T0 + f(10))]);
    st = practicePress(practiceRestart(st), p('LP', T0 + 5000));
    st = practiceWithSettings(st, { ...DEFAULT_SETTINGS, strict: false });
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.settings.strict).toBe(false);
    expect(st.stats.attempts).toBe(1);
  });

  it('non-strict mode logs wrong presses and keeps waiting', () => {
    let st = createPractice(twoStep, { ...DEFAULT_SETTINGS, strict: false });
    st = run(st, [p('LP', T0), p('HP', T0 + f(5)), p('MP', T0 + f(10))]);
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.successes).toBe(1);
  });

  it('resetStats clears stats and the last result', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = run(st, [p('LP', T0), p('MP', T0 + f(10))]);
    st = resetStats(st);
    expect(st.stats).toEqual(emptyStats(2));
    expect(st.lastFinished).toBeNull();
  });
});

// --- stats -----------------------------------------------------------------

describe('session stats', () => {
  const three = combo([s('LP', 0), s('MP', 10, 1, 1), s('HP', 10, 1, 1)]);

  it('counts per-step reach, on-time and deltas, and tracks streaks', () => {
    let stats = emptyStats(3);
    // Clean.
    stats = recordAttempt(stats, result(three, [p('LP', T0), p('MP', T0 + f(10)), p('HP', T0 + f(20))]));
    // Step 2 two frames late (LATE), step 3 on time.
    stats = recordAttempt(stats, result(three, [p('LP', T0), p('MP', T0 + f(13)), p('HP', T0 + f(23))]));
    // Wrong button on step 2: reached, not timed.
    stats = recordAttempt(stats, result(three, [p('LP', T0), p('HK', T0 + f(10))]));
    // Clean twice.
    stats = recordAttempt(stats, result(three, [p('LP', T0), p('MP', T0 + f(9)), p('HP', T0 + f(20))]));
    stats = recordAttempt(stats, result(three, [p('LP', T0), p('MP', T0 + f(11)), p('HP', T0 + f(21))]));

    expect(stats.attempts).toBe(5);
    expect(stats.successes).toBe(3);
    expect(stats.streak).toBe(2);
    expect(stats.bestStreak).toBe(2);

    const [s1, s2, s3] = stats.steps.map(summarizeStep);
    expect(s1).toMatchObject({ reached: 5, onTime: 5, onTimeRate: 1 });
    expect(s2).toMatchObject({ reached: 5, onTime: 3, onTimeRate: 0.6 });
    // Deltas for step 2: 0, +3, -1, +1 (the wrong press is excluded).
    expect(stats.steps[1]!.deltas).toEqual([0, 3, -1, 1]);
    expect(s2!.meanDelta).toBeCloseTo(0.75);
    expect(s2!.spread).toBeCloseTo(Math.sqrt((0.75 ** 2 + 2.25 ** 2 + 1.75 ** 2 + 0.25 ** 2) / 4));
    // Step 3 wasn't reached in the wrong-button attempt.
    expect(s3).toMatchObject({ reached: 4, onTime: 4 });
  });

  it('keeps the best streak after a failure', () => {
    const clean = result(twoStep, [p('LP', T0), p('MP', T0 + f(10))]);
    const late = result(twoStep, [p('LP', T0), p('MP', T0 + f(15))]);
    let stats = emptyStats(2);
    for (const r of [clean, clean, clean, late, clean]) stats = recordAttempt(stats, r);
    expect(stats.streak).toBe(1);
    expect(stats.bestStreak).toBe(3);
  });

  it('counts a missed step as reached but not timed', () => {
    const st = tick(engineRun(twoStep, [p('LP', T0)]), T0 + f(60));
    const stats = recordAttempt(emptyStats(2), attemptResult(st)!);
    expect(stats.steps[1]).toEqual({ reached: 1, onTime: 0, deltas: [] });
  });

  it('summarizes an unreached step as nulls', () => {
    expect(summarizeStep({ reached: 0, onTime: 0, deltas: [] })).toEqual({
      reached: 0,
      onTime: 0,
      onTimeRate: null,
      meanDelta: null,
      spread: null,
    });
  });
});

// --- timeline --------------------------------------------------------------

describe('timeline', () => {
  it('places relative windows after the previous actual input', () => {
    const c = combo([s('LP', 0), s('MP', 10, 1, 2), s('HP', 5)]);
    // MP lands 3 frames + a bit after LP; HP's window is measured from there.
    const st = engineRun(c, [p('LP', T0), p('MP', T0 + f(12) + 4), p('HP', T0 + f(12) + 4 + f(5))]);
    const tl = buildTimeline(st)!;
    expect(tl.steps.map((x) => x.isStart)).toEqual([true, false, false]);
    expect(tl.steps[0]).toMatchObject({ input: 0, windowStart: 0, windowEnd: 0 });
    expect(tl.steps[1]).toMatchObject({ windowStart: 9, windowEnd: 13, target: 10, grade: 'ON_TIME' });
    expect(tl.steps[1]!.input).toBeCloseTo(12 + 4 / f(1));
    const mpFrame = tl.steps[1]!.input!;
    expect(tl.steps[2]!.windowStart).toBeCloseTo(mpFrame + 5);
    expect(tl.steps[2]!.windowEnd).toBeCloseTo(mpFrame + 6);
    expect(tl.endFrame).toBe(Math.ceil(mpFrame + 6) + 2);
  });

  it('places absolute windows from frame 0', () => {
    const c = combo([s('LP', 0), s('MP', 10), s('HP', 20, 1, 1)], { timingMode: 'absolute' });
    const st = engineRun(c, [p('LP', T0), p('MP', T0 + f(12)), p('HP', T0 + f(20))]);
    const tl = buildTimeline(st)!;
    expect(tl.steps[1]).toMatchObject({ windowStart: 10, windowEnd: 11, grade: 'LATE' });
    expect(tl.steps[2]).toMatchObject({ windowStart: 19, windowEnd: 22 });
  });

  it('shows a missed step with its deadline and no input', () => {
    const st = tick(engineRun(twoStep, [p('LP', T0)]), T0 + f(60));
    const tl = buildTimeline(st)!;
    expect(tl.steps[1]).toMatchObject({ grade: 'MISSED', input: null, windowStart: 9, windowEnd: 12, deadline: 42 });
    expect(tl.endFrame).toBe(44);
  });

  it('records the wrong button pressed', () => {
    const st = engineRun(twoStep, [p('LP', T0), p('HK', T0 + f(10))]);
    const step = buildTimeline(st)!.steps[1]!;
    expect(step).toMatchObject({ grade: 'WRONG_BUTTON', pressed: 'HK' });
    expect(step.input).toBeCloseTo(10);
  });

  it('includes ignored presses after frame 0 only (non-strict)', () => {
    const settings = { ...DEFAULT_SETTINGS, strict: false };
    const st = engineRun(twoStep, [p('HK', T0 - 50), p('LP', T0), p('HP', T0 + f(4)), p('MP', T0 + f(10))], settings);
    expect(buildTimeline(st)!.ignored).toEqual([{ frame: expect.closeTo(4), button: 'HP' }]);
  });

  it('uses latency-corrected times', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, latencyOffsetMs: { keyboard: f(2), gamepad: 0 } };
    const st = engineRun(twoStep, [p('LP', T0), p('MP', T0 + f(10))], settings);
    // Both presses shift by the same offset, so MP is still 10 frames after LP.
    expect(buildTimeline(st)!.steps[1]!.input).toBeCloseTo(10);
  });

  it('works in countdown mode, where step 1 has a window', () => {
    const c = combo([s('LP', 30, 2, 2), s('MP', 10)], { startMode: 'countdown' });
    const st = engineRun(c, [p('LP', T0 + f(29)), p('MP', T0 + f(39))], DEFAULT_SETTINGS, T0);
    const tl = buildTimeline(st)!;
    expect(tl.steps[0]).toMatchObject({ isStart: false, windowStart: 28, windowEnd: 33 });
    expect(tl.steps[0]!.input).toBeCloseTo(29);
  });

  it('is null when the attempt never reached frame 0', () => {
    expect(buildTimeline(engineRun(twoStep, [p('HK', T0)]))).toBeNull();
    expect(buildTimeline(arm(createAttempt(twoStep)))).toBeNull();
  });

  it('picks a readable ruler step', () => {
    expect(rulerStep(8)).toBe(1);
    expect(rulerStep(20)).toBe(2);
    expect(rulerStep(44)).toBe(5);
    expect(rulerStep(100)).toBe(10);
    expect(rulerStep(1000)).toBe(120);
    expect(rulerStep(100000)).toBe(10200);
  });
});

// --- format ----------------------------------------------------------------

describe('feedback text', () => {
  const r = (grade: StepResult['grade'], deltaFrames?: number, deltaMs?: number, pressed?: string): StepResult => ({
    stepIndex: 1,
    expected: 'MP',
    grade,
    ...(deltaFrames !== undefined ? { deltaFrames } : {}),
    ...(deltaMs !== undefined ? { deltaMs } : {}),
    ...(pressed ? { press: p(pressed, 0) } : {}),
  });

  it('formats signed values', () => {
    expect(signedMs(31.44)).toBe('+31.4 ms');
    expect(signedMs(-4)).toBe('−4.0 ms');
    expect(signedMs(-0.01)).toBe('+0.0 ms');
    expect(signedFrames(2)).toBe('+2f');
    expect(signedFrames(-1)).toBe('−1f');
    expect(signedFrames(0)).toBe('0f');
  });

  it('describes each grade', () => {
    expect(describeStep(r('LATE', 2, 31.4), false)).toBe('2f late (+31.4 ms)');
    expect(describeStep(r('EARLY', -3, -45), false)).toBe('3f early (−45.0 ms)');
    expect(describeStep(r('ON_TIME', 0, 5.2), false)).toBe('On time (+5.2 ms)');
    expect(describeStep(r('ON_TIME', 1, 20.1), false)).toBe('On time, 1f late (+20.1 ms)');
    expect(describeStep(r('ON_TIME', -1, -10), false)).toBe('On time, 1f early (−10.0 ms)');
    expect(describeStep(r('ON_TIME', 0, 0), true)).toBe('Start');
    expect(describeStep(r('WRONG_BUTTON', 1, 20, 'HK'), false)).toBe('Wrong button: HK at +1f (+20.0 ms)');
    expect(describeStep(r('WRONG_BUTTON', undefined, undefined, 'HK'), true)).toBe('Wrong button: HK');
    expect(describeStep(r('MISSED'), false)).toBe('Missed');
  });

  it('summarizes attempts', () => {
    expect(describeAttempt(result(twoStep, [p('LP', T0), p('MP', T0 + f(10))]))).toBe('Clean! Every step on time.');
    expect(describeAttempt(result(twoStep, [p('LP', T0), p('MP', T0 + f(15))]))).toBe('Completed: 1 of 2 steps on time.');
    expect(describeAttempt(result(twoStep, [p('LP', T0), p('HK', T0 + f(10))]))).toBe('Wrong button on step 2.');
    expect(describeAttempt(result(twoStep, [p('HK', T0)]))).toBe('Wrong button on step 1.');
    const missed = attemptResult(tick(engineRun(twoStep, [p('LP', T0)]), T0 + f(60)))!;
    expect(describeAttempt(missed)).toBe('Missed step 2.');
  });
});
