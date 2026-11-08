import { describe, expect, it } from 'vitest';
import {
  arm,
  attemptResult,
  chordProgress,
  createAttempt,
  currentStepIndex,
  press,
  release,
  start,
  tick,
  validateCombo,
  type AttemptState,
} from '../../src/engine/attempt';
import { chordGrade, chordWindowLastFrame, insideChordWindow } from '../../src/engine/chord';
import { DEFAULT_SETTINGS, frameToMs } from '../../src/engine/timing';
import { settle } from './settle';
import type { ChordWindow, Combo, InputSource, PressEvent, Settings, Step, StepResult } from '../../src/engine/types';

// --- helpers ---------------------------------------------------------------

const T0 = 1000;
/** ms timestamp `ms` into grid frame `frame` (frame 0 = T0), at 60 fps. Default: 5 ms in. */
const at = (frame: number, ms = 5) => T0 + frameToMs(frame, 60) + ms;

const frames = (size: number): ChordWindow => ({ size, unit: 'frames' });
const msWin = (size: number): ChordWindow => ({ size, unit: 'ms' });

const single = (button: string, targetFrame: number, tolEarly = 0, tolLate = 0): Step => ({
  buttons: [button],
  targetFrame,
  tolEarly,
  tolLate,
});

const chord = (buttons: string[], targetFrame: number, win: ChordWindow, tolEarly = 1, tolLate = 1): Step => ({
  buttons,
  targetFrame,
  tolEarly,
  tolLate,
  chordWindow: win,
});

const combo = (steps: Step[], opts: Partial<Omit<Combo, 'steps'>> = {}): Combo => ({
  name: 'chords',
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

/**
 * The proposal's worked example: a start press (HK) at T0 = frame 0, then a chord step
 * LP+MP with target 10, tolerance 1/1 (on-time frames 9–11), then an optional HP.
 */
function worked(win: ChordWindow, opts: { st?: Settings; next?: Step } = {}): AttemptState {
  const steps = [single('HK', 0), chord(['LP', 'MP'], 10, win)];
  if (opts.next) steps.push(opts.next);
  const st = arm(createAttempt(combo(steps), opts.st ?? DEFAULT_SETTINGS));
  return press(st, p('HK', T0));
}

/** Presses in order, then closes the last press's frame (results come when a frame closes). */
const feed = (state: AttemptState, presses: PressEvent[]) => settle(presses.reduce(press, state));

/** The chord step's result once everything is due (a tick far enough ahead to close the chord). */
function chordResult(state: AttemptState): StepResult | undefined {
  const done = tick(state, at(40));
  return done.results[1];
}

// --- the worked example, S1–S8 ------------------------------------------------

describe('chord table (proposal S1–S8, with the decisions taken)', () => {
  it('S1: LP 10, MP 10 → ON_TIME 0f (any window, even 0 frames)', () => {
    const r = chordResult(feed(worked(frames(0)), [p('LP', at(10)), p('MP', at(10, 9))]));
    expect(r).toMatchObject({ grade: 'ON_TIME', deltaFrames: 0, inputFrame: 10, expected: ['LP', 'MP'] });
    expect(r?.press?.button).toBe('MP'); // graded on the last press
  });

  it('S2: LP 10, MP 11 → ON_TIME +1f with a 1-frame window (graded on the last press)', () => {
    const r = chordResult(feed(worked(frames(1)), [p('LP', at(10)), p('MP', at(11))]));
    expect(r).toMatchObject({ grade: 'ON_TIME', deltaFrames: 1, inputFrame: 11 });
  });

  it('S2 with a 0-frame window: the chord breaks → PARTIAL (LP only)', () => {
    const st = feed(worked(frames(0)), [p('LP', at(10)), p('MP', at(11))]);
    expect(st.phase).toBe('done');
    expect(attemptResult(st)?.endedBy).toBe('partial');
    expect(st.results[1]?.grade).toBe('PARTIAL');
    expect(st.results[1]?.presses?.map((x) => x.press.button)).toEqual(['LP']);
  });

  it('S3: LP 10 (on time), MP 13 (+3f) → SPLIT, graded +3f on MP, with a 3-frame window', () => {
    const r = chordResult(feed(worked(frames(3)), [p('LP', at(10)), p('MP', at(13))]));
    expect(r).toMatchObject({ grade: 'SPLIT', deltaFrames: 3 });
    expect(r?.presses?.map((x) => x.timing)).toEqual(['ON_TIME', 'LATE']);
  });

  it('S3 with a 2-frame window → PARTIAL', () => {
    const st = feed(worked(frames(2)), [p('LP', at(10)), p('MP', at(13))]);
    expect(st.results[1]?.grade).toBe('PARTIAL');
  });

  it('S4: LP 7 (3f early), MP 10 → SPLIT, graded 0f on MP', () => {
    const r = chordResult(feed(worked(frames(3)), [p('LP', at(7)), p('MP', at(10))]));
    expect(r).toMatchObject({ grade: 'SPLIT', deltaFrames: 0 });
    expect(r?.presses?.map((x) => [x.press.button, x.timing, x.deltaFrames])).toEqual([
      ['LP', 'EARLY', -3],
      ['MP', 'ON_TIME', 0],
    ]);
  });

  it('S5: LP 8 (−2f), MP 13 (+3f) → SPLIT', () => {
    const r = chordResult(feed(worked(frames(5)), [p('LP', at(8)), p('MP', at(13))]));
    expect(r).toMatchObject({ grade: 'SPLIT', deltaFrames: 3 });
    expect(r?.presses?.map((x) => [x.timing, x.deltaFrames])).toEqual([
      ['EARLY', -2],
      ['LATE', 3],
    ]);
  });

  it('S6: LP 10 only → PARTIAL once the window runs out, with no other press', () => {
    let st = press(worked(frames(2)), p('LP', at(10)));
    st = tick(st, at(12, 16)); // still frame 12: the window (frames 10–12) is open
    expect(st.phase).toBe('running');
    expect(chordProgress(st)).toEqual(['LP']);
    st = tick(st, at(13, 0)); // frame 13: the window has run out
    expect(st.phase).toBe('done');
    expect(st.results[1]).toMatchObject({ grade: 'PARTIAL', expected: ['LP', 'MP'], deltaFrames: 0 });
    expect(attemptResult(st)).toMatchObject({ endedBy: 'partial', success: false });
  });

  it('S7: LP 10, HP 10 → WRONG_BUTTON with both presses', () => {
    const st = feed(worked(frames(2)), [p('LP', at(10)), p('HP', at(10, 8))]);
    expect(st.phase).toBe('done');
    expect(attemptResult(st)?.endedBy).toBe('wrongButton');
    expect(st.results[1]?.grade).toBe('WRONG_BUTTON');
    expect(st.results[1]?.press?.button).toBe('HP');
    expect(st.results[1]?.presses?.map((x) => x.press.button)).toEqual(['LP', 'HP']);
  });

  it('S8: LP, MP, HP all on frame 10 → WRONG_BUTTON, whatever order they arrive in', () => {
    for (const order of [['LP', 'MP', 'HP'], ['LP', 'HP', 'MP'], ['HP', 'LP', 'MP']]) {
      const st = feed(worked(frames(2), { next: single('HP', 3) }), order.map((b, k) => p(b, at(10, 2 + k))));
      expect(st.results[1]?.grade, order.join(',')).toBe('WRONG_BUTTON');
    }
  });
});

// --- window rules -------------------------------------------------------------

describe('chord window', () => {
  it('a press on the frame after completion belongs to the next step', () => {
    const st = feed(worked(frames(2), { next: single('HP', 1, 0, 0) }), [
      p('LP', at(10)),
      p('MP', at(10, 6)),
      p('HP', at(11)),
    ]);
    expect(attemptResult(st)?.endedBy).toBe('completed');
    expect(st.results.map((r) => r.grade)).toEqual(['ON_TIME', 'ON_TIME', 'ON_TIME']);
  });

  it('pressing a chord button again on a later frame → WRONG_BUTTON', () => {
    let st = release(press(worked(frames(2)), p('LP', at(10))), p('LP', at(10, 8)));
    st = feed(st, [p('LP', at(11))]);
    expect(st.results[1]?.grade).toBe('WRONG_BUTTON');
    expect(st.results[1]?.presses?.map((x) => x.press.button)).toEqual(['LP', 'LP']);
  });

  it('a double tap of a chord button on one frame is one press', () => {
    let st = press(worked(frames(2)), p('LP', at(10, 1)));
    st = press(release(st, p('LP', at(10, 3))), p('LP', at(10, 6)));
    st = feed(st, [p('MP', at(11))]);
    expect(chordResult(st)).toMatchObject({ grade: 'ON_TIME', inputFrame: 11 });
    expect(st.results[1]?.presses?.map((x) => [x.press.button, x.correctedTimestamp])).toEqual([
      ['LP', at(10, 6)],
      ['MP', at(11)],
    ]);
  });

  it('a complete chord is graded only after the frame it completed on', () => {
    let st = [p('LP', at(10)), p('MP', at(10, 6))].reduce(press, worked(frames(2)));
    expect(st.results).toHaveLength(1);
    st = tick(st, at(10, 16)); // still frame 10
    expect(st.results).toHaveLength(1);
    st = tick(st, at(11, 0));
    expect(st.phase).toBe('done');
    expect(st.results[1]?.grade).toBe('ON_TIME');
  });

  it('the next relative step counts from the frame the chord completed on', () => {
    // MP completes on frame 11; HP target 3 → frame 14.
    const st = feed(worked(frames(1), { next: single('HP', 3) }), [p('LP', at(10)), p('MP', at(11)), p('HP', at(14))]);
    expect(st.results[2]).toMatchObject({ grade: 'ON_TIME', inputFrame: 3, deltaFrames: 0 });
  });

  it('frames: presses 2 ms apart across a frame edge are 1 frame apart', () => {
    // LP 1 ms before the end of frame 10, MP 1 ms into frame 11.
    const presses = [p('LP', at(10, 15.67)), p('MP', at(11, 1))];
    expect(chordResult(feed(worked(frames(0)), presses))?.grade).toBe('PARTIAL');
    expect(chordResult(feed(worked(frames(1)), presses))).toMatchObject({ grade: 'ON_TIME', deltaFrames: 1 });
  });

  it('ms: the same presses are 2 ms apart, so a 5 ms window takes them (graded on frame 11)', () => {
    const presses = [p('LP', at(10, 15.67)), p('MP', at(11, 1))];
    expect(chordResult(feed(worked(msWin(5)), presses))).toMatchObject({ grade: 'ON_TIME', deltaFrames: 1 });
    expect(chordResult(feed(worked(msWin(1)), presses))?.grade).toBe('PARTIAL');
  });

  it('F9 ms: presses on the same frame always fit, however far apart (13 ms apart, 5 ms window)', () => {
    const presses = [p('LP', T0 + 168), p('MP', T0 + 181)];
    expect(chordResult(feed(worked(msWin(5)), presses))).toMatchObject({ grade: 'ON_TIME', inputFrame: 10 });
    expect(chordResult(feed(worked(frames(0)), presses))?.grade).toBe('ON_TIME');
  });

  it('F10 ms: presses on different frames must fit the ms size (6 ms apart, 5 ms window)', () => {
    const presses = [p('LP', T0 + 180), p('MP', T0 + 186)];
    const st = feed(worked(msWin(5)), presses);
    expect(st.results[1]?.grade).toBe('PARTIAL');
    expect(st.results[1]?.presses?.map((x) => x.press.button)).toEqual(['LP']);
  });

  it('ms: PARTIAL is known when the frame the window ends on closes', () => {
    // LP 5 ms into frame 10 with a 20 ms window: the window ends at 8.3 ms into frame 11.
    let st = press(worked(msWin(20)), p('LP', at(10)));
    st = tick(st, at(11, 16));
    expect(st.phase).toBe('running');
    st = tick(st, at(12, 0));
    expect(st.results[1]?.grade).toBe('PARTIAL');
  });

  it('presses on one frame get the same timing, so they can\'t make a SPLIT between themselves', () => {
    // Tolerance 1/1: frame 10 is on time. Both presses land on frame 10, 1 ms and 16 ms in.
    const r = chordResult(feed(worked(msWin(0)), [p('LP', at(10, 1)), p('MP', at(10, 16))]));
    expect(r?.grade).toBe('ON_TIME');
    expect(r?.presses?.map((x) => [x.inputFrame, x.timing])).toEqual([
      [10, 'ON_TIME'],
      [10, 'ON_TIME'],
    ]);
  });

  it('ms: a 0 ms window needs identical timestamps (one pad poll)', () => {
    const same = chordResult(feed(worked(msWin(0)), [p('LP', at(10), 'gamepad'), p('MP', at(10), 'gamepad')]));
    expect(same?.grade).toBe('ON_TIME');
  });

  it('the window counts from the first press, so 3 buttons must all fit in it', () => {
    const steps = [single('HK', 0), chord(['LP', 'MP', 'HP'], 10, frames(2))];
    const base = press(arm(createAttempt(combo(steps))), p('HK', T0));
    const ok = tick(feed(base, [p('LP', at(10)), p('MP', at(11)), p('HP', at(12))]), at(40));
    expect(ok.results[1]?.grade).toBe('SPLIT'); // LP, MP on time; HP on frame 12 is +2
    const late = feed(base, [p('LP', at(10)), p('MP', at(11)), p('HP', at(13))]);
    expect(late.results[1]).toMatchObject({ grade: 'PARTIAL' });
    expect(late.results[1]?.presses?.map((x) => x.press.button)).toEqual(['LP', 'MP']);
  });
});

// --- MISSED, strict mode, start modes -------------------------------------------

describe('chord MISSED rule', () => {
  const st0 = settings({ timeoutFrames: 1 }); // last accepted frame: 10 + 1 + 1 = 12

  it('no chord press at all → MISSED as usual', () => {
    const st = tick(worked(frames(2), { st: st0 }), at(13));
    expect(st.results[1]).toEqual({ stepIndex: 1, expected: ['LP', 'MP'], grade: 'MISSED' });
  });

  it('a first chord press past the deadline → MISSED', () => {
    const st = press(worked(frames(2), { st: st0 }), p('LP', at(13)));
    expect(st.results[1]?.grade).toBe('MISSED');
  });

  it('the MISSED timer pauses once the chord has started', () => {
    let st = press(worked(frames(3), { st: st0 }), p('LP', at(12)));
    st = tick(st, at(14)); // past frame 12, but the chord window (12–15) is open
    expect(st.phase).toBe('running');
    st = press(st, p('MP', at(15)));
    expect(chordResult(st)).toMatchObject({ grade: 'LATE', deltaFrames: 5 });
  });
});

describe('chords in non-strict mode', () => {
  const loose = settings({ strict: false });

  it('a wrong button ignores the whole broken chord and keeps waiting', () => {
    let st = feed(worked(frames(2), { st: loose }), [p('LP', at(10)), p('HP', at(10, 6))]);
    expect(st.phase).toBe('running');
    expect(chordProgress(st)).toBeNull();
    expect(st.ignoredPresses.map((x) => x.button)).toEqual(['LP', 'HP']);
    st = release(st, p('LP', at(11)));
    st = feed(st, [p('LP', at(12)), p('MP', at(12, 4))]);
    expect(chordResult(st)).toMatchObject({ grade: 'LATE', deltaFrames: 2 });
  });

  it('a partial chord is ignored, and a later press starts a new chord', () => {
    // LP alone on frame 10 (window 10–12), then MP on 14 starts a new chord that LP completes on 15.
    let st = feed(worked(frames(2), { st: loose }), [p('LP', at(10))]);
    st = release(st, p('LP', at(11)));
    st = feed(st, [p('MP', at(14)), p('LP', at(15))]);
    expect(st.ignoredPresses.map((x) => x.button)).toEqual(['LP']);
    expect(chordResult(st)).toMatchObject({ grade: 'LATE', deltaFrames: 5 });
  });

  it('ms: presses past the window on its last frame are ignored with the broken chord', () => {
    // F10 in non-strict mode: MP, 6 ms after LP on the next frame, doesn't fit a 5 ms window.
    const st = feed(worked(msWin(5), { st: loose }), [p('LP', T0 + 180), p('MP', T0 + 186)]);
    expect(st.phase).toBe('running');
    expect(chordProgress(st)).toBeNull();
    expect(st.ignoredPresses.map((x) => x.button)).toEqual(['LP', 'MP']);
  });

  it('a broken step-1 chord in first-input mode goes back to waiting, frame 0 cleared', () => {
    const c = combo([chord(['LP', 'MP'], 0, frames(1), 0, 0), single('HK', 3)]);
    let st = feed(arm(createAttempt(c, loose)), [p('LP', T0), p('HP', T0 + 4)]);
    expect(st.phase).toBe('armed');
    expect(st.frames.origin).toBeNull();
    expect(st.ignoredPresses.map((x) => x.button)).toEqual(['LP', 'HP']);
    st = release(release(st, p('LP', T0 + 100)), p('HP', T0 + 100));
    st = feed(st, [p('MP', T0 + 200), p('LP', T0 + 203)]);
    expect(st).toMatchObject({ phase: 'running', frame0: T0 + 200 });
  });

  it('tick() resets a partial chord without ending the attempt', () => {
    const st = tick(press(worked(frames(2), { st: loose }), p('LP', at(10))), at(13));
    expect(st.phase).toBe('running');
    expect(st.ignoredPresses.map((x) => x.button)).toEqual(['LP']);
  });
});

describe('a chord as step 1', () => {
  const startChord = [chord(['LP', 'MP'], 0, frames(2), 0, 0), single('HK', 3)];

  it('first input: the first press is frame 0; the next step counts from the last press', () => {
    let st = arm(createAttempt(combo(startChord)));
    st = [p('LP', T0), p('MP', at(1))].reduce(press, st);
    expect(st.phase).toBe('armed'); // not graded until frame 1 is over
    expect(currentStepIndex(st)).toBe(0);
    st = settle(press(st, p('HK', at(4)))); // 3 frames after MP's frame 1
    expect(st.frame0).toBe(T0);
    expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', deltaFrames: 0, inputFrame: 0, deltaMs: 0 });
    expect(st.results[0]?.presses?.map((x) => x.press.button)).toEqual(['LP', 'MP']);
    expect(st.results[0]?.presses?.[0]?.timing).toBeUndefined(); // the start's timing isn't checked
    expect(st.results[1]).toMatchObject({ grade: 'ON_TIME', inputFrame: 3 });
  });

  it('first input: a partial start chord is known by tick() while still armed', () => {
    let st = press(arm(createAttempt(combo(startChord))), p('LP', T0));
    st = tick(st, at(3));
    expect(st.phase).toBe('done');
    expect(st.results[0]).toMatchObject({ grade: 'PARTIAL' });
    expect(st.results[0]?.deltaFrames).toBeUndefined();
  });

  it('first input: a wrong start chord has no timing fields', () => {
    const st = feed(arm(createAttempt(combo(startChord))), [p('LP', T0), p('HK', T0 + 3)]);
    expect(st.results[0]).toMatchObject({ grade: 'WRONG_BUTTON', expected: ['LP', 'MP'] });
    expect(st.results[0]?.inputFrame).toBeUndefined();
  });

  it('first input: a single-step chord combo completes', () => {
    const st = tick(feed(arm(createAttempt(combo([startChord[0]!]))), [p('MP', T0), p('LP', T0 + 4)]), T0 + 40);
    expect(attemptResult(st)).toMatchObject({ endedBy: 'completed', success: true });
  });

  it('countdown: the chord is graded against Go like any step', () => {
    const c = combo([chord(['LP', 'MP'], 10, frames(2))], { startMode: 'countdown' });
    let st = start(arm(createAttempt(c)), T0);
    st = tick(feed(st, [p('LP', at(9)), p('MP', at(10))]), at(20));
    expect(st.results[0]).toMatchObject({ grade: 'ON_TIME', inputFrame: 10, deltaFrames: 0 });
    expect(st.results[0]?.presses?.map((x) => x.timing)).toEqual(['ON_TIME', 'ON_TIME']);
  });
});

describe('absolute timing with a chord', () => {
  it('grades the last press from frame 0', () => {
    const c = combo([single('HK', 0), chord(['LP', 'MP'], 10, frames(2)), single('HP', 20)], { timingMode: 'absolute' });
    const st = feed(arm(createAttempt(c)), [p('HK', T0), p('LP', at(10)), p('MP', at(11)), p('HP', at(20))]);
    expect(st.results.map((r) => [r.grade, r.inputFrame])).toEqual([
      ['ON_TIME', 0],
      ['ON_TIME', 11],
      ['ON_TIME', 20],
    ]);
  });
});

describe('latency offsets on chords', () => {
  it('each press is corrected for its own source', () => {
    const st0 = settings({ latencyOffsetMs: { keyboard: 0, gamepad: 20 } });
    // The pad press arrives 20 ms late in raw time but lands on frame 10 once corrected.
    const st = feed(worked(frames(0), { st: st0 }), [p('LP', at(10)), p('MP', at(10, 8) + 20, 'gamepad')]);
    expect(chordResult(st)).toMatchObject({ grade: 'ON_TIME', inputFrame: 10 });
  });
});

// --- validation and helpers -----------------------------------------------------

describe('chord validation', () => {
  const valid = (s: Step) => validateCombo(combo([s]));

  it('accepts chords with a window, and single steps without one', () => {
    expect(valid(chord(['LP', 'MP'], 0, frames(2)))).toEqual([]);
    expect(valid(chord(['LP', 'MP', 'HK'], 0, msWin(12.5)))).toEqual([]);
  });

  it('rejects a direction as a step button, alone or in a chord', () => {
    expect(valid(single('UP', 0))).toEqual(["step 1: directions can't be a step's button (UP)"]);
    expect(valid(chord(['LP', 'DOWN'], 0, frames(1)))).toEqual(["step 1: directions can't be a step's button (DOWN)"]);
  });

  it('rejects empty and duplicate buttons in a chord', () => {
    expect(valid({ ...single('LP', 0), buttons: [] })).toEqual(['step 1: button is required']);
    expect(valid(chord(['LP', 'LP'], 0, frames(1)))).toEqual(['step 1: LP is in the chord twice']);
  });

  it('requires a valid window on chords', () => {
    const noWin: Step = { buttons: ['LP', 'MP'], targetFrame: 0, tolEarly: 0, tolLate: 0 };
    expect(valid(noWin)).toEqual(['step 1: chordWindow is required for a chord']);
    expect(valid(chord(['LP', 'MP'], 0, frames(1.5)))[0]).toMatch(/whole number of frames/);
    expect(valid(chord(['LP', 'MP'], 0, frames(-1)))[0]).toMatch(/whole number of frames/);
    expect(valid(chord(['LP', 'MP'], 0, msWin(Number.NaN)))[0]).toMatch(/number of ms/);
    expect(valid(chord(['LP', 'MP'], 0, { size: 1, unit: 'beats' as 'ms' }))[0]).toMatch(/unit must be/);
  });
});

describe('chord helpers', () => {
  it('chordGrade: SPLIT for any mix of grades, else the shared grade', () => {
    expect(chordGrade(['ON_TIME', 'ON_TIME'])).toBe('ON_TIME');
    expect(chordGrade(['EARLY', 'EARLY'])).toBe('EARLY');
    expect(chordGrade(['LATE', 'LATE', 'LATE'])).toBe('LATE');
    expect(chordGrade(['EARLY', 'ON_TIME'])).toBe('SPLIT');
    expect(chordGrade(['EARLY', 'LATE'])).toBe('SPLIT');
    expect(chordGrade(['ON_TIME', 'LATE'])).toBe('SPLIT');
    expect(chordGrade(['ON_TIME', 'ON_TIME', 'LATE'])).toBe('SPLIT');
  });

  it('insideChordWindow: frames compare grid frames, ms compare times except on the first frame', () => {
    const first = { t: 100, frame: 6 };
    expect(insideChordWindow(frames(1), first, { t: 130, frame: 7 })).toBe(true);
    expect(insideChordWindow(frames(1), first, { t: 120, frame: 8 })).toBe(false);
    expect(insideChordWindow(msWin(30), first, { t: 130, frame: 99 })).toBe(true);
    expect(insideChordWindow(msWin(30), first, { t: 130.1, frame: 7 })).toBe(false);
    // Presses on the same frame as the first always fit an ms window (SPEC §3 Chords, rule 2).
    expect(insideChordWindow(msWin(5), first, { t: 113, frame: 6 })).toBe(true);
    expect(insideChordWindow(msWin(0), first, { t: 101, frame: 6 })).toBe(true);
  });

  it('chordWindowLastFrame: the last frame a press can still fit on', () => {
    const first = { t: 100, frame: 6 };
    const frameAt = (t: number) => Math.floor(t / 16);
    expect(chordWindowLastFrame(frames(2), first, frameAt)).toBe(8);
    expect(chordWindowLastFrame(msWin(30), first, frameAt)).toBe(8); // 130 ms is on frame 8
    expect(chordWindowLastFrame(msWin(0), first, frameAt)).toBe(6);
  });
});
