import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, press, start, tick, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { AttemptResult, Combo, PressEvent, Settings, Step, StepResult } from '../../src/engine/types';
import { describeAttempt, describeStep, signedFrames, signedMs } from '../../src/practice/format';
import {
  COUNTDOWN_BEATS,
  COUNTDOWN_BEAT_MS,
  countdownBeatTimes,
  countdownFrom,
  COUNTDOWN_LEAD_MS,
  countdownGoAt,
  countdownLiveAt,
  countdownShown,
  createPractice,
  practicePress,
  practiceRestart,
  practiceTick,
  practiceWithSettings,
  resetStats,
  shownAttempt,
  waitingToStart,
  type PracticeState,
} from '../../src/practice/session';
import { METRONOME_FRAME_POINT, PREVIEW_LEAD_MS, metronomeTicks, practiceCues, timingPreview } from '../../src/practice/cues';
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

  it('runs a countdown after an attempt and arms at Go', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    const end = T0 + f(10);
    st = run(st, [p('LP', T0), p('MP', end)]);
    expect(st.countdown).toEqual(countdownFrom(end));
    const go = countdownGoAt(countdownFrom(end));
    expect(go).toBe(end + COUNTDOWN_LEAD_MS + COUNTDOWN_BEATS * COUNTDOWN_BEAT_MS);
    st = practiceTick(st, go - 1);
    expect(st.attempt.phase).toBe('done');
    st = practiceTick(st, go);
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.results).toEqual([]);
    expect(st.countdown).toBeNull();
    expect(st.stats.attempts).toBe(1);
  });

  it('a press during the countdown restarts it and is not graded', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    const end = T0 + f(10);
    st = run(st, [p('LP', T0), p('MP', end)]);
    st = practicePress(st, p('LP', end + 1400));
    expect(st.countdown).toEqual(countdownFrom(end + 1400));
    st = practiceTick(st, countdownGoAt(countdownFrom(end)));
    expect(st.attempt.phase).toBe('done');
    st = practiceTick(st, countdownGoAt(countdownFrom(end + 1400)));
    expect(st.attempt.phase).toBe('armed');
    expect(st.stats.attempts).toBe(1);
  });

  it('a press after Go starts the next attempt even if no tick ran in between', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    const end = T0 + f(10);
    st = run(st, [p('LP', T0), p('MP', end)]);
    const go = countdownGoAt(countdownFrom(end));
    st = practicePress(st, p('LP', go + 5));
    expect(st.countdown).toBeNull();
    expect(st.attempt.phase).toBe('running');
    expect(st.attempt.frame0).toBe(go + 5);
  });

  it('starts the countdown when a miss is declared', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', T0));
    const missAt = T0 + f(42);
    st = practiceTick(st, missAt);
    expect(st.countdown).toEqual(countdownFrom(missAt));
    st = practiceTick(st, countdownGoAt(countdownFrom(missAt)));
    expect(st.attempt.phase).toBe('armed');
  });

  it('restart abandons a running attempt without counting it', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = practicePress(st, p('LP', T0));
    st = practiceRestart(st, T0 + 3000);
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.results).toEqual([]);
    expect(st.stats.attempts).toBe(0);
  });

  it('restart re-arms a finished attempt immediately', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    st = run(st, [p('LP', T0), p('MP', T0 + f(10))]);
    st = practiceRestart(st, T0 + 3000);
    expect(st.attempt.phase).toBe('armed');
    expect(st.stats.attempts).toBe(1);
    expect(st.lastFinished?.phase).toBe('done');
    expect(st.countdown).toBeNull(); // first-input restart skips the countdown
  });

  it('restart on a fresh armed attempt changes nothing', () => {
    const st = createPractice(twoStep, DEFAULT_SETTINGS);
    expect(practiceRestart(st, T0 + 3000)).toBe(st);
  });

  it('shows the last finished attempt until the next one grades a step', () => {
    let st = createPractice(twoStep, DEFAULT_SETTINGS);
    expect(shownAttempt(st)).toBe(st.attempt);
    st = run(st, [p('LP', T0), p('MP', T0 + f(12))]);
    const finished = st.attempt;
    expect(shownAttempt(st)).toBe(finished);
    st = practiceRestart(st, T0 + 3000);
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
    st = practicePress(practiceRestart(st, T0 + 3000), p('LP', T0 + 5000));
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

// --- countdown start mode --------------------------------------------------

describe('countdown start mode', () => {
  /** HP 6 frames after Go (±2), then LK 10 frames after that. */
  const cd = combo([s('HP', 6, 2, 2), s('LK', 10)], { startMode: 'countdown' });
  /** Start the countdown with a press at T0; returns state and Go time. */
  const begin = () => {
    const st = practicePress(createPractice(cd, DEFAULT_SETTINGS), p('LP', T0));
    return { st, go: countdownGoAt(countdownFrom(T0)) };
  };

  it('waits for any press to start the countdown, without grading it', () => {
    const idle = createPractice(cd, DEFAULT_SETTINGS);
    expect(waitingToStart(idle)).toBe(true);
    const { st } = begin();
    expect(waitingToStart(st)).toBe(false);
    expect(st.countdown).toEqual(countdownFrom(T0));
    expect(st.attempt.phase).toBe('armed');
    expect(st.attempt.results).toEqual([]);
  });

  it('restart also starts the countdown', () => {
    const st = practiceRestart(createPractice(cd, DEFAULT_SETTINGS), T0);
    expect(st.countdown).toEqual(countdownFrom(T0));
  });

  it('Go is frame 0: step 1 is graded against its target frame', () => {
    let { st, go } = begin();
    st = practiceTick(st, countdownLiveAt(countdownFrom(T0)));
    expect(st.attempt.phase).toBe('running');
    expect(st.attempt.frame0).toBe(go);
    st = practicePress(st, p('HP', go + f(7)));
    expect(st.attempt.results[0]?.grade).toBe('ON_TIME');
    expect(st.attempt.results[0]?.deltaFrames).toBe(1);
    st = practicePress(st, p('LK', go + f(17)));
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.successes).toBe(1);
  });

  it('a press before the last beat restarts the countdown', () => {
    let { st } = begin();
    const t = countdownLiveAt(countdownFrom(T0)) - 1;
    st = practicePress(st, p('HP', t));
    expect(st.countdown).toEqual(countdownFrom(t));
    expect(st.attempt.phase).toBe('armed');
  });

  it('a press in the last beat grades EARLY instead of restarting', () => {
    let { st, go } = begin();
    // No tick has run: the press itself moves the countdown to its live part.
    st = practicePress(st, p('HP', countdownLiveAt(countdownFrom(T0)) + 10));
    expect(st.countdown).toEqual(countdownFrom(T0));
    expect(st.attempt.frame0).toBe(go);
    expect(st.attempt.results[0]?.grade).toBe('EARLY');
    expect(st.attempt.results[0]?.inputFrame).toBeLessThan(0);
  });

  it('the countdown clears at Go and the attempt keeps running', () => {
    let { st, go } = begin();
    st = practiceTick(st, go);
    expect(st.countdown).toBeNull();
    expect(st.attempt.phase).toBe('running');
    st = practicePress(st, p('HP', go + f(6)));
    expect(st.attempt.results).toHaveLength(1);
  });

  it('a miss starts the next countdown, which starts the next attempt at its Go', () => {
    let { st, go } = begin();
    // Step 1: last accepted frame is 6 + 2 + 30 = 38.
    const missAt = go + f(39);
    st = practiceTick(st, missAt);
    expect(st.attempt.phase).toBe('done');
    expect(st.stats.attempts).toBe(1);
    expect(st.countdown).toEqual(countdownFrom(missAt));
    st = practiceTick(st, countdownLiveAt(countdownFrom(missAt)));
    expect(st.attempt.phase).toBe('running');
    expect(st.attempt.results).toEqual([]);
    expect(st.attempt.frame0).toBe(countdownGoAt(countdownFrom(missAt)));
    expect(shownAttempt(st)).toBe(st.lastFinished);
  });

  it('restart during a running attempt abandons it and starts a new countdown', () => {
    let { st, go } = begin();
    st = practicePress(practiceTick(st, go), p('HP', go + f(6)));
    st = practiceRestart(st, go + 500);
    expect(st.stats.attempts).toBe(0);
    expect(st.attempt.phase).toBe('armed');
    expect(st.countdown).toEqual(countdownFrom(go + 500));
  });

  it('switching settings stops the countdown and waits for a press again', () => {
    const { st } = begin();
    const next = practiceWithSettings(st, { ...DEFAULT_SETTINGS, strict: false });
    expect(next.countdown).toBeNull();
    expect(waitingToStart(next)).toBe(true);
  });
});

describe('countdown helpers', () => {
  const c = { startAt: 100 };

  it('lists beat times with Go last', () => {
    expect(countdownBeatTimes(c)).toEqual([100, 600, 1100, 1600]);
    expect(countdownGoAt(c)).toBe(1600);
    expect(countdownLiveAt(c)).toBe(1100);
  });

  it('shows 3, 2, 1, then 0 for Go for one beat', () => {
    expect(countdownShown(c, 99)).toBeNull();
    expect(countdownShown(c, 100)).toBe(3);
    expect(countdownShown(c, 599)).toBe(3);
    expect(countdownShown(c, 600)).toBe(2);
    expect(countdownShown(c, 1100)).toBe(1);
    expect(countdownShown(c, 1600)).toBe(0);
    expect(countdownShown(c, 2099)).toBe(0);
    expect(countdownShown(c, 2100)).toBeNull();
    expect(countdownShown(null, 1000)).toBeNull();
  });

  it('the first beat comes a lead-in after the trigger', () => {
    const lead = countdownFrom(100);
    expect(lead.startAt).toBe(100 + COUNTDOWN_LEAD_MS);
    expect(countdownShown(lead, 100)).toBeNull();
  });
});

// --- sound cues --------------------------------------------------------------

describe('sound cues', () => {
  const three = combo([s('LP', 0), s('MP', 10, 1, 1), s('HP', 10)]);

  it('no sound for the first-input start step, then one per graded step', () => {
    const a = createPractice(three, DEFAULT_SETTINGS);
    const b = practicePress(a, p('LP', T0));
    expect(practiceCues(a, b)).toEqual([]);
    const c = practicePress(b, p('MP', T0 + f(10)));
    expect(practiceCues(b, c)).toEqual(['onTime']);
    const d = practicePress(createPractice(three, DEFAULT_SETTINGS), p('LP', T0));
    expect(practiceCues(d, practicePress(d, p('MP', T0 + f(13))))).toEqual(['off']);
  });

  it('a finished attempt gives one clean or fail sound', () => {
    const b = run(createPractice(three, DEFAULT_SETTINGS), [p('LP', T0), p('MP', T0 + f(10))]);
    expect(practiceCues(b, practicePress(b, p('HP', T0 + f(20))))).toEqual(['clean']);
    expect(practiceCues(b, practicePress(b, p('HP', T0 + f(22))))).toEqual(['fail']);
    expect(practiceCues(b, practicePress(b, p('LK', T0 + f(20))))).toEqual(['fail']);
    expect(practiceCues(b, practiceTick(b, T0 + f(60)))).toEqual(['fail']);
  });

  it('nothing for changes that grade no step', () => {
    const a = createPractice(three, DEFAULT_SETTINGS);
    expect(practiceCues(a, a)).toEqual([]);
    const done = run(a, [p('LP', T0), p('MP', T0 + f(10)), p('HP', T0 + f(20))]);
    expect(practiceCues(done, practiceRestart(done, T0 + 2000))).toEqual([]);
  });

  it('countdown mode sounds for step 1 too', () => {
    const cd = combo([s('HP', 6), s('LK', 10)], { startMode: 'countdown' });
    let st = practicePress(createPractice(cd, DEFAULT_SETTINGS), p('LP', T0));
    const go = countdownGoAt(countdownFrom(T0));
    st = practiceTick(st, go);
    expect(practiceCues(st, practicePress(st, p('HP', go + f(6))))).toEqual(['onTime']);
  });
});

describe('metronome ticks', () => {
  const mid = (frame: number) => f(frame + METRONOME_FRAME_POINT);

  it('relative: only the awaited step, from the previous press', () => {
    const c = combo([s('LP', 0), s('MP', 10), s('HP', 5)]);
    let st = createPractice(c, DEFAULT_SETTINGS);
    expect(metronomeTicks(st.attempt)).toEqual([]);
    st = practicePress(st, p('LP', T0));
    expect(metronomeTicks(st.attempt).map((t) => t.at)).toEqual([T0 + mid(10)]);
    st = practicePress(st, p('MP', T0 + 170));
    expect(metronomeTicks(st.attempt).map((t) => t.at)).toEqual([T0 + 170 + mid(5)]);
  });

  it('absolute: every remaining step from frame 0, skipping the start step', () => {
    const c = combo([s('LP', 0), s('MP', 10), s('HP', 20)], { timingMode: 'absolute' });
    let st = practicePress(createPractice(c, DEFAULT_SETTINGS), p('LP', T0));
    expect(metronomeTicks(st.attempt).map((t) => t.at)).toEqual([T0 + mid(10), T0 + mid(20)]);
    const before = metronomeTicks(st.attempt)[1]?.key;
    st = practicePress(st, p('MP', T0 + f(10)));
    const after = metronomeTicks(st.attempt);
    expect(after.map((t) => t.at)).toEqual([T0 + mid(20)]);
    expect(after[0]?.key).toBe(before);
  });

  it('countdown mode ticks step 1 from Go, and nothing once done', () => {
    const c = combo([s('HP', 6)], { startMode: 'countdown' });
    let st = practicePress(createPractice(c, DEFAULT_SETTINGS), p('LP', T0));
    const go = countdownGoAt(countdownFrom(T0));
    st = practiceTick(st, countdownLiveAt(countdownFrom(T0)));
    expect(metronomeTicks(st.attempt).map((t) => t.at)).toEqual([go + mid(6)]);
    st = practicePress(st, p('HP', go + f(6)));
    expect(metronomeTicks(st.attempt)).toEqual([]);
  });
});

describe('timing preview', () => {
  const mid = (frame: number, fps = 60) => f(frame + METRONOME_FRAME_POINT, fps);
  const L = PREVIEW_LEAD_MS;

  it('first input, relative: start step at frame 0, each next press after the previous one', () => {
    const c = combo([s('LP', 0), s('MP', 12, 2, 2), s('HP', 15)]);
    expect(timingPreview(c)).toEqual([
      { kind: 'press', at: L, stepIndex: 0 },
      { kind: 'press', at: L + mid(12), stepIndex: 1 },
      { kind: 'press', at: L + mid(12) + mid(15), stepIndex: 2 },
    ]);
  });

  it('absolute: every press counts from frame 0', () => {
    const c = combo([s('LP', 0), s('LK', 15), s('LP', 30)], { timingMode: 'absolute' });
    expect(timingPreview(c).map((p) => p.at)).toEqual([L, L + mid(15), L + mid(30)]);
  });

  it('countdown: beats, then Go as frame 0, then step 1 at its target frame', () => {
    const c = combo([s('HP', 6), s('LK', 10)], { startMode: 'countdown' });
    const go = L + COUNTDOWN_BEATS * COUNTDOWN_BEAT_MS;
    expect(timingPreview(c)).toEqual([
      { kind: 'beat', at: L },
      { kind: 'beat', at: L + COUNTDOWN_BEAT_MS },
      { kind: 'beat', at: L + 2 * COUNTDOWN_BEAT_MS },
      { kind: 'go', at: go },
      { kind: 'press', at: go + mid(6), stepIndex: 0 },
      { kind: 'press', at: go + mid(6) + mid(10), stepIndex: 1 },
    ]);
  });

  it('uses the combo fps', () => {
    const c = combo([s('LP', 0), s('MP', 10)], { fps: 30 });
    expect(timingPreview(c)[1]?.at).toBeCloseTo(L + mid(10, 30));
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
