import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, press, start, tick } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { Combo, Grade, StartMode, Step } from '../../src/engine/types';

// Fixed frame grid for relative mode (DECISIONS.md, "Fixed frame grid").
// One grid per attempt starts at frame 0. A press lands on floor((t − frame0) / frameMs),
// and a relative step is counted from the start of the frame the previous press landed on,
// not from that press's exact time. 60 FPS: one frame = 1000/60 ms.

const F = 1000 / 60;
const BUTTONS = ['LP', 'MP', 'HP', 'LK'];

/** A relative combo at 60 FPS. Step 1 is the start; each later step has a gap of 3 frames, tolerance 0/0. */
function combo(stepCount: number, startMode: StartMode = 'firstInput'): Combo {
  const steps: Step[] = BUTTONS.slice(0, stepCount).map((button, i) => ({
    buttons: [button],
    targetFrame: i === 0 ? 0 : 3,
    tolEarly: 0,
    tolLate: 0,
  }));
  return { name: 'fixed grid', steps, fps: 60, timingMode: 'relative', startMode };
}

/** Presses each step's button at the given times and returns the step results. */
function run(c: Combo, times: number[], frame0?: number) {
  let st = arm(createAttempt(c, DEFAULT_SETTINGS));
  if (frame0 !== undefined) st = start(st, frame0);
  times.forEach((t, i) => {
    st = press(st, { button: c.steps[i]!.buttons[0]!, timestamp: t, source: 'keyboard' });
  });
  // The last step's result comes when its frame closes (SPEC §3, "Frames").
  st = tick(st, Math.max(...times) + F);
  const result = attemptResult(st);
  if (!result) throw new Error('attempt did not finish');
  return result;
}

const grades = (times: number[], c: Combo, frame0?: number): Grade[] =>
  run(c, times, frame0).results.map((r) => r.grade);

describe('fixed frame grid: 3 presses, LP 0 ms, MP 60 ms (frame 3), gaps 3/3', () => {
  // MP lands 10 ms into frame 3, so HP's on-time window is frame 6: [100, 116.67) ms.
  // Today's rule puts the window at 60 + [50, 66.67) = [110, 126.67) ms instead.

  it('HP at 105 ms (frame 6) is ON_TIME', () => {
    expect(grades([0, 60, 105], combo(3))).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME']);
  });

  it('HP at 120 ms (frame 7) is LATE', () => {
    expect(grades([0, 60, 120], combo(3))).toEqual(['ON_TIME', 'ON_TIME', 'LATE']);
  });

  it('HP at 105 ms reports frames and ms from the start of MP\'s frame', () => {
    const hp = run(combo(3), [0, 60, 105]).results[2]!;
    expect(hp.inputFrame).toBe(3); // frame 6 − MP's frame 3
    expect(hp.deltaFrames).toBe(0);
    expect(hp.deltaMs).toBeCloseTo(5, 6); // 105 ms − start of frame 6 (100 ms)
  });

  it('HP exactly at the start of frame 6 (100 ms) is ON_TIME', () => {
    expect(grades([0, 60, 6 * F], combo(3))).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME']);
  });

  it('HP exactly at the start of frame 7 (116.67 ms) is LATE', () => {
    expect(grades([0, 60, 7 * F], combo(3))).toEqual(['ON_TIME', 'ON_TIME', 'LATE']);
  });
});

describe('fixed frame grid: control, MP exactly on a frame edge (50 ms = start of frame 3)', () => {
  // Both rules agree here, because MP's exact time is also the start of its frame.

  it('HP at 105 ms (frame 6) is ON_TIME', () => {
    expect(grades([0, 3 * F, 105], combo(3))).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME']);
  });

  it('HP at 120 ms (frame 7) is LATE', () => {
    expect(grades([0, 3 * F, 120], combo(3))).toEqual(['ON_TIME', 'ON_TIME', 'LATE']);
  });
});

describe('fixed frame grid: 4-step chain', () => {
  it('every press in its intended frame (3, 6, 9) is ON_TIME, wherever it falls inside the frame', () => {
    // MP late in frame 3 (66 ms), HP early in frame 6 (101 ms), LK late in frame 9 (165 ms).
    const result = run(combo(4), [0, 66, 101, 165]);
    expect(result.results.map((r) => r.grade)).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME', 'ON_TIME']);
    expect(result.success).toBe(true);
  });
});

describe('fixed frame grid: countdown start (frame 0 = Go at 1000 ms)', () => {
  const go = 1000;

  it('LP, MP, HP in frames 0, 3, 6 are all ON_TIME, even though LP is 15 ms after Go', () => {
    // LP lands in frame 0 but 15 ms after its start, so step 2 is affected too:
    // MP at +52 ms is frame 3, but only 37 ms after LP.
    expect(grades([go + 15, go + 52, go + 105], combo(3, 'countdown'), go)).toEqual([
      'ON_TIME',
      'ON_TIME',
      'ON_TIME',
    ]);
  });

  it('HP in frame 7 (+120 ms) is LATE', () => {
    expect(grades([go + 15, go + 52, go + 120], combo(3, 'countdown'), go)).toEqual([
      'ON_TIME',
      'ON_TIME',
      'LATE',
    ]);
  });
});

// Keep frameToMs in use so the frame length above stays the engine's.
it('frame length matches the engine', () => {
  expect(frameToMs(1, 60)).toBe(F);
});
