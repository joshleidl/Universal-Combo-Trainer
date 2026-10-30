import { describe, expect, it } from 'vitest';
import {
  arm,
  attemptResult,
  createAttempt,
  currentStepIndex,
  press,
  start,
  tick,
  validateCombo,
  type AttemptState,
} from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { Combo, InputSource, PressEvent, Settings, Step } from '../../src/engine/types';

// --- helpers ---------------------------------------------------------------

const s = (button: string, targetFrame: number, tolEarly = 0, tolLate = 0): Step => ({
  button,
  targetFrame,
  tolEarly,
  tolLate,
});

const combo = (steps: Step[], opts: Partial<Omit<Combo, 'steps'>> = {}): Combo => ({
  name: 'test',
  steps,
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  ...opts,
});

const p = (button: string, timestamp: number, source: InputSource = 'keyboard'): PressEvent => ({
  button,
  timestamp,
  source,
});

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

/** Creates, arms, and (for countdown) starts an attempt. */
function begin(c: Combo, st: Settings = DEFAULT_SETTINGS, frame0 = 1000): AttemptState {
  const armed = arm(createAttempt(c, st));
  return c.startMode === 'countdown' ? start(armed, frame0) : armed;
}

const feed = (state: AttemptState, presses: PressEvent[]) => presses.reduce(press, state);

/** ms timestamp of `frame` frames after `base`, at `fps`. */
const f = (base: number, frame: number, fps = 60) => base + frameToMs(frame, fps);

// --- tests -----------------------------------------------------------------

describe('phases', () => {
  it('moves idle → armed → running → done', () => {
    const c = combo([s('LP', 0), s('MP', 3)]);
    let st = createAttempt(c);
    expect(st.phase).toBe('idle');
    expect(press(st, p('LP', 1000))).toBe(st); // ignored while idle
    st = arm(st);
    expect(st.phase).toBe('armed');
    st = press(st, p('LP', 1000));
    expect(st.phase).toBe('running');
    expect(currentStepIndex(st)).toBe(1);
    st = press(st, p('MP', 1050));
    expect(st.phase).toBe('done');
    expect(currentStepIndex(st)).toBeNull();
    expect(press(st, p('MP', 1100))).toBe(st); // ignored once done
  });

  it('returns no result until done', () => {
    const st = begin(combo([s('LP', 0), s('MP', 3)]));
    expect(attemptResult(st)).toBeNull();
    expect(attemptResult(press(st, p('LP', 1000)))).toBeNull();
  });

  it('re-arms a finished attempt as a fresh one', () => {
    const done = feed(begin(combo([s('LP', 0), s('MP', 3)])), [p('LP', 1000), p('MP', 1050)]);
    const again = arm(done);
    expect(again.phase).toBe('armed');
    expect(again.results).toEqual([]);
    expect(again.frame0).toBeNull();
  });

  it('ignores start() in firstInput mode and arm() while running', () => {
    const armed = begin(combo([s('LP', 0), s('MP', 3)]));
    expect(start(armed, 1000)).toBe(armed);
    const running = press(armed, p('LP', 1000));
    expect(arm(running)).toBe(running);
  });

  it('completes a one-step firstInput combo on the first press', () => {
    const st = press(begin(combo([s('LP', 0)])), p('LP', 1000));
    expect(st.phase).toBe('done');
    expect(attemptResult(st)?.success).toBe(true);
  });
});

describe('validation', () => {
  it('rejects bad combos and settings', () => {
    expect(validateCombo(combo([s('LP', 0)]))).toEqual([]);
    expect(validateCombo(combo([]))).toHaveLength(1);
    expect(validateCombo(combo([s('LP', 1.5)]))).toHaveLength(1);
    expect(validateCombo(combo([s('LP', 0, -1)]))).toHaveLength(1);
    expect(validateCombo(combo([s('', 0)]))).toHaveLength(1);
    expect(validateCombo(combo([s('LP', 0)], { fps: 0 }))).toHaveLength(1);
    expect(() => createAttempt(combo([]))).toThrow(/at least one step/);
    expect(() => createAttempt(combo([s('LP', 0)]), settings({ timeoutFrames: -1 }))).toThrow();
  });
});

describe('a clean run', () => {
  it('grades every step on time and reports zero deltas at exact frame starts', () => {
    const st = feed(begin(combo([s('LP', 0), s('MP', 3), s('HP', 5)])), [
      p('LP', 1000),
      p('MP', f(1000, 3)),
      p('HP', f(f(1000, 3), 5)),
    ]);
    const r = attemptResult(st)!;
    expect(r.endedBy).toBe('completed');
    expect(r.success).toBe(true);
    expect(r.results.map((x) => x.grade)).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME']);
    expect(r.results[1]).toMatchObject({ inputFrame: 3, deltaFrames: 0 });
    expect(r.results[1]!.deltaMs).toBeCloseTo(0, 9);
    expect(r.results[2]!.deltaMs).toBeCloseTo(0, 9);
  });
});

describe('early / late / tolerance', () => {
  const c = combo([s('LP', 0), s('MP', 3)]);
  const second = (t: number, cc = c) =>
    attemptResult(feed(begin(cc), [p('LP', 1000), p('MP', t)]))!.results[1]!;

  it('grades a press just before the target frame 1f early', () => {
    const r = second(f(1000, 3) - 0.01);
    expect(r).toMatchObject({ grade: 'EARLY', inputFrame: 2, deltaFrames: -1 });
    expect(r.deltaMs).toBeCloseTo(-0.01, 6);
  });

  it('grades a press at the start of the next frame 1f late', () => {
    const r = second(f(1000, 4));
    expect(r).toMatchObject({ grade: 'LATE', inputFrame: 4, deltaFrames: 1 });
    expect(r.deltaMs).toBeCloseTo(16.6667, 4);
  });

  it('accepts presses inside the tolerance window and rejects ones outside', () => {
    const tol = combo([s('LP', 0), s('MP', 10, 1, 2)]);
    expect(second(f(1000, 8), tol).grade).toBe('EARLY');
    expect(second(f(1000, 9), tol).grade).toBe('ON_TIME');
    expect(second(f(1000, 12), tol).grade).toBe('ON_TIME');
    expect(second(f(1000, 13), tol).grade).toBe('LATE');
    expect(second(f(1000, 13), tol).deltaFrames).toBe(3);
  });

  it('marks the attempt unsuccessful when any step is off', () => {
    const r = attemptResult(feed(begin(c), [p('LP', 1000), p('MP', f(1000, 4))]))!;
    expect(r.endedBy).toBe('completed');
    expect(r.success).toBe(false);
  });
});

describe('relative vs absolute timing', () => {
  const steps = [s('LP', 0), s('MP', 3), s('HP', 6)];
  const presses = [p('LP', 1000), p('MP', f(1000, 3)), p('HP', f(1000, 6))];

  it('absolute mode measures every step from frame 0', () => {
    const r = attemptResult(feed(begin(combo(steps, { timingMode: 'absolute' })), presses))!;
    expect(r.results[2]).toMatchObject({ grade: 'ON_TIME', inputFrame: 6, deltaFrames: 0 });
  });

  it('relative mode measures each step from the previous input', () => {
    const r = attemptResult(feed(begin(combo(steps, { timingMode: 'relative' })), presses))!;
    expect(r.results[2]).toMatchObject({ grade: 'EARLY', inputFrame: 3, deltaFrames: -3 });
  });

  it('relative mode uses the actual previous input even when it was off', () => {
    const c = combo([s('LP', 0), s('MP', 3), s('HP', 3)]);
    const mp = f(1000, 4); // 1f late
    const r = attemptResult(feed(begin(c), [p('LP', 1000), p('MP', mp), p('HP', f(mp, 3))]))!;
    expect(r.results.map((x) => x.grade)).toEqual(['ON_TIME', 'LATE', 'ON_TIME']);
  });

  it('absolute mode does not shift after an off-time input', () => {
    const c = combo([s('LP', 0), s('MP', 3), s('HP', 6)], { timingMode: 'absolute' });
    const r = attemptResult(
      feed(begin(c), [p('LP', 1000), p('MP', f(1000, 4)), p('HP', f(1000, 6))]),
    )!;
    expect(r.results.map((x) => x.grade)).toEqual(['ON_TIME', 'LATE', 'ON_TIME']);
  });
});

describe('start modes', () => {
  it('firstInput: the first press is frame 0 and always on time, whatever its target', () => {
    const st = press(begin(combo([s('LP', 10), s('MP', 3)])), p('LP', 1234));
    expect(st.frame0).toBe(1234);
    expect(st.results[0]).toMatchObject({
      grade: 'ON_TIME',
      elapsedMs: 0,
      inputFrame: 0,
      deltaFrames: 0,
      deltaMs: 0,
    });
  });

  it('countdown: step 1 is graded against its target from frame 0', () => {
    const c = combo([s('LP', 2), s('MP', 3)], { startMode: 'countdown' });
    const onTime = press(begin(c), p('LP', f(1000, 2)));
    expect(onTime.results[0]).toMatchObject({ grade: 'ON_TIME', inputFrame: 2, deltaFrames: 0 });
    const early = press(begin(c), p('LP', 1000));
    expect(early.results[0]).toMatchObject({ grade: 'EARLY', deltaFrames: -2 });
    const late = press(begin(c), p('LP', f(1000, 3)));
    expect(late.results[0]).toMatchObject({ grade: 'LATE', deltaFrames: 1 });
  });

  it('countdown: presses before start() are ignored', () => {
    const c = combo([s('LP', 0), s('MP', 3)], { startMode: 'countdown' });
    const armed = arm(createAttempt(c));
    expect(currentStepIndex(armed)).toBeNull();
    expect(press(armed, p('LP', 900))).toBe(armed);
  });

  it('countdown: a press before a scheduled frame 0 grades early with negative frames', () => {
    const c = combo([s('LP', 0), s('MP', 3)], { startMode: 'countdown' });
    const st = press(begin(c, DEFAULT_SETTINGS, 2000), p('LP', 1990));
    expect(st.results[0]).toMatchObject({ grade: 'EARLY', inputFrame: -1, deltaFrames: -1 });
  });

  it('countdown + relative: step 2 is measured from step 1, not from frame 0', () => {
    const c = combo([s('LP', 2), s('MP', 3)], { startMode: 'countdown' });
    const lp = f(1000, 2);
    const r = attemptResult(feed(begin(c), [p('LP', lp), p('MP', f(lp, 3))]))!;
    expect(r.success).toBe(true);
  });

  it('countdown + absolute: step 2 is measured from frame 0', () => {
    const c = combo([s('LP', 2), s('MP', 5)], { startMode: 'countdown', timingMode: 'absolute' });
    const r = attemptResult(feed(begin(c), [p('LP', f(1000, 2)), p('MP', f(1000, 5))]))!;
    expect(r.success).toBe(true);
  });
});

describe('wrong button', () => {
  const c = combo([s('LP', 0), s('MP', 3), s('HP', 3)]);

  it('strict: ends the attempt with WRONG_BUTTON and keeps its timing', () => {
    const st = feed(begin(c), [p('LP', 1000), p('HK', f(1000, 3))]);
    const r = attemptResult(st)!;
    expect(r.endedBy).toBe('wrongButton');
    expect(r.success).toBe(false);
    expect(r.results).toHaveLength(2);
    expect(r.results[1]).toMatchObject({
      grade: 'WRONG_BUTTON',
      expected: 'MP',
      inputFrame: 3,
      deltaFrames: 0,
    });
    expect(r.results[1]!.press?.button).toBe('HK');
  });

  it('strict: a wrong first press in firstInput mode ends the attempt', () => {
    const r = attemptResult(press(begin(c), p('HK', 1000)))!;
    expect(r.endedBy).toBe('wrongButton');
    expect(r.results[0]).toMatchObject({ stepIndex: 0, grade: 'WRONG_BUTTON', expected: 'LP' });
  });

  it('non-strict: logs and ignores wrong presses; the step keeps waiting', () => {
    const lax = settings({ strict: false });
    const st = feed(begin(c, lax), [
      p('HK', 990), // ignored before frame 0
      p('LP', 1000),
      p('HK', f(1000, 1)), // ignored
      p('MP', f(1000, 3)),
      p('LK', f(f(1000, 3), 2)), // ignored
      p('HP', f(f(1000, 3), 3)),
    ]);
    const r = attemptResult(st)!;
    expect(r.success).toBe(true);
    expect(r.ignoredPresses.map((x) => x.button)).toEqual(['HK', 'HK', 'LK']);
    expect(st.frame0).toBe(1000);
  });
});

describe('missed / timeout', () => {
  // Step 2: target 3, tolLate 1, default timeout 30 → last accepted frame is 34.
  const c = combo([s('LP', 0), s('MP', 3, 0, 1)]);
  const running = () => press(begin(c), p('LP', 1000));

  it('tick() keeps waiting through the last accepted frame', () => {
    const st = tick(running(), f(1000, 35) - 0.01);
    expect(st.phase).toBe('running');
  });

  it('tick() ends the attempt with MISSED once the window has passed', () => {
    const st = tick(running(), f(1000, 35));
    const r = attemptResult(st)!;
    expect(r.endedBy).toBe('missed');
    expect(r.results[1]).toEqual({ stepIndex: 1, expected: 'MP', grade: 'MISSED' });
  });

  it('a press on the last accepted frame is graded LATE', () => {
    const st = press(running(), p('MP', f(1000, 34)));
    expect(st.results[1]).toMatchObject({ grade: 'LATE', deltaFrames: 31 });
  });

  it('a press after the window is MISSED even if tick() never ran', () => {
    const viaPress = attemptResult(press(running(), p('MP', f(1000, 35))))!;
    const viaTick = attemptResult(tick(running(), f(1000, 35)))!;
    expect(viaPress.results).toEqual(viaTick.results);
  });

  it('missed takes priority over a late wrong button', () => {
    const r = attemptResult(press(running(), p('HK', f(1000, 40))))!;
    expect(r.endedBy).toBe('missed');
  });

  it('respects a custom timeoutFrames', () => {
    const st0 = press(begin(c, settings({ timeoutFrames: 0 })), p('LP', 1000));
    expect(tick(st0, f(1000, 5) - 0.01).phase).toBe('running');
    expect(tick(st0, f(1000, 5)).endedBy).toBe('missed');
  });

  it('can miss the first step in countdown mode', () => {
    const cd = combo([s('LP', 2)], { startMode: 'countdown' });
    const st = tick(begin(cd), f(1000, 33));
    expect(attemptResult(st)?.results[0]?.grade).toBe('MISSED');
  });

  it('tick() does nothing outside the running phase', () => {
    const armed = begin(c);
    expect(tick(armed, 1e9)).toBe(armed);
  });
});

describe('fps values', () => {
  it.each([30, 60, 120])('grades frame boundaries correctly at %s fps', (fps) => {
    const c = combo([s('LP', 0), s('MP', 4)], { fps });
    const second = (t: number) => attemptResult(feed(begin(c), [p('LP', 1000), p('MP', t)]))!.results[1]!;

    const onTime = second(f(1000, 4, fps));
    expect(onTime).toMatchObject({ grade: 'ON_TIME', inputFrame: 4, deltaFrames: 0 });

    const early = second(f(1000, 4, fps) - 0.01);
    expect(early).toMatchObject({ grade: 'EARLY', deltaFrames: -1 });

    const late = second(f(1000, 5, fps));
    expect(late).toMatchObject({ grade: 'LATE', deltaFrames: 1 });
    expect(late.deltaMs).toBeCloseTo(1000 / fps, 6);
  });

  it('the same elapsed time maps to different frames at different fps', () => {
    const frameAt = (fps: number) =>
      attemptResult(
        feed(begin(combo([s('LP', 0), s('MP', 0)], { fps })), [p('LP', 1000), p('MP', 1050)]),
      )!.results[1]!.inputFrame;
    expect(frameAt(30)).toBe(1);
    expect(frameAt(60)).toBe(3);
    expect(frameAt(120)).toBe(6);
  });
});

describe('latency offset', () => {
  const c = combo([s('LP', 0), s('MP', 3)]);

  it('subtracts the keyboard offset before grading', () => {
    const lag = settings({ latencyOffsetMs: { keyboard: 20, gamepad: 0 } });
    // Both presses arrive 20 ms "late"; after correction they are exactly on time.
    const r = attemptResult(feed(begin(c, lag), [p('LP', 1020), p('MP', f(1020, 3))]))!;
    expect(r.success).toBe(true);
    expect(r.results[0]!.correctedTimestamp).toBe(1000);
  });

  it('uses the offset for each press source', () => {
    const lag = settings({ latencyOffsetMs: { keyboard: 0, gamepad: 20 } });
    // LP on keyboard at 1000; MP on gamepad arrives at frame 3 + 20 ms.
    const st = feed(begin(c, lag), [p('LP', 1000, 'keyboard'), p('MP', f(1000, 3) + 20, 'gamepad')]);
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', inputFrame: 3 });
    // Without the offset that press would be 1f late.
    const raw = feed(begin(c), [p('LP', 1000, 'keyboard'), p('MP', f(1000, 3) + 20, 'gamepad')]);
    expect(raw.results[1]).toMatchObject({ grade: 'LATE', inputFrame: 4 });
  });

  it('applies to presses but not to the countdown frame 0', () => {
    const cd = combo([s('LP', 3)], { startMode: 'countdown' });
    const lag = settings({ latencyOffsetMs: { keyboard: 20, gamepad: 0 } });
    const st = press(begin(cd, lag, 1000), p('LP', f(1000, 3) + 20));
    expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', inputFrame: 3 });
  });

  it('tick() waits for the largest offset before declaring a miss', () => {
    const lag = settings({ latencyOffsetMs: { keyboard: 0, gamepad: 20 } });
    const st = press(begin(c, lag), p('LP', 1000, 'keyboard'));
    // Last accepted frame is 33 (target 3 + 0 + 30), so the window closes at the start of frame 34.
    // A gamepad press 15 ms after that, corrected by 20 ms, still lands on frame 33.
    expect(tick(st, f(1000, 34) + 15).phase).toBe('running');
    expect(press(st, p('MP', f(1000, 34) + 15, 'gamepad')).results[1]!.grade).toBe('LATE');
    expect(tick(st, f(1000, 34) + 20).phase).toBe('done');
  });

  it('a negative offset shifts presses later', () => {
    const lead = settings({ latencyOffsetMs: { keyboard: -10, gamepad: 0 } });
    const st = feed(begin(c, lead), [p('LP', 1000), p('MP', f(1000, 3) - 10)]);
    // Both presses shift by +10 ms, so the gap is unchanged.
    expect(st.results[1]).toMatchObject({ grade: 'EARLY', deltaFrames: -1 });
  });
});
