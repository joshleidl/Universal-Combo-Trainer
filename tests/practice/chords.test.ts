import { describe, expect, it } from 'vitest';
import { arm, attemptResult, createAttempt, press, tick, type AttemptState } from '../../src/engine/attempt';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import type { ChordWindow, Combo, PressEvent, Step } from '../../src/engine/types';
import { practiceCues } from '../../src/practice/cues';
import { buttonsName, describeAttempt, describeStep } from '../../src/practice/format';
import { createPractice, practicePress, practiceTick } from '../../src/practice/session';
import { emptyStats, recordAttempt, summarizeStep } from '../../src/practice/stats';
import { buildTimeline } from '../../src/practice/timeline';

const T0 = 1000;
const at = (frame: number, ms = 5) => T0 + frameToMs(frame, 60) + ms;
const p = (button: string, timestamp: number): PressEvent => ({ button, timestamp, source: 'keyboard' });

const chord = (win: ChordWindow): Step => ({
  buttons: ['LP', 'MP'],
  targetFrame: 10,
  tolEarly: 1,
  tolLate: 1,
  chordWindow: win,
});
const combo = (win: ChordWindow = { size: 3, unit: 'frames' }): Combo => ({
  name: 'chord',
  fps: 60,
  timingMode: 'relative',
  startMode: 'firstInput',
  steps: [{ buttons: ['HK'], targetFrame: 0, tolEarly: 0, tolLate: 0 }, chord(win)],
});

/** Runs the presses and a late tick, so any open chord is closed. */
function run(presses: PressEvent[], c: Combo = combo()): AttemptState {
  const st = presses.reduce(press, press(arm(createAttempt(c)), p('HK', T0)));
  return tick(st, at(60));
}

// Chords are graded over frames in plan milestone M4.
describe.skip('chord feedback text', () => {
  it('names chords with +', () => {
    expect(buttonsName(['LP', 'MP', 'HP'])).toBe('LP+MP+HP');
  });

  it('describes a split chord press by press', () => {
    const early = run([p('LP', at(7)), p('MP', at(10))]).results[1]!;
    expect(describeStep(early, false)).toBe('Split: LP 3f early, MP on time');
    const both = run([p('LP', at(8)), p('MP', at(11))], combo({ size: 5, unit: 'frames' })).results[1]!;
    expect(describeStep(both, false)).toBe('Split: LP 2f early, MP on time (+1f)');
    const wide = run([p('LP', at(8)), p('MP', at(13))], combo({ size: 5, unit: 'frames' })).results[1]!;
    expect(describeStep(wide, false)).toBe('Split: LP 2f early, MP 3f late');
  });

  it('describes partial and wrong chords', () => {
    const partial = run([p('LP', at(10))]).results[1]!;
    expect(describeStep(partial, false)).toBe('Partial: LP only, MP missing');
    const wrong = run([p('LP', at(10)), p('HP', at(10, 8))]).results[1]!;
    expect(describeStep(wrong, false)).toMatch(/^Wrong button: LP\+HP at 0f \(\+\d+\.\d ms\)$/);
  });

  it('describes on time then late as a split', () => {
    const mixed = run([p('LP', at(10)), p('MP', at(13))]).results[1]!;
    expect(describeStep(mixed, false)).toBe('Split: LP on time, MP 3f late');
  });

  it('describes a chord with every press late like any step, graded on the last press', () => {
    const late = run([p('LP', at(12)), p('MP', at(13))]).results[1]!;
    expect(describeStep(late, false)).toMatch(/^3f late/);
  });

  it('summarizes an attempt ended by a partial chord', () => {
    expect(describeAttempt(attemptResult(run([p('LP', at(10))]))!)).toBe('Partial chord on step 2.');
  });
});

// Chords are graded over frames in plan milestone M4.
describe.skip('chord timeline', () => {
  it('draws every chord press and the chord window', () => {
    const step = buildTimeline(run([p('LP', at(10)), p('MP', at(11))]))!.steps[1]!;
    expect(step.expected).toEqual(['LP', 'MP']);
    expect(step.chordPresses?.map((m) => m.button)).toEqual(['LP', 'MP']);
    expect(step.chordPresses?.[0]?.frame).toBeCloseTo(10 + 5 / frameToMs(1, 60));
    expect(step.chordPresses?.some((m) => m.wrong)).toBe(false);
    // Frames window: from LP to the end of frame 10 + 3.
    expect(step.chordWindow?.end).toBe(14);
    expect(step.input).toBeCloseTo(11 + 5 / frameToMs(1, 60)); // the graded press
    expect(step).not.toHaveProperty('pressed');
  });

  it('flags the press that broke the chord', () => {
    const step = buildTimeline(run([p('LP', at(10)), p('HP', at(10, 8))]))!.steps[1]!;
    expect(step.chordPresses?.map((m) => [m.button, m.wrong ?? false])).toEqual([
      ['LP', false],
      ['HP', true],
    ]);
  });

  it('an ms window ends exactly its size after the first press', () => {
    const step = buildTimeline(run([p('LP', at(10)), p('MP', at(10, 9))], combo({ size: 25, unit: 'ms' })))!.steps[1]!;
    expect(step.chordWindow!.end - step.chordWindow!.start).toBeCloseTo(25 / frameToMs(1, 60));
  });
});

// Chords are graded over frames in plan milestone M4.
describe.skip('chord stats', () => {
  it('counts each grade; split deltas count toward the average, partial ones do not', () => {
    let stats = emptyStats(2);
    stats = recordAttempt(stats, attemptResult(run([p('LP', at(7)), p('MP', at(10))]))!); // SPLIT, 0f
    stats = recordAttempt(stats, attemptResult(run([p('LP', at(12)), p('MP', at(12, 8))]))!); // LATE, +2f
    stats = recordAttempt(stats, attemptResult(run([p('LP', at(10))]))!); // PARTIAL
    const sum = summarizeStep(stats.steps[1]!);
    expect(sum).toMatchObject({ reached: 3, onTime: 0, meanDelta: 1 });
    expect(sum.counts).toMatchObject({ SPLIT: 1, LATE: 1, PARTIAL: 1, ON_TIME: 0 });
  });
});

// Chords are graded over frames in plan milestone M4.
describe.skip('chords in a practice session', () => {
  it('grades the chord after its last frame, with an off sound for a split', () => {
    let st = createPractice(combo(), DEFAULT_SETTINGS);
    st = practicePress(st, p('HK', T0));
    st = practicePress(st, p('LP', at(7)));
    st = practicePress(st, p('MP', at(10)));
    expect(st.attempt.results).toHaveLength(1);
    const before = st;
    st = practiceTick(st, at(11));
    expect(st.attempt.phase).toBe('done');
    expect(st.lastFinished?.results[1]?.grade).toBe('SPLIT');
    expect(practiceCues(before, st)).toEqual(['fail']);
    expect(st.stats.steps[1]?.counts.SPLIT).toBe(1);
  });
});
